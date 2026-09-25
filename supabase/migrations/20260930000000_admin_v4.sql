-- v4: владелец, выдача админки, правка профиля админом, спамблок, стиль профиля.

-- ============ владелец ============
-- Первый админ сервиса — владелец: его нельзя снять с админки и забанить.
insert into private.config (key, value)
select 'owner_id', id::text from public.profiles where role = 'admin' order by created_at limit 1
on conflict (key) do nothing;

create function private.owner_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select value::uuid from private.config where key = 'owner_id'),
    (select id from public.profiles where role = 'admin' order by created_at limit 1)
  )
$$;

create function public.get_owner_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select private.owner_id()
$$;

create function public.admin_set_role(p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if p_user = auth.uid() or p_user = private.owner_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles set role = case when p_admin then 'admin' else 'user' end where id = p_user;
end $$;

create or replace function public.set_banned(p_user uuid, p_banned boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() or p_user = auth.uid() or p_user = private.owner_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles set banned = p_banned where id = p_user;
end $$;

-- ============ правка профиля админом ============
create function public.admin_update_profile(
  p_user uuid, p_display_name text default null, p_username text default null,
  p_bio text default null, p_avatar text default null, p_clear_avatar boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(trim(both '@' from trim(coalesce(p_username, ''))), '');
begin
  perform private.assert_admin();
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no such user' using errcode = '22023';
  end if;
  if v_name is not null then
    if v_name !~ '^[A-Za-z][A-Za-z0-9_]{3,31}$' then raise exception 'bad username' using errcode = '22023'; end if;
    if exists (select 1 from public.profiles where lower(username) = lower(v_name) and id <> p_user) then
      raise exception 'username taken' using errcode = '23505';
    end if;
  end if;
  if p_avatar is not null and (p_avatar !~ '^data:image/(webp|jpeg|png);base64,' or octet_length(p_avatar) > 70000) then
    raise exception 'bad avatar' using errcode = '22023';
  end if;
  update public.profiles set
    display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
    username = coalesce(v_name, username),
    bio = coalesce(p_bio, bio),
    avatar = case when p_clear_avatar then null else coalesce(p_avatar, avatar) end
  where id = p_user;
end $$;

-- ============ спамблок ============
alter table public.profiles add column spam_until timestamptz;

create function private.is_spamblocked(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select spam_until > now() from public.profiles where id = p_user), false)
$$;

create function public.admin_set_spamblock(p_user uuid, p_until timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if p_user = private.owner_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.profiles set spam_until = p_until where id = p_user;
end $$;

-- Нельзя писать первым в личку: пока собеседник ни разу не написал в этот чат.
create function private.check_spamblock_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.system is null and private.is_spamblocked(new.sender_id)
     and exists (select 1 from public.chats where id = new.chat_id and type = 'private')
     and not exists (
       select 1 from public.messages m
       where m.chat_id = new.chat_id and m.sender_id <> new.sender_id and m.system is null
     ) then
    raise exception 'spamblock' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger messages_spamblock before insert on public.messages
  for each row execute function private.check_spamblock_message();

-- Нельзя добавлять других людей в группы и каналы.
create function private.check_spamblock_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.user_id <> auth.uid() and private.is_spamblocked(auth.uid())
     and exists (select 1 from public.chats where id = new.chat_id and type in ('group', 'channel')) then
    raise exception 'spamblock' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger chat_members_spamblock before insert on public.chat_members
  for each row execute function private.check_spamblock_member();

-- ============ стиль профиля ============
alter table public.profiles
  add column name_color text check (name_color in (
    'red', 'orange', 'gold', 'green', 'teal', 'blue', 'violet', 'pink', 'fire', 'ocean', 'aurora', 'rainbow')),
  add column emoji_status text check (char_length(emoji_status) between 1 and 16),
  add column profile_bg text check (profile_bg in (
    'sunset', 'ocean', 'forest', 'night', 'candy', 'gold', 'aurora', 'space'));

-- Админ ставит любому; сам себе — только с премиумом. null — убрать.
create function public.set_profile_style(p_user uuid, p_color text, p_emoji text, p_bg text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  if not (private.is_admin() or (p_user = v_me and private.is_premium(v_me))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles set
    name_color = nullif(p_color, ''),
    emoji_status = nullif(trim(coalesce(p_emoji, '')), ''),
    profile_bg = nullif(p_bg, '')
  where id = p_user;
end $$;

-- ============ права ============
revoke execute on function
  private.owner_id(), private.is_spamblocked(uuid), private.check_spamblock_message(),
  private.check_spamblock_member(), public.get_owner_id(), public.admin_set_role(uuid, boolean),
  public.admin_update_profile(uuid, text, text, text, text, boolean), public.admin_set_spamblock(uuid, timestamptz),
  public.set_profile_style(uuid, text, text, text)
from public, anon;
grant execute on function
  public.get_owner_id(), public.admin_set_role(uuid, boolean),
  public.admin_update_profile(uuid, text, text, text, text, boolean), public.admin_set_spamblock(uuid, timestamptz),
  public.set_profile_style(uuid, text, text, text)
to authenticated;
