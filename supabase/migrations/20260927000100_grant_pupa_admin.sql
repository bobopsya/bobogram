-- One-off owner request: grant service admin role to @pupa.
update public.profiles
set role = 'admin'
where lower(username) = 'pupa'
  and role <> 'admin';
