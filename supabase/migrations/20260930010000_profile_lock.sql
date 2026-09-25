-- Админ запрещает пользователю менять имя, @имя, «О себе» и аватарку.
alter table public.profiles add column profile_locked boolean not null default false;

create function private.check_profile_lock() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Меняет сам пользователь (не админ через admin_update_profile).
  if old.profile_locked and auth.uid() = new.id and not private.is_admin()
     and (new.display_name is distinct from old.display_name
          or new.username is distinct from old.username
          or new.bio is distinct from old.bio
          or new.avatar is distinct from old.avatar) then
    raise exception 'profile locked' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger profiles_lock before update on public.profiles
  for each row execute function private.check_profile_lock();

create function public.admin_set_profile_lock(p_user uuid, p_locked boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if p_user = private.owner_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.profiles set profile_locked = p_locked where id = p_user;
end $$;

revoke execute on function private.check_profile_lock(), public.admin_set_profile_lock(uuid, boolean)
from public, anon;
grant execute on function public.admin_set_profile_lock(uuid, boolean) to authenticated;
