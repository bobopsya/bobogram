-- Поиск по сообщениям, папки чатов, отложенные и исчезающие сообщения.

-- ============ поиск ============
create extension if not exists pg_trgm with schema extensions;
create index messages_text_trgm on public.messages using gin (text extensions.gin_trgm_ops) where not deleted;

-- Сообщения со словом во всех моих чатах (или в одном — p_chat), новые сверху.
create function public.search_messages(p_query text, p_chat uuid default null, p_limit int default 50)
returns table (id uuid, chat_id uuid, sender_id uuid, text text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id, m.chat_id, m.sender_id, m.text, m.created_at
  from public.messages m
  join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = auth.uid()
  where private.is_active()
    and char_length(trim(p_query)) >= 2
    and (p_chat is null or m.chat_id = p_chat)
    and m.created_at > cm.cleared_at
    and not m.deleted
    and not (auth.uid() = any (m.deleted_for))
    and m.system is null
    and m.text ilike '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;

-- ============ папки ============
create table public.chat_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 24),
  chat_ids uuid[] not null default '{}' check (cardinality(chat_ids) <= 200),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index chat_folders_user on public.chat_folders (user_id, sort);
alter table public.chat_folders enable row level security;
grant select, insert, update, delete on public.chat_folders to authenticated;
create policy chat_folders_own on public.chat_folders for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create function private.check_folder_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.chat_folders where user_id = new.user_id) >= 10 then
    raise exception 'too many folders' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger chat_folders_limit before insert on public.chat_folders
  for each row execute function private.check_folder_limit();

-- ============ отложенные ============
create table public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 4096),
  send_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index scheduled_messages_due on public.scheduled_messages (send_at);
alter table public.scheduled_messages enable row level security;
grant select, delete on public.scheduled_messages to authenticated;
create policy scheduled_own on public.scheduled_messages for all to authenticated using (user_id = auth.uid());

create function public.schedule_message(p_chat uuid, p_text text, p_at timestamptz, p_topic uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_role text := private.member_role(p_chat);
  v_id uuid;
begin
  if v_role is null or ((select type from public.chats where id = p_chat) = 'channel' and v_role = 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_at < now() + interval '30 seconds' or p_at > now() + interval '365 days' then
    raise exception 'bad time' using errcode = '22023';
  end if;
  if (select count(*) from public.scheduled_messages where user_id = v_me) >= 100 then
    raise exception 'too many scheduled' using errcode = '22023';
  end if;
  insert into public.scheduled_messages (user_id, chat_id, topic_id, text, send_at)
  values (v_me, p_chat, p_topic, left(trim(p_text), 4096), p_at)
  returning id into v_id;
  return v_id;
end $$;

-- Раз в минуту: пора — отправить от имени автора (если он всё ещё может писать в чат).
create function private.flush_scheduled() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r public.scheduled_messages;
  v_n int := 0;
begin
  for r in delete from public.scheduled_messages where send_at <= now() returning * loop
    if exists (
      select 1 from public.chat_members cm join public.chats c on c.id = cm.chat_id
      join public.profiles p on p.id = cm.user_id
      where cm.chat_id = r.chat_id and cm.user_id = r.user_id and not p.banned
        and (c.type <> 'channel' or cm.role in ('owner', 'admin'))
    ) then
      begin
        insert into public.messages (chat_id, sender_id, text, topic_id) values (r.chat_id, r.user_id, r.text, r.topic_id);
        v_n := v_n + 1;
      exception when others then
        null; -- например, собеседник заблокировал — сообщение пропадает
      end;
    end if;
  end loop;
  return v_n;
end $$;

-- ============ исчезающие ============
alter table public.chats add column ttl_seconds int check (ttl_seconds is null or ttl_seconds in (86400, 604800, 2592000));
alter table public.messages add column expires_at timestamptz;
create index messages_expires on public.messages (expires_at) where expires_at is not null and not deleted;

create function private.set_message_ttl() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ttl int := (select ttl_seconds from public.chats where id = new.chat_id);
begin
  if v_ttl is not null and new.system is null then new.expires_at := now() + make_interval(secs => v_ttl); end if;
  return new;
end $$;
create trigger messages_ttl before insert on public.messages
  for each row execute function private.set_message_ttl();

create function public.set_chat_ttl(p_chat uuid, p_seconds int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_type text := (select type from public.chats where id = p_chat);
  v_role text := private.member_role(p_chat);
begin
  if v_role is null or (v_type in ('group', 'channel') and v_role = 'member') or v_type = 'saved' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_seconds is not null and p_seconds not in (86400, 604800, 2592000) then
    raise exception 'bad ttl' using errcode = '22023';
  end if;
  update public.chats set ttl_seconds = p_seconds where id = p_chat;
  perform private.insert_system(p_chat, v_me, jsonb_build_object('kind', 'ttl', 'seconds', p_seconds));
end $$;

create function private.expire_messages() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.messages set deleted = true, text = '' where expires_at <= now() and not deleted;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Ручной запуск фоновых задач (тесты, отладка) — только с сервисным ключом.
create function public.run_scheduled_jobs() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('sent', private.flush_scheduled(), 'expired', private.expire_messages())
$$;
revoke execute on function public.run_scheduled_jobs() from public, anon, authenticated;
grant execute on function public.run_scheduled_jobs() to service_role;

-- ============ расписание ============
create extension if not exists pg_cron;
select cron.schedule('bobogram-scheduled', '* * * * *', 'select private.flush_scheduled()');
select cron.schedule('bobogram-expire', '*/5 * * * *', 'select private.expire_messages()');

revoke execute on function
  public.search_messages(text, uuid, int), private.check_folder_limit(), public.schedule_message(uuid, text, timestamptz, uuid),
  private.flush_scheduled(), private.set_message_ttl(), public.set_chat_ttl(uuid, int), private.expire_messages()
from public, anon;
revoke execute on function private.check_folder_limit(), private.flush_scheduled(), private.set_message_ttl(),
  private.expire_messages()
from authenticated;
grant execute on function public.search_messages(text, uuid, int), public.schedule_message(uuid, text, timestamptz, uuid),
  public.set_chat_ttl(uuid, int)
to authenticated;
