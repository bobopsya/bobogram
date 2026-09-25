-- Let users manage second usernames on their own profile; admins can still manage any profile.

create or replace function public.admin_grant_nft_username(p_user uuid, p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(both '@' from trim(p_username));
begin
  if not (private.is_admin() or p_user = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
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

create or replace function public.admin_revoke_nft_username(p_username text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(both '@' from trim(p_username));
  v_owner uuid;
begin
  select owner_id into v_owner from public.nft_usernames where lower(username) = lower(v_name);
  if v_owner is null then return; end if;
  if not (private.is_admin() or v_owner = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.nft_usernames where lower(username) = lower(v_name);
end $$;
