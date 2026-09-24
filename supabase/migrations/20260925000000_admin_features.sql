-- Bobogram v2: галочки, метки SCAM, премиум, накрутки, просмотры каналов, лимиты премиума, TURN.

-- ============ новые поля ============
alter table public.profiles
  add column verified boolean not null default false,
  add column scam boolean not null default false,
  add column premium_until timestamptz;

alter table public.chats
  add column verified boolean not null default false,
  add column scam boolean not null default false,
  add column boost_members int not null default 0 check (boost_members between 0 and 100000000);

alter table public.messages
  add column views int not null default 0,
  add column boost_views int not null default 0 check (boost_views between 0 and 1000000000),
  add column boost_reactions jsonb not null default '{}';

-- Пользователь по-прежнему может менять только свои «обычные» поля профиля:
-- права на колонки выданы в первой миграции, новые колонки туда не входят.

-- ============ премиум ============
create function private.is_premium(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select premium_until > now() from public.profiles where id = p_user), false)
$$;

-- «О себе»: 70 символов, с премиумом — 200.
create function private.check_profile_limits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(new.bio) > 70
     and (tg_op = 'INSERT' or new.bio is distinct from old.bio)
     and not coalesce(new.premium_until > now(), false) then
    raise exception 'bio too long' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger profiles_limits before insert or update on public.profiles
  for each row execute function private.check_profile_limits();

-- Лимит участников: канал 1000; группа 50, у владельца с премиумом — 200.
create function private.chat_member_limit(p_type text, p_owner uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case
    when p_type = 'channel' then 1000
    when private.is_premium(p_owner) then 200
    else 50
  end
$$;

create or replace function public.create_chat(
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
  if cardinality(v_members) + 1 > private.chat_member_limit(p_type, v_me) then
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

create or replace function public.add_members(p_chat uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_chat_admin(p_chat);
  v_chat public.chats;
  v_added uuid[];
begin
  select * into v_chat from public.chats where id = p_chat;
  with ins as (
    insert into public.chat_members (chat_id, user_id)
    select p_chat, u from unnest(p_users) u where exists (select 1 from public.profiles where id = u)
    on conflict do nothing returning user_id
  ) select coalesce(array_agg(user_id), '{}') into v_added from ins;
  if (select count(*) from public.chat_members where chat_id = p_chat)
     > private.chat_member_limit(v_chat.type, v_chat.owner_id) then
    raise exception 'too many members' using errcode = '22023';
  end if;
  if v_chat.type = 'group' and cardinality(v_added) > 0 then
    perform private.insert_system(p_chat, v_me, jsonb_build_object('kind', 'added', 'uids', to_jsonb(v_added)));
  end if;
end $$;

create or replace function public.join_by_invite(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_chat public.chats;
begin
  select * into v_chat from public.chats where invite_code = p_code;
  if v_chat.id is null then raise exception 'invalid invite' using errcode = 'P0002'; end if;
  if private.member_role(v_chat.id) is not null then return v_chat.id; end if;
  if (select count(*) from public.chat_members where chat_id = v_chat.id)
     >= private.chat_member_limit(v_chat.type, v_chat.owner_id) then
    raise exception 'too many members' using errcode = '22023';
  end if;
  insert into public.chat_members (chat_id, user_id) values (v_chat.id, v_me);
  if v_chat.type = 'group' then
    perform private.insert_system(v_chat.id, v_me, '{"kind": "joined"}'::jsonb);
  end if;
  return v_chat.id;
end $$;

-- Закреплённые чаты: 5, с премиумом — 10.
create or replace function public.set_chat_prefs(p_chat uuid, p_pinned boolean default null, p_muted boolean default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_limit int := case when private.is_premium(v_me) then 10 else 5 end;
begin
  if p_pinned
     and not coalesce((select pinned from public.chat_members where chat_id = p_chat and user_id = v_me), false)
     and (select count(*) from public.chat_members where user_id = v_me and pinned) >= v_limit then
    raise exception 'pin limit' using errcode = '22023';
  end if;
  update public.chat_members
  set pinned = coalesce(p_pinned, pinned), muted = coalesce(p_muted, muted)
  where chat_id = p_chat and user_id = v_me;
end $$;

-- ============ просмотры ============
-- Открыл чат — каждое новое (чужое) сообщение канала или группы получает +1 просмотр.
create or replace function public.mark_read(p_chat uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_prev timestamptz;
begin
  if v_me is null or not private.is_active() then return; end if;
  select last_read_at into v_prev from public.chat_members
  where chat_id = p_chat and user_id = v_me
  for update;
  if not found then return; end if;
  if (select type from public.chats where id = p_chat) in ('channel', 'group') then
    update public.messages set views = views + 1
    where chat_id = p_chat and created_at > v_prev and created_at <= now()
      and sender_id <> v_me and system is null and not deleted;
  end if;
  update public.chat_members set last_read_at = now() where chat_id = p_chat and user_id = v_me;
end $$;

-- ============ список чатов: значки и накрутка подписчиков ============
drop function public.get_chats(uuid);
create function public.get_chats(p_chat uuid default null)
returns table (
  id uuid, type text, title text, description text, avatar text, owner_id uuid, invite_code text,
  pinned_message_ids uuid[], last_message jsonb, created_at timestamptz, updated_at timestamptz,
  my_role text, last_read_at timestamptz, pinned boolean, muted boolean,
  unread int, member_count int, other_id uuid, others_read_at timestamptz,
  verified boolean, scam boolean
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
    (select count(*)::int from public.chat_members y where y.chat_id = c.id) + c.boost_members,
    case when c.type = 'private' then
      (select y.user_id from public.chat_members y where y.chat_id = c.id and y.user_id <> auth.uid() limit 1)
    end,
    (select max(y.last_read_at) from public.chat_members y where y.chat_id = c.id and y.user_id <> auth.uid()),
    c.verified, c.scam
  from public.chats c
  left join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
  where private.is_active() and (
    (p_chat is null and m.user_id is not null)
    or (c.id = p_chat and (m.user_id is not null or (private.is_admin() and c.type in ('group', 'channel'))))
  )
$$;

create or replace function public.invite_preview(p_code text)
returns table (id uuid, type text, title text, avatar text, member_count int, is_member boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.type, c.title, c.avatar,
    (select count(*)::int from public.chat_members m where m.chat_id = c.id) + c.boost_members,
    exists (select 1 from public.chat_members m where m.chat_id = c.id and m.user_id = auth.uid())
  from public.chats c
  where c.invite_code = p_code and private.is_active()
$$;

-- ============ админ сервиса ============
create function private.assert_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

drop function public.admin_list_chats();
create function public.admin_list_chats()
returns table (
  id uuid, type text, title text, avatar text, member_count int,
  boost_members int, verified boolean, scam boolean
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.type, c.title, c.avatar,
    (select count(*)::int from public.chat_members m where m.chat_id = c.id),
    c.boost_members, c.verified, c.scam
  from public.chats c
  where private.is_admin() and c.type in ('group', 'channel')
  order by c.updated_at desc
  limit 500
$$;

create function public.admin_set_user_badges(p_user uuid, p_verified boolean, p_scam boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  update public.profiles
  set verified = coalesce(p_verified, verified), scam = coalesce(p_scam, scam)
  where id = p_user;
end $$;

create function public.admin_set_chat_badges(p_chat uuid, p_verified boolean, p_scam boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  update public.chats
  set verified = coalesce(p_verified, verified), scam = coalesce(p_scam, scam)
  where id = p_chat and type in ('group', 'channel');
end $$;

-- Накрутка подписчиков: сколько «виртуальных» участников прибавить к реальным.
create function public.admin_boost_members(p_chat uuid, p_boost int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  update public.chats set boost_members = greatest(0, p_boost) where id = p_chat and type in ('group', 'channel');
end $$;

-- Накрутка просмотров и реакций поста: { "🔥": 120, "👍": 40 } прибавляется к настоящим.
create function public.admin_boost_message(p_msg uuid, p_views int, p_reactions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_clean jsonb := '{}';
  k text;
  v jsonb;
begin
  perform private.assert_admin();
  if jsonb_typeof(coalesce(p_reactions, '{}')) <> 'object' then
    raise exception 'bad reactions' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(coalesce(p_reactions, '{}')) loop
    if char_length(k) between 1 and 16 and jsonb_typeof(v) = 'number' and (v::text)::numeric >= 1 then
      v_clean := v_clean || jsonb_build_object(k, least((v::text)::numeric, 1000000000)::int);
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(v_clean)) > 20 then
    raise exception 'too many reactions' using errcode = '22023';
  end if;
  update public.messages
  set boost_views = greatest(0, coalesce(p_views, 0)), boost_reactions = v_clean
  where id = p_msg;
end $$;

-- Премиум: до даты или навсегда (null — снять).
create function public.admin_set_premium(p_user uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  update public.profiles set premium_until = p_until where id = p_user;
end $$;

-- ============ заявки на премиум ============
create table public.premium_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index premium_requests_one_pending on public.premium_requests (user_id) where status = 'pending';
alter table public.premium_requests enable row level security;
revoke all on public.premium_requests from anon, authenticated;
grant select on public.premium_requests to authenticated;
create policy premium_requests_own on public.premium_requests for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

create function public.request_premium(p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  insert into public.premium_requests (user_id, note) values (v_me, left(trim(coalesce(p_note, '')), 300))
  on conflict (user_id) where status = 'pending' do update set note = excluded.note, created_at = now();
end $$;

create function public.admin_resolve_premium_request(p_id bigint, p_approve boolean, p_until timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  perform private.assert_admin();
  update public.premium_requests
  set status = case when p_approve then 'approved' else 'rejected' end, resolved_at = now()
  where id = p_id and status = 'pending'
  returning user_id into v_user;
  if p_approve and v_user is not null then
    update public.profiles set premium_until = p_until where id = v_user;
  end if;
end $$;

-- ============ права на новые функции ============
revoke execute on function
  private.is_premium(uuid), private.check_profile_limits(), private.chat_member_limit(text, uuid),
  private.assert_admin()
from public, anon, authenticated;
revoke execute on function
  public.admin_set_user_badges(uuid, boolean, boolean), public.admin_set_chat_badges(uuid, boolean, boolean),
  public.admin_boost_members(uuid, int), public.admin_boost_message(uuid, int, jsonb),
  public.admin_set_premium(uuid, timestamptz), public.request_premium(text),
  public.admin_resolve_premium_request(bigint, boolean, timestamptz), public.get_chats(uuid),
  public.admin_list_chats()
from public, anon;
grant execute on function
  public.admin_set_user_badges(uuid, boolean, boolean), public.admin_set_chat_badges(uuid, boolean, boolean),
  public.admin_boost_members(uuid, int), public.admin_boost_message(uuid, int, jsonb),
  public.admin_set_premium(uuid, timestamptz), public.request_premium(text),
  public.admin_resolve_premium_request(bigint, boolean, timestamptz), public.get_chats(uuid),
  public.admin_list_chats()
to authenticated;
