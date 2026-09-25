-- Со-владельцы и значок разработчика; защита владельца и со-владельцев от других админов.

alter table public.profiles
  add column co_owner boolean not null default false,
  add column developer boolean not null default false;

-- Владельца и со-владельцев может менять только владелец (и сам человек — свой профиль).
create function private.is_protected(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user = private.owner_id() or coalesce((select co_owner from public.profiles where id = p_user), false)
$$;

create function private.check_protected_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() <> old.id and auth.uid() is distinct from private.owner_id()
     and (old.id = private.owner_id() or old.co_owner) then
    raise exception 'protected user' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_protected before update on public.profiles
  for each row execute function private.check_protected_profile();

create function private.check_protected_nft() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;
begin
  if auth.uid() is not null and auth.uid() <> v_owner and auth.uid() is distinct from private.owner_id()
     and private.is_protected(v_owner) then
    raise exception 'protected user' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger nft_usernames_protected before insert or delete on public.nft_usernames
  for each row execute function private.check_protected_nft();

-- Только владелец: назначить со-владельца (он же админ) и выдать значок разработчика.
create function public.owner_set_co_owner(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is distinct from private.owner_id() or p_user = auth.uid() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles
  set co_owner = p_on, role = case when p_on then 'admin' else role end
  where id = p_user and not is_bot;
end $$;

create function public.owner_set_developer(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is distinct from private.owner_id() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles set developer = p_on where id = p_user;
end $$;

-- Лог в группу администрации.
create function private.log_owner_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a text := private.uname(auth.uid());
  u text := '@' || new.username;
begin
  if new.co_owner is distinct from old.co_owner then
    perform private.bot_log(case when new.co_owner then '👑 Владелец ' || a || ' назначил(а) со-владельцем ' || u
      else '👑 Владелец ' || a || ' снял(а) со-владельца ' || u end);
  end if;
  if new.developer is distinct from old.developer then
    perform private.bot_log(case when new.developer then '💻 Владелец ' || a || ' выдал(а) значок разработчика ' || u
      else '💻 Владелец ' || a || ' снял(а) значок разработчика с ' || u end);
  end if;
  return null;
end $$;
create trigger profiles_owner_log after update of co_owner, developer on public.profiles
  for each row execute function private.log_owner_changes();

-- @pupa — со-владелец и разработчик (по просьбе владельца).
update public.profiles set co_owner = true, developer = true, role = 'admin' where lower(username) = 'pupa';

revoke execute on function
  private.is_protected(uuid), private.check_protected_profile(), private.check_protected_nft(),
  private.log_owner_changes(), public.owner_set_co_owner(uuid, boolean), public.owner_set_developer(uuid, boolean)
from public, anon;
revoke execute on function private.is_protected(uuid), private.check_protected_profile(), private.check_protected_nft(),
  private.log_owner_changes()
from authenticated;
grant execute on function public.owner_set_co_owner(uuid, boolean), public.owner_set_developer(uuid, boolean)
to authenticated;
