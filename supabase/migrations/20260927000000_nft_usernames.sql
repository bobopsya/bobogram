-- НФТ (коллекционные) юзернеймы: выдаёт и отзывает админ, передавать нельзя.
-- У человека может быть несколько таких имён в дополнение к основному @имени.
-- Пространство имён общее: НФТ-имя нельзя занять обычным, и наоборот.

create table public.nft_usernames (
  username text primary key check (username ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$'),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index nft_usernames_lower on public.nft_usernames (lower(username));
create index nft_usernames_owner on public.nft_usernames (owner_id);
create index nft_usernames_prefix on public.nft_usernames (lower(username) text_pattern_ops);

alter table public.nft_usernames enable row level security;
revoke all on public.nft_usernames from anon, authenticated;
grant select on public.nft_usernames to authenticated;
create policy nft_usernames_read on public.nft_usernames for select to authenticated using (true);

-- Основное @имя не может совпадать с чужим НФТ-именем.
create function private.check_username_free() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.nft_usernames where lower(username) = lower(new.username)) then
    raise exception 'username taken' using errcode = '23505';
  end if;
  return new;
end $$;
create trigger profiles_username_free before insert or update of username on public.profiles
  for each row execute function private.check_username_free();

create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_username ~ '^[A-Za-z][A-Za-z0-9_]{3,31}$'
    and not exists (
      select 1 from public.profiles
      where lower(username) = lower(p_username) and id is distinct from auth.uid()
    )
    and not exists (select 1 from public.nft_usernames where lower(username) = lower(p_username))
$$;

-- Профиль по основному или НФТ-имени (ссылка #/u/имя и поиск по @).
create function public.find_profile_by_username(p_username text) returns setof public.profiles
language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p
  where lower(p.username) = lower(trim(both '@' from trim(p_username)))
  union all
  select p.* from public.profiles p
  join public.nft_usernames n on n.owner_id = p.id
  where lower(n.username) = lower(trim(both '@' from trim(p_username)))
  limit 1
$$;

create function public.admin_grant_nft_username(p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(both '@' from trim(p_username));
begin
  perform private.assert_admin();
  if v_name !~ '^[A-Za-z][A-Za-z0-9_]{3,31}$' then raise exception 'bad username' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'no such user' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_name))
     or exists (select 1 from public.nft_usernames where lower(username) = lower(v_name)) then
    raise exception 'username taken' using errcode = '23505';
  end if;
  insert into public.nft_usernames (username, owner_id) values (v_name, p_user);
end $$;

create function public.admin_revoke_nft_username(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  delete from public.nft_usernames where lower(username) = lower(trim(both '@' from trim(p_username)));
end $$;

-- Новые имена видны в приложении сразу.
alter publication supabase_realtime add table public.nft_usernames;

revoke execute on function
  private.check_username_free(), public.find_profile_by_username(text),
  public.admin_grant_nft_username(uuid, text), public.admin_revoke_nft_username(text)
from public, anon;
grant execute on function
  public.find_profile_by_username(text), public.admin_grant_nft_username(uuid, text),
  public.admin_revoke_nft_username(text)
to authenticated;
