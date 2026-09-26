-- Основатель: полные права владельца (со-владельцы, значок разработчика, защита от всех админов).
-- Владелец и основатели друг друга менять не могут — каждый свой профиль меняет только сам.

alter table public.profiles add column founder boolean not null default false;

create function private.is_owner(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_user is not null and (
    p_user = private.owner_id() or coalesce((select founder from public.profiles where id = p_user), false))
$$;

create or replace function private.is_protected(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner(p_user) or coalesce((select co_owner from public.profiles where id = p_user), false)
$$;

-- Чужой профиль: владельца/основателя не трогает никто, со-владельца — только владелец или основатель.
create function private.may_manage(p_actor uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor is null or p_actor = p_target or (
    not private.is_owner(p_target)
    and (not coalesce((select co_owner from public.profiles where id = p_target), false) or private.is_owner(p_actor)))
$$;

create or replace function private.check_protected_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.may_manage(auth.uid(), old.id) then
    raise exception 'protected user' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function private.check_protected_nft() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;
begin
  if not private.may_manage(auth.uid(), v_owner) then
    raise exception 'protected user' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.owner_set_co_owner(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner(auth.uid()) or p_user = auth.uid() or private.is_owner(p_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles
  set co_owner = p_on, role = case when p_on then 'admin' else role end
  where id = p_user and not is_bot;
end $$;

create or replace function public.owner_set_developer(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_owner(auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.profiles set developer = p_on where id = p_user;
end $$;

-- Лог: владельца от основателя не отличаем в тексте — «Владелец».
create or replace function private.log_owner_changes() returns trigger
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

-- Для функции сброса пароля и клиента.
create function public.is_owner(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_owner(p_user)
$$;

-- @pupa — основатель (по просьбе владельца).
update public.profiles set founder = true, co_owner = false, role = 'admin' where lower(username) = 'pupa';

revoke execute on function private.is_owner(uuid), private.may_manage(uuid, uuid), public.is_owner(uuid) from public, anon;
revoke execute on function private.is_owner(uuid), private.may_manage(uuid, uuid) from authenticated;
grant execute on function public.is_owner(uuid) to authenticated, service_role;
