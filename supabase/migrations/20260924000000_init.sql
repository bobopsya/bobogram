-- Bobogram: схема базы данных, правила доступа (RLS) и серверные функции.
-- Применяется автоматически GitHub Actions (scripts/supabase-setup.mjs) или `supabase db reset` локально.

create extension if not exists pg_net with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ============ настройки сервера ============
create table private.config (
  key text primary key,
  value text not null
);
insert into private.config (key, value)
values ('push_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict do nothing;

-- Доступ к настройкам только для серверной функции (service_role).
create function public.get_config(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.config where key = p_key
$$;
create function public.set_config_if_absent(p_key text, p_value text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.config (key, value) values (p_key, p_value) on conflict (key) do nothing;
  return (select value from private.config where key = p_key);
end $$;

-- ============ профили ============
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$'),
  display_name text not null check (char_length(display_name) between 1 and 64),
  bio text not null default '' check (char_length(bio) <= 200),
  avatar text check (avatar is null or char_length(avatar) <= 70000),
  role text not null default 'user' check (role in ('user', 'admin')),
  banned boolean not null default false,
  hide_last_seen boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));
create index profiles_username_prefix on public.profiles (lower(username) text_pattern_ops);

-- Профиль создаётся вместе с аккаунтом. Первый зарегистрированный становится администратором.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := trim(new.raw_user_meta_data ->> 'username');
begin
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    v_username,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), v_username),
    case when exists (select 1 from public.profiles) then 'user' else 'admin' end
  );
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function private.handle_new_user();

-- ============ вспомогательные проверки ============
create function private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not banned)
$$;
create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not banned)
$$;
create function private.assert_active() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ============ чаты ============
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('private', 'saved', 'group', 'channel')),
  private_key text unique,
  title text check (title is null or char_length(title) between 1 and 64),
  description text not null default '' check (char_length(description) <= 255),
  avatar text check (avatar is null or char_length(avatar) <= 70000),
  owner_id uuid references public.profiles (id) on delete set null,
  invite_code text unique,
  pinned_message_ids uuid[] not null default '{}',
  last_message jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_members (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  pinned boolean not null default false,
  muted boolean not null default false,
  primary key (chat_id, user_id)
);
create index chat_members_user on public.chat_members (user_id);
alter table public.chat_members replica identity full;

create function private.can_read_chat(p_chat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active() and (
    exists (select 1 from public.chat_members where chat_id = p_chat and user_id = auth.uid())
    or (private.is_admin() and exists (select 1 from public.chats where id = p_chat and type in ('group', 'channel')))
  )
$$;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  text text not null default '' check (char_length(text) <= 4096),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted boolean not null default false,
  deleted_for uuid[] not null default '{}',
  reply_to jsonb,
  forwarded_from jsonb,
  reactions jsonb not null default '{}',
  system jsonb,
  call jsonb
);
create index messages_chat_time on public.messages (chat_id, created_at desc);

create table public.blocks (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id)
);

create function private.member_role(p_chat uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.chat_members where chat_id = p_chat and user_id = auth.uid()
$$;
create function private.is_blocked_by(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where user_id = p_other and blocked_id = auth.uid())
$$;
-- ============ звонки ============
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  callee_id uuid not null references public.profiles (id) on delete cascade,
  chat_id uuid not null references public.chats (id) on delete cascade,
  video boolean not null default false,
  status text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'ended', 'missed')),
  offer jsonb,
  answer jsonb,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index calls_callee on public.calls (callee_id, status);

create table public.call_candidates (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls (id) on delete cascade,
  from_caller boolean not null,
  candidate jsonb not null,
  created_at timestamptz not null default now()
);
create index call_candidates_call on public.call_candidates (call_id);

-- ============ пуш-подписки ============
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

-- ============ права доступа ============
revoke all on all tables in schema public from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.calls enable row level security;
alter table public.call_candidates enable row level security;
alter table public.push_subscriptions enable row level security;

-- Профили видят все вошедшие; менять можно только некоторые поля своего профиля.
grant select on public.profiles to authenticated;
grant update (username, display_name, bio, avatar, hide_last_seen, last_seen) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() and not banned) with check (id = auth.uid());

-- Чаты, участники и сообщения читаются только участниками (админ сервиса — только группы и каналы).
grant select on public.chats, public.chat_members, public.messages to authenticated;
create policy chats_select on public.chats for select to authenticated using (private.can_read_chat(id));
create policy members_select on public.chat_members for select to authenticated using (private.can_read_chat(chat_id));
create policy messages_select on public.messages for select to authenticated using (private.can_read_chat(chat_id));

-- Чёрный список — только свой.
grant select, insert, delete on public.blocks to authenticated;
create policy blocks_own on public.blocks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and blocked_id <> auth.uid());

-- Звонки видят и меняют только двое участников.
grant select, insert on public.calls to authenticated;
grant update (status, answer, answered_at, ended_at) on public.calls to authenticated;
create policy calls_select on public.calls for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());
create policy calls_insert on public.calls for insert to authenticated
  with check (
    caller_id = auth.uid() and callee_id <> auth.uid() and private.is_active()
    and not private.is_blocked_by(callee_id)
    and private.member_role(chat_id) is not null
  );
create policy calls_update on public.calls for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

grant select, insert on public.call_candidates to authenticated;
create policy candidates_access on public.call_candidates for all to authenticated
  using (exists (select 1 from public.calls c where c.id = call_id and (c.caller_id = auth.uid() or c.callee_id = auth.uid())))
  with check (exists (
    select 1 from public.calls c where c.id = call_id
      and ((from_caller and c.caller_id = auth.uid()) or (not from_caller and c.callee_id = auth.uid()))
  ));

-- Пуш-подписки: свои (сохраняются через функцию save_push_subscription).
grant select, delete on public.push_subscriptions to authenticated;
create policy push_own on public.push_subscriptions for all to authenticated using (user_id = auth.uid());

-- ============ служебные функции для сообщений ============
create function private.snippet(p_text text) returns text
language sql immutable as $$
  select case when char_length(t) > 120 then left(t, 119) || '…' else t end
  from (select regexp_replace(trim(coalesce(p_text, '')), '\s+', ' ', 'g') as t) s
$$;

-- После нового сообщения: обновить «последнее сообщение» чата и отметку прочитанности отправителя.
create function private.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chats set
    last_message = jsonb_build_object(
      'id', new.id, 'text', private.snippet(new.text), 'sender_id', new.sender_id,
      'created_at', new.created_at, 'system', new.system, 'call', new.call, 'deleted', false),
    updated_at = new.created_at
  where id = new.chat_id;
  update public.chat_members set last_read_at = greatest(last_read_at, new.created_at)
  where chat_id = new.chat_id and user_id = new.sender_id;
  return new;
end $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function private.on_message_insert();

-- Пуш-уведомления: база сама вызывает серверную функцию (адрес задаёт скрипт установки).
create function private.notify_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := (select value from private.config where key = 'functions_url');
  v_secret text := (select value from private.config where key = 'push_secret');
begin
  if v_url is not null then
    perform net.http_post(
      url := v_url || '/bobogram',
      body := jsonb_build_object('action', 'push', 'table', tg_table_name, 'id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      timeout_milliseconds := 5000
    );
  end if;
  return new;
exception when others then
  return new;
end $$;
create trigger messages_push after insert on public.messages
  for each row when (new.system is null) execute function private.notify_push();
create trigger calls_push after insert on public.calls
  for each row execute function private.notify_push();

create function private.insert_system(p_chat uuid, p_sender uuid, p_event jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.messages (chat_id, sender_id, system) values (p_chat, p_sender, p_event)
$$;

create function private.member_limit(p_type text) returns int
language sql immutable as $$ select case when p_type = 'channel' then 1000 else 50 end $$;

-- ============ API: аккаунт ============
create function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_username ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$'
    and not exists (
      select 1 from public.profiles
      where lower(username) = lower(p_username) and id is distinct from auth.uid()
    )
$$;

-- Вход по юзернейму: узнаём служебную почту аккаунта.
create function public.login_email(p_username text) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from auth.users u join public.profiles p on p.id = u.id
  where lower(p.username) = lower(trim(both '@' from trim(p_username)))
$$;

-- ============ API: список чатов ============
create function public.get_chats(p_chat uuid default null)
returns table (
  id uuid, type text, title text, description text, avatar text, owner_id uuid, invite_code text,
  pinned_message_ids uuid[], last_message jsonb, created_at timestamptz, updated_at timestamptz,
  my_role text, last_read_at timestamptz, pinned boolean, muted boolean,
  unread int, member_count int, other_id uuid, others_read_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.type, c.title, c.description, c.avatar, c.owner_id,
    case when m.role in ('owner', 'admin') then c.invite_code end,
    c.pinned_message_ids, c.last_message, c.created_at, c.updated_at,
    m.role, coalesce(m.last_read_at, now()), coalesce(m.pinned, false), coalesce(m.muted, false),
    case when m.user_id is null then 0 else (
      select count(*)::int from public.messages x
      where x.chat_id = c.id and x.created_at > m.last_read_at and x.sender_id <> m.user_id
        and not x.deleted and not (m.user_id = any (x.deleted_for))
    ) end,
    (select count(*)::int from public.chat_members y where y.chat_id = c.id),
    case when c.type = 'private' then
      (select y.user_id from public.chat_members y where y.chat_id = c.id and y.user_id <> auth.uid() limit 1)
    end,
    (select max(y.last_read_at) from public.chat_members y where y.chat_id = c.id and y.user_id <> auth.uid())
  from public.chats c
  left join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
  where private.is_active() and (
    (p_chat is null and m.user_id is not null)
    or (c.id = p_chat and (m.user_id is not null or (private.is_admin() and c.type in ('group', 'channel'))))
  )
$$;

create function public.get_or_create_private_chat(p_other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_key text;
  v_id uuid;
begin
  if p_other = v_me or not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'bad user' using errcode = '22023';
  end if;
  v_key := least(v_me::text, p_other::text) || '_' || greatest(v_me::text, p_other::text);
  insert into public.chats (type, private_key) values ('private', v_key) on conflict (private_key) do nothing;
  select id into v_id from public.chats where private_key = v_key;
  insert into public.chat_members (chat_id, user_id) values (v_id, v_me), (v_id, p_other) on conflict do nothing;
  return v_id;
end $$;

create function public.get_saved_chat() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_id uuid;
begin
  insert into public.chats (type, private_key) values ('saved', 'saved_' || v_me) on conflict (private_key) do nothing;
  select id into v_id from public.chats where private_key = 'saved_' || v_me;
  insert into public.chat_members (chat_id, user_id) values (v_id, v_me) on conflict do nothing;
  return v_id;
end $$;

-- ============ API: сообщения ============
create function public.send_message(
  p_id uuid, p_chat uuid, p_text text,
  p_reply_to jsonb default null, p_forwarded_from jsonb default null, p_call jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_type text;
  v_role text := private.member_role(p_chat);
  v_other uuid;
begin
  -- Повторная отправка из офлайн-очереди — ничего не делаем.
  if exists (select 1 from public.messages where id = p_id) then return p_id; end if;
  select type into v_type from public.chats where id = p_chat;
  if v_role is null then raise exception 'not a member' using errcode = '42501'; end if;
  if v_type = 'channel' and v_role = 'member' then raise exception 'read only' using errcode = '42501'; end if;
  if v_type = 'private' then
    select user_id into v_other from public.chat_members where chat_id = p_chat and user_id <> v_me;
    if private.is_blocked_by(v_other) then raise exception 'blocked' using errcode = '42501'; end if;
  end if;
  if p_call is null and char_length(trim(coalesce(p_text, ''))) = 0 then
    raise exception 'empty' using errcode = '22023';
  end if;
  insert into public.messages (id, chat_id, sender_id, text, reply_to, forwarded_from, call)
  values (p_id, p_chat, v_me, coalesce(p_text, ''), p_reply_to, p_forwarded_from, p_call);
  return p_id;
end $$;

create function public.edit_message(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_id;
  if v_msg.sender_id is distinct from v_me or v_msg.deleted or v_msg.system is not null or v_msg.call is not null
     or private.member_role(v_msg.chat_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(trim(p_text)) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  update public.messages set text = p_text, edited_at = now() where id = p_id;
  update public.chats set last_message = last_message || jsonb_build_object('text', private.snippet(p_text))
  where id = v_msg.chat_id and last_message ->> 'id' = p_id::text;
end $$;

create function public.delete_message(p_id uuid, p_for_all boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_msg public.messages;
  v_type text;
  v_role text;
begin
  select * into v_msg from public.messages where id = p_id;
  if v_msg.id is null then return; end if;
  select type into v_type from public.chats where id = v_msg.chat_id;
  v_role := private.member_role(v_msg.chat_id);
  if p_for_all then
    if not (
      (v_msg.sender_id = v_me and v_role is not null)
      or (v_type in ('group', 'channel') and (v_role in ('owner', 'admin') or private.is_admin()))
    ) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    update public.messages
      set deleted = true, text = '', reactions = '{}', reply_to = null, forwarded_from = null
      where id = p_id;
    update public.chats set last_message = last_message || '{"deleted": true, "text": ""}'::jsonb
      where id = v_msg.chat_id and last_message ->> 'id' = p_id::text;
  else
    if v_role is null then raise exception 'not allowed' using errcode = '42501'; end if;
    update public.messages set deleted_for = array_append(deleted_for, v_me)
      where id = p_id and not (v_me = any (deleted_for));
  end if;
end $$;

-- Одна реакция на человека (как в Telegram): новая заменяет старую, повторная снимает.
create function public.toggle_reaction(p_id uuid, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me text := private.assert_active()::text;
  v_msg public.messages;
  v_had boolean;
  v_new jsonb := '{}';
  k text;
  v jsonb;
  v_rest jsonb;
begin
  if char_length(p_emoji) not between 1 and 16 then raise exception 'bad emoji' using errcode = '22023'; end if;
  select * into v_msg from public.messages where id = p_id for update;
  if v_msg.id is null or v_msg.deleted or private.member_role(v_msg.chat_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_had := coalesce(v_msg.reactions -> p_emoji, '[]'::jsonb) ? v_me;
  for k, v in select * from jsonb_each(v_msg.reactions) loop
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rest from jsonb_array_elements_text(v) e where e <> v_me;
    if jsonb_array_length(v_rest) > 0 then v_new := v_new || jsonb_build_object(k, v_rest); end if;
  end loop;
  if not v_had then
    v_new := v_new || jsonb_build_object(p_emoji, coalesce(v_new -> p_emoji, '[]'::jsonb) || to_jsonb(v_me));
  end if;
  if (select count(*) from jsonb_object_keys(v_new)) > 20 then
    raise exception 'too many reactions' using errcode = '22023';
  end if;
  update public.messages set reactions = v_new where id = p_id;
end $$;

create function public.mark_read(p_chat uuid) returns void
language sql security definer set search_path = '' as $$
  update public.chat_members set last_read_at = now()
  where chat_id = p_chat and user_id = auth.uid() and private.is_active()
$$;

create function public.set_chat_prefs(p_chat uuid, p_pinned boolean default null, p_muted boolean default null)
returns void
language sql security definer set search_path = '' as $$
  update public.chat_members
  set pinned = coalesce(p_pinned, pinned), muted = coalesce(p_muted, muted)
  where chat_id = p_chat and user_id = auth.uid()
$$;

create function public.set_pinned_messages(p_chat uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_type text := (select type from public.chats where id = p_chat);
  v_role text := private.member_role(p_chat);
begin
  if v_role is null or (v_type in ('group', 'channel') and v_role = 'member') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.chats set pinned_message_ids = p_ids[1:50] where id = p_chat;
end $$;

-- ============ API: группы и каналы ============
create function public.create_chat(
  p_type text, p_title text, p_description text default '', p_avatar text default null, p_members uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_id uuid;
  v_members uuid[];
begin
  if p_type not in ('group', 'channel') then raise exception 'bad type' using errcode = '22023'; end if;
  select coalesce(array_agg(distinct m), '{}') into v_members
  from unnest(p_members) m where m <> v_me and exists (select 1 from public.profiles where id = m);
  if cardinality(v_members) + 1 > private.member_limit(p_type) then
    raise exception 'too many members' using errcode = '22023';
  end if;
  insert into public.chats (type, title, description, avatar, owner_id)
  values (p_type, trim(p_title), trim(coalesce(p_description, '')), p_avatar, v_me)
  returning id into v_id;
  insert into public.chat_members (chat_id, user_id, role) values (v_id, v_me, 'owner');
  insert into public.chat_members (chat_id, user_id) select v_id, unnest(v_members);
  perform private.insert_system(v_id, v_me, jsonb_build_object('kind', 'created', 'title', trim(p_title)));
  return v_id;
end $$;

create function private.assert_chat_admin(p_chat uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  if coalesce(private.member_role(p_chat), '') not in ('owner', 'admin')
     or (select type from public.chats where id = p_chat) not in ('group', 'channel') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v_me;
end $$;

create function public.update_chat_info(p_chat uuid, p_title text, p_description text, p_avatar text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_chat_admin(p_chat);
  v_chat public.chats;
begin
  select * into v_chat from public.chats where id = p_chat;
  update public.chats set title = trim(p_title), description = trim(coalesce(p_description, '')), avatar = p_avatar
  where id = p_chat;
  if v_chat.type = 'group' and v_chat.title is distinct from trim(p_title) then
    perform private.insert_system(p_chat, v_me, jsonb_build_object('kind', 'renamed', 'title', trim(p_title)));
  end if;
end $$;

create function public.add_members(p_chat uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_chat_admin(p_chat);
  v_type text := (select type from public.chats where id = p_chat);
  v_added uuid[];
begin
  with ins as (
    insert into public.chat_members (chat_id, user_id)
    select p_chat, u from unnest(p_users) u where exists (select 1 from public.profiles where id = u)
    on conflict do nothing returning user_id
  ) select coalesce(array_agg(user_id), '{}') into v_added from ins;
  if (select count(*) from public.chat_members where chat_id = p_chat) > private.member_limit(v_type) then
    raise exception 'too many members' using errcode = '22023';
  end if;
  if v_type = 'group' and cardinality(v_added) > 0 then
    perform private.insert_system(p_chat, v_me, jsonb_build_object('kind', 'added', 'uids', to_jsonb(v_added)));
  end if;
end $$;

create function public.remove_member(p_chat uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_chat_admin(p_chat);
  v_my_role text := private.member_role(p_chat);
  v_role text := (select role from public.chat_members where chat_id = p_chat and user_id = p_user);
begin
  if v_role is null or v_role = 'owner' or p_user = v_me or (v_role = 'admin' and v_my_role <> 'owner') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.chat_members where chat_id = p_chat and user_id = p_user;
  if (select type from public.chats where id = p_chat) = 'group' then
    perform private.insert_system(p_chat, v_me, jsonb_build_object('kind', 'removed', 'uid', p_user));
  end if;
end $$;

create function public.set_admin(p_chat uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_chat_admin(p_chat);
  if private.member_role(p_chat) <> 'owner' then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.chat_members set role = case when p_admin then 'admin' else 'member' end
  where chat_id = p_chat and user_id = p_user and role <> 'owner';
end $$;

create function public.leave_chat(p_chat uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_role text := private.member_role(p_chat);
  v_type text := (select type from public.chats where id = p_chat);
begin
  if v_role is null or v_role = 'owner' or v_type not in ('group', 'channel') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_type = 'group' then
    perform private.insert_system(p_chat, v_me, '{"kind": "left"}'::jsonb);
  end if;
  delete from public.chat_members where chat_id = p_chat and user_id = v_me;
end $$;

create function public.delete_chat(p_chat uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_active();
  if (select type from public.chats where id = p_chat) not in ('group', 'channel')
     or not (private.member_role(p_chat) = 'owner' or private.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.chats where id = p_chat;
end $$;

create function public.reset_invite(p_chat uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := replace(left(gen_random_uuid()::text, 13), '-', '');
begin
  perform private.assert_chat_admin(p_chat);
  update public.chats set invite_code = v_code where id = p_chat;
  return v_code;
end $$;

create function public.invite_preview(p_code text)
returns table (id uuid, type text, title text, avatar text, member_count int, is_member boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.type, c.title, c.avatar,
    (select count(*)::int from public.chat_members m where m.chat_id = c.id),
    exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = auth.uid())
  from public.chats c
  where c.invite_code = p_code and private.is_active()
$$;

create function public.join_by_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_chat public.chats;
begin
  select * into v_chat from public.chats where invite_code = p_code;
  if v_chat.id is null then raise exception 'invalid invite' using errcode = 'P0002'; end if;
  if private.member_role(v_chat.id) is not null then return v_chat.id; end if;
  if (select count(*) from public.chat_members where chat_id = v_chat.id) >= private.member_limit(v_chat.type) then
    raise exception 'too many members' using errcode = '22023';
  end if;
  insert into public.chat_members (chat_id, user_id) values (v_chat.id, v_me);
  if v_chat.type = 'group' then
    perform private.insert_system(v_chat.id, v_me, '{"kind": "joined"}'::jsonb);
  end if;
  return v_chat.id;
end $$;

-- ============ API: администратор сервиса ============
create function public.set_banned(p_user uuid, p_banned boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() or p_user = auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.profiles set banned = p_banned where id = p_user;
end $$;

create function public.admin_list_chats()
returns table (id uuid, type text, title text, avatar text, member_count int)
language sql stable security definer set search_path = '' as $$
  select c.id, c.type, c.title, c.avatar, (select count(*)::int from public.chat_members m where m.chat_id = c.id)
  from public.chats c
  where private.is_admin() and c.type in ('group', 'channel')
  order by c.updated_at desc
  limit 500
$$;

-- ============ API: пуш-подписки ============
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, v_me, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = v_me, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- ============ права на функции ============
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function
  private.is_active(), private.is_admin(), private.member_role(uuid), private.is_blocked_by(uuid),
  private.can_read_chat(uuid)
to authenticated;
grant execute on function public.username_available(text), public.login_email(text) to anon, authenticated;
grant execute on function
  public.get_chats(uuid), public.get_or_create_private_chat(uuid), public.get_saved_chat(),
  public.send_message(uuid, uuid, text, jsonb, jsonb, jsonb), public.edit_message(uuid, text),
  public.delete_message(uuid, boolean), public.toggle_reaction(uuid, text), public.mark_read(uuid),
  public.set_chat_prefs(uuid, boolean, boolean), public.set_pinned_messages(uuid, uuid[]),
  public.create_chat(text, text, text, text, uuid[]), public.update_chat_info(uuid, text, text, text),
  public.add_members(uuid, uuid[]), public.remove_member(uuid, uuid), public.set_admin(uuid, uuid, boolean),
  public.leave_chat(uuid), public.delete_chat(uuid), public.reset_invite(uuid), public.invite_preview(text),
  public.join_by_invite(text), public.set_banned(uuid, boolean), public.admin_list_chats(),
  public.save_push_subscription(text, text, text)
to authenticated;
grant execute on function public.get_config(text), public.set_config_if_absent(text, text) to service_role;

-- ============ realtime ============
alter publication supabase_realtime add table
  public.messages, public.chats, public.chat_members, public.profiles, public.calls, public.call_candidates;
