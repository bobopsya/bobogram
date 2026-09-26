-- Устройства пользователей для отладки: IP, браузер и система, версия приложения, PWA, пуши.
-- Пишет само приложение при входе (report_device), читают только админы сервиса (admin_user_devices).
-- Владельца, основателей и со-владельцев видят только они сами (private.may_manage).
-- С кого не собираем вовсе — profiles.no_metrics (@bobo, @pupa, @lvo75 по просьбе владельца).
-- Блокировки по IP и устройству: вход с них — автоматический бан аккаунта.

alter table public.profiles add column no_metrics boolean not null default false;
update public.profiles set no_metrics = true where lower(username) in ('bobo', 'pupa', 'lvo75');

create table public.device_bans (
  kind text not null check (kind in ('ip', 'device')),
  value text not null check (char_length(value) between 3 and 64),
  reason text,
  banned_user uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (kind, value)
);
alter table public.device_bans enable row level security;

create table public.user_devices (
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 64),
  ip text,
  country text,
  user_agent text check (char_length(user_agent) <= 512),
  info jsonb not null default '{}' check (pg_column_size(info) <= 4096),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, device_id)
);
create index user_devices_seen on public.user_devices (user_id, last_seen desc);
alter table public.user_devices enable row level security;

-- IP — из заголовков запроса (Supabase стоит за Cloudflare).
create function private.request_ip() returns text
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
    trim(split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)),
    current_setting('request.headers', true)::json ->> 'x-real-ip'
  ), '')
$$;

create function public.report_device(p_device text, p_info jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Не assert_active: с заблокированного IP он откажет раньше, чем мы забаним аккаунт.
  v_me uuid := auth.uid();
  v_headers json := current_setting('request.headers', true)::json;
begin
  if v_me is null or not private.is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then
    raise exception 'bad device' using errcode = '22023';
  end if;
  -- Заблокированное устройство или IP — бан аккаунта (админов и владельцев не трогаем).
  if not private.is_admin() and not private.is_protected(v_me) and exists (
    select 1 from public.device_bans b
    where (b.kind = 'device' and b.value = p_device) or (b.kind = 'ip' and b.value = private.request_ip())
  ) then
    update public.profiles set banned = true where id = v_me and not banned;
    if found then
      perform private.bot_log('⛔ ' || private.uname(v_me) || ' забанен(а) автоматически: вход с заблокированного '
        || case when exists (select 1 from public.device_bans where kind = 'device' and value = p_device)
             then 'устройства' else 'IP ' || coalesce(private.request_ip(), '?') end);
    end if;
    return;
  end if;
  if (select no_metrics from public.profiles where id = v_me) then return; end if;
  insert into public.user_devices (user_id, device_id, ip, country, user_agent, info)
  values (v_me, p_device, private.request_ip(), v_headers ->> 'cf-ipcountry',
          left(v_headers ->> 'user-agent', 512), coalesce(p_info, '{}'))
  on conflict (user_id, device_id) do update
  set ip = excluded.ip, country = excluded.country, user_agent = excluded.user_agent,
      info = excluded.info, last_seen = now();
  -- Храним последние 10 устройств.
  delete from public.user_devices d
  where d.user_id = v_me and d.device_id not in (
    select x.device_id from public.user_devices x where x.user_id = v_me order by x.last_seen desc limit 10);
end $$;

create function public.admin_user_devices(p_user uuid)
returns table (
  device_id text, ip text, country text, user_agent text, info jsonb,
  first_seen timestamptz, last_seen timestamptz, device_banned boolean, ip_banned boolean
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if not private.may_manage(auth.uid(), p_user) then
    raise exception 'protected user' using errcode = '42501';
  end if;
  return query
    select d.device_id, d.ip, d.country, d.user_agent, d.info, d.first_seen, d.last_seen,
      exists (select 1 from public.device_bans b where b.kind = 'device' and b.value = d.device_id),
      exists (select 1 from public.device_bans b where b.kind = 'ip' and b.value = d.ip)
    from public.user_devices d where d.user_id = p_user order by d.last_seen desc;
end $$;

-- Блокировка IP или устройства пользователя (значение берём из его устройств, а не от клиента).
create function public.admin_ban_device(p_user uuid, p_device text, p_kind text, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_value text;
begin
  perform private.assert_admin();
  if not private.may_manage(auth.uid(), p_user) or p_user = auth.uid() then
    raise exception 'protected user' using errcode = '42501';
  end if;
  select case p_kind when 'ip' then d.ip when 'device' then d.device_id end into v_value
  from public.user_devices d where d.user_id = p_user and d.device_id = p_device;
  if v_value is null then raise exception 'bad device' using errcode = '22023'; end if;
  if p_on then
    insert into public.device_bans (kind, value, banned_user, created_by) values (p_kind, v_value, p_user, auth.uid())
    on conflict (kind, value) do nothing;
    update public.profiles set banned = true where id = p_user;
  else
    delete from public.device_bans where kind = p_kind and value = v_value;
  end if;
  perform private.bot_log(case when p_on then '⛔ ' else '🕊 ' end || 'Администратор ' || private.uname(auth.uid())
    || case when p_on then ' заблокировал(а) ' else ' разблокировал(а) ' end
    || case p_kind when 'ip' then 'IP ' || v_value else 'устройство' end || ' пользователя ' || private.uname(p_user));
end $$;

-- Действия с заблокированного IP не проходят, даже если приложение не сообщило об устройстве.
create or replace function private.assert_active() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.device_bans where kind = 'ip' and value = private.request_ip())
     and not private.is_admin() and not private.is_protected(auth.uid()) then
    raise exception 'banned ip' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Уже собранное у тех, с кого метрику не собираем, — удалить.
delete from public.user_devices d using public.profiles p where p.id = d.user_id and p.no_metrics;

revoke execute on function private.request_ip(), public.report_device(text, jsonb), public.admin_user_devices(uuid),
  public.admin_ban_device(uuid, text, text, boolean)
from public, anon;
grant execute on function public.admin_ban_device(uuid, text, text, boolean) to authenticated;
revoke execute on function private.request_ip() from authenticated;
grant execute on function public.report_device(text, jsonb), public.admin_user_devices(uuid) to authenticated;
