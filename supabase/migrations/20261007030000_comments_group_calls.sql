-- Комментарии к постам каналов (включает владелец канала) и голосовые чаты в группах.

-- ============ комментарии ============
alter table public.chats add column comments_enabled boolean not null default false;
alter table public.messages add column comments int not null default 0;

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.messages (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 4096),
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index post_comments_post on public.post_comments (post_id, created_at);
alter table public.post_comments enable row level security;
grant select on public.post_comments to authenticated;
create policy post_comments_read on public.post_comments for select to authenticated
  using (private.can_read_chat(chat_id));
alter table public.post_comments replica identity full;
alter publication supabase_realtime add table public.post_comments;

create function public.set_channel_comments(p_chat uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_active();
  if (select type from public.chats where id = p_chat) is distinct from 'channel'
     or (coalesce(private.member_role(p_chat), '') <> 'owner' and not private.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.chats set comments_enabled = p_on where id = p_chat;
end $$;

create function public.add_comment(p_post uuid, p_text text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_post public.messages;
  v_id uuid;
begin
  select * into v_post from public.messages where id = p_post;
  if v_post.id is null or v_post.deleted or v_post.system is not null
     or not (select comments_enabled from public.chats where id = v_post.chat_id and type = 'channel')
     or private.member_role(v_post.chat_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if private.is_spamblocked(v_me) then raise exception 'spamblock' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_text, ''))) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  insert into public.post_comments (post_id, chat_id, sender_id, text)
  values (p_post, v_post.chat_id, v_me, left(trim(p_text), 4096)) returning id into v_id;
  update public.messages set comments = comments + 1 where id = p_post;
  return v_id;
end $$;

create function public.delete_comment(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.post_comments;
begin
  perform private.assert_active();
  select * into v_c from public.post_comments where id = p_id;
  if v_c.id is null or v_c.deleted
     or (v_c.sender_id <> auth.uid() and coalesce(private.member_role(v_c.chat_id), '') not in ('owner', 'admin')
         and not private.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.post_comments set deleted = true, text = '—' where id = p_id;
  update public.messages set comments = greatest(0, comments - 1) where id = v_c.post_id;
end $$;

-- ============ голосовые чаты в группах ============
create table public.group_calls (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index group_calls_active on public.group_calls (chat_id) where ended_at is null;

create table public.group_call_members (
  call_id uuid not null references public.group_calls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (call_id, user_id)
);
alter table public.group_calls enable row level security;
alter table public.group_call_members enable row level security;
grant select on public.group_calls, public.group_call_members to authenticated;
create policy group_calls_read on public.group_calls for select to authenticated using (private.can_read_chat(chat_id));
create policy group_call_members_read on public.group_call_members for select to authenticated using (
  exists (select 1 from public.group_calls c where c.id = call_id and private.can_read_chat(c.chat_id)));
alter table public.group_call_members replica identity full;
alter publication supabase_realtime add table public.group_calls, public.group_call_members;

-- Войти в голосовой чат группы (создать, если его нет). До 6 участников: каждый связан с каждым.
create function public.join_group_call(p_chat uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_id uuid;
begin
  if (select type from public.chats where id = p_chat) is distinct from 'group' or private.member_role(p_chat) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id into v_id from public.group_calls where chat_id = p_chat and ended_at is null;
  if v_id is null then
    insert into public.group_calls (chat_id, started_by) values (p_chat, v_me) returning id into v_id;
    perform private.insert_system(p_chat, v_me, jsonb_build_object('kind', 'voiceStarted'));
  end if;
  if not exists (select 1 from public.group_call_members where call_id = v_id and user_id = v_me)
     and (select count(*) from public.group_call_members where call_id = v_id) >= 6 then
    raise exception 'call full' using errcode = '22023';
  end if;
  insert into public.group_call_members (call_id, user_id) values (v_id, v_me)
  on conflict (call_id, user_id) do update set joined_at = now(), muted = false;
  return v_id;
end $$;

create function public.leave_group_call(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  delete from public.group_call_members where call_id = p_call and user_id = v_me;
  if not exists (select 1 from public.group_call_members where call_id = p_call) then
    update public.group_calls set ended_at = now() where id = p_call and ended_at is null;
  end if;
end $$;

create function public.set_group_call_muted(p_call uuid, p_muted boolean) returns void
language sql security definer set search_path = '' as $$
  update public.group_call_members set muted = p_muted where call_id = p_call and user_id = auth.uid()
$$;

-- Кто давно не отвечает (закрыл вкладку) — выходит сам: участник раз в 20 с продлевает присутствие.
alter table public.group_call_members add column seen_at timestamptz not null default now();
create function public.ping_group_call(p_call uuid) returns void
language sql security definer set search_path = '' as $$
  update public.group_call_members set seen_at = now() where call_id = p_call and user_id = auth.uid()
$$;
create function private.cleanup_group_calls() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.group_call_members where seen_at < now() - interval '1 minute';
  update public.group_calls c set ended_at = now()
  where ended_at is null and not exists (select 1 from public.group_call_members m where m.call_id = c.id);
end $$;
select cron.schedule('bobogram-group-calls', '* * * * *', 'select private.cleanup_group_calls()');

revoke execute on function
  public.set_channel_comments(uuid, boolean), public.add_comment(uuid, text), public.delete_comment(uuid),
  public.join_group_call(uuid), public.leave_group_call(uuid), public.set_group_call_muted(uuid, boolean),
  public.ping_group_call(uuid), private.cleanup_group_calls()
from public, anon;
revoke execute on function private.cleanup_group_calls() from authenticated;
grant execute on function
  public.set_channel_comments(uuid, boolean), public.add_comment(uuid, text), public.delete_comment(uuid),
  public.join_group_call(uuid), public.leave_group_call(uuid), public.set_group_call_muted(uuid, boolean),
  public.ping_group_call(uuid)
to authenticated;
