-- bobodev: консоль владельца и основателей (tools/bobodev/bobodev.py), режим техобслуживания
-- и защита от злоупотреблений («щит»). Настройки лежат в private.config.
--   maintenance — json {on, message, until}; shield — on/off; signups — open/invite/closed.
-- «Щит» — это защита приложения от спама и ботов (лимиты, закрытая регистрация, автоблок IP).
-- От сетевого DDoS защищает то, что стоит перед сайтом (Cloudflare), — см. команду `cloudflare` в bobodev.

create function private.setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.config where key = p_key
$$;

create function private.maintenance_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((private.setting('maintenance')::jsonb ->> 'on')::boolean, false)
$$;

create function private.shield_on() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.setting('shield') = 'on', false)
$$;

create function private.assert_dev() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_active() or not private.is_owner(auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ============ приглашения для регистрации ============
create table public.signup_invites (
  code text primary key,
  uses_left int not null check (uses_left >= 0),
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.signup_invites enable row level security; -- без политик: только через функции

-- Почему сейчас нельзя зарегистрироваться (null — можно).
create function private.signup_problem(p_invite text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mode text := coalesce(private.setting('signups'), 'open');
begin
  if private.maintenance_on() then return 'maintenance'; end if;
  if v_mode = 'closed' then return 'closed'; end if;
  if private.shield_on()
     and (select count(*) from auth.users where created_at > now() - interval '10 minutes') >= 30 then
    return 'limited';
  end if;
  if v_mode = 'invite' then
    if nullif(trim(coalesce(p_invite, '')), '') is null then return 'invite_required'; end if;
    if not exists (select 1 from public.signup_invites
                   where code = lower(trim(p_invite)) and uses_left > 0 and expires_at > now()) then
      return 'invite_bad';
    end if;
  end if;
  return null;
end $$;

-- Для экрана регистрации: 'ok' или причина отказа.
create function public.signup_check(p_invite text default null) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(private.signup_problem(p_invite), 'ok')
$$;

create function private.check_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_invite text := lower(trim(coalesce(new.raw_user_meta_data ->> 'invite', '')));
  v_problem text := private.signup_problem(v_invite);
begin
  if v_problem is not null then
    raise exception 'signup %', v_problem using errcode = 'P0001';
  end if;
  if coalesce(private.setting('signups'), 'open') = 'invite' then
    update public.signup_invites set uses_left = uses_left - 1 where code = v_invite;
  end if;
  return new;
end $$;
create trigger auth_users_signup_check before insert on auth.users
  for each row execute function private.check_signup();

-- ============ состояние для всех (даже без входа) ============
create function public.get_service_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'maintenance', coalesce(private.setting('maintenance')::jsonb, '{"on": false}'::jsonb),
    'signups', coalesce(private.setting('signups'), 'open'))
$$;

-- Техобслуживание: админы работают как обычно, остальным действия закрыты.
create or replace function private.assert_active() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if private.maintenance_on() and not private.is_admin() then
    raise exception 'maintenance' using errcode = '42501';
  end if;
  if private.is_ip_banned() and not private.is_admin() and not private.is_protected(auth.uid()) then
    raise exception 'banned ip' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- ============ щит: лимит сообщений ============
create index messages_sender_recent on public.messages (sender_id, created_at desc);

create function private.check_message_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.system is null and private.shield_on() and not private.is_admin()
     and not coalesce((select is_bot from public.profiles where id = new.sender_id), false)
     and (select count(*) from public.messages
          where sender_id = new.sender_id and created_at > now() - interval '30 seconds') >= 20 then
    raise exception 'rate limit' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function private.check_message_rate();

-- ============ щит: всплеск регистраций с одного IP ============
-- Как report_device из 20261008000000_punishments.sql, плюс автоблокировка IP на час.
create or replace function public.report_device(p_device text, p_info jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Не assert_active: с заблокированного IP он откажет раньше, чем мы забаним аккаунт.
  v_me uuid := auth.uid();
  v_headers json := current_setting('request.headers', true)::json;
  v_ban record;
  v_ip text := private.request_ip();
begin
  if v_me is null or not private.is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then
    raise exception 'bad device' using errcode = '22023';
  end if;
  if not private.is_admin() and not private.is_protected(v_me) then
    if private.shield_on() and v_ip is not null and not private.is_ip_banned()
       and (select count(distinct d.user_id) from public.user_devices d
            where d.user_id <> v_me and private.norm_ip(d.ip) = private.norm_ip(v_ip)
              and d.first_seen > now() - interval '10 minutes') >= 4 then
      insert into public.device_bans (kind, value, reason, until)
      values ('ip', private.norm_ip(v_ip), 'Автоблокировка: всплеск регистраций', now() + interval '1 hour')
      on conflict (kind, value) do nothing;
      perform private.bot_log('🛡 Щит: IP ' || v_ip || ' заблокирован на час — 5 новых аккаунтов за 10 минут');
    end if;
    select b.kind, b.reason, b.until into v_ban
    from public.device_bans b
    where (b.until is null or b.until > now())
      and ((b.kind = 'device' and b.value = p_device)
           or (b.kind = 'ip' and private.norm_ip(b.value) = private.norm_ip(v_ip)))
    order by (b.until is null) desc, b.until desc nulls last
    limit 1;
    if found then
      insert into public.punishments (user_id, ban_reason, ban_until)
      values (v_me, coalesce(v_ban.reason, 'Вход с заблокированного '
                || case v_ban.kind when 'device' then 'устройства' else 'IP-адреса' end), v_ban.until)
      on conflict (user_id) do update
      set ban_reason = excluded.ban_reason, ban_until = excluded.ban_until, updated_at = now();
      update public.profiles set banned = true where id = v_me and not banned;
      if found then
        perform private.bot_log('⛔ ' || private.uname(v_me) || ' забанен(а) автоматически: вход с заблокированного '
          || case v_ban.kind when 'device' then 'устройства' else 'IP ' || coalesce(v_ip, '?') end);
      end if;
      return;
    end if;
  end if;
  if (select no_metrics from public.profiles where id = v_me) then return; end if;
  insert into public.user_devices (user_id, device_id, ip, country, user_agent, info)
  values (v_me, p_device, v_ip, v_headers ->> 'cf-ipcountry',
          left(v_headers ->> 'user-agent', 512), coalesce(p_info, '{}'))
  on conflict (user_id, device_id) do update
  set ip = excluded.ip, country = excluded.country, user_agent = excluded.user_agent,
      info = excluded.info, last_seen = now();
  -- Храним последние 10 устройств.
  delete from public.user_devices d
  where d.user_id = v_me and d.device_id not in (
    select x.device_id from public.user_devices x where x.user_id = v_me order by x.last_seen desc limit 10);
end $$;

-- ============ команды консоли (только владелец и основатели) ============
create function public.dev_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cron jsonb := '[]';
begin
  perform private.assert_dev();
  begin
    select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'active', j.active,
             'last_status', r.status, 'last_run', r.start_time) order by j.jobname), '[]')
    into v_cron
    from cron.job j
    left join lateral (select status, start_time from cron.job_run_details d
                       where d.jobid = j.jobid order by start_time desc limit 1) r on true;
  exception when others then
    v_cron := '[]';
  end;
  return private.stats() || jsonb_build_object(
    'maintenance', coalesce(private.setting('maintenance')::jsonb, '{"on": false}'::jsonb),
    'shield', private.shield_on(),
    'signups', coalesce(private.setting('signups'), 'open'),
    'invites_active', (select count(*) from public.signup_invites where uses_left > 0 and expires_at > now()),
    'device_bans', (select count(*) from public.device_bans where until is null or until > now()),
    'db_mb', (pg_database_size(current_database()) / 1048576),
    'cron', v_cron);
end $$;

create function public.dev_set_maintenance(p_on boolean, p_message text default null, p_until timestamptz default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_dev();
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 300), '');
begin
  if p_on then
    insert into private.config (key, value)
    values ('maintenance', jsonb_build_object('on', true, 'message', v_msg, 'until', p_until)::text)
    on conflict (key) do update set value = excluded.value;
  else
    delete from private.config where key = 'maintenance';
  end if;
  perform private.bot_log(case when p_on then '🛠 ' || private.uname(v_me) || ' включил(а) техобслуживание'
      || coalesce(' до ' || nullif(private.fmt_until(p_until), ''), '') || coalesce(E'\n' || v_msg, '')
    else '✅ ' || private.uname(v_me) || ' выключил(а) техобслуживание' end);
end $$;

create function public.dev_set_shield(p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_dev();
begin
  insert into private.config (key, value) values ('shield', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value;
  perform private.bot_log('🛡 ' || private.uname(v_me) || case when p_on then ' включил(а) щит' else ' выключил(а) щит' end);
end $$;

create function public.dev_set_signups(p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_dev();
begin
  if p_mode not in ('open', 'invite', 'closed') then raise exception 'bad mode' using errcode = '22023'; end if;
  insert into private.config (key, value) values ('signups', p_mode)
  on conflict (key) do update set value = excluded.value;
  perform private.bot_log('📝 ' || private.uname(v_me) || ' изменил(а) регистрацию: ' || case p_mode
    when 'open' then 'открыта' when 'invite' then 'по приглашениям' else 'закрыта' end);
end $$;

create function public.dev_invite_create(p_uses int default 1, p_days int default 7) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_dev();
  v_code text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
begin
  insert into public.signup_invites (code, uses_left, expires_at, created_by)
  values (v_code, greatest(1, least(coalesce(p_uses, 1), 1000)),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 90))), v_me);
  return v_code;
end $$;

create function public.dev_invite_list() returns table (code text, uses_left int, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_dev();
  return query select i.code, i.uses_left, i.expires_at from public.signup_invites i
    where i.uses_left > 0 and i.expires_at > now() order by i.created_at desc limit 100;
end $$;

create function public.dev_invite_revoke(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_dev();
  delete from public.signup_invites where code = lower(trim(p_code));
end $$;

create function public.dev_logs(p_limit int default 30) returns table (created_at timestamptz, body text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_dev();
  return query select m.created_at, m.text from public.messages m
    where m.chat_id = private.log_chat_id() and not m.deleted
    order by m.created_at desc limit greatest(1, least(coalesce(p_limit, 30), 200));
end $$;

create function public.dev_broadcast(p_text text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_dev();
  v_text text := left(trim(coalesce(p_text, '')), 1000);
  v_n int;
begin
  if v_text = '' then raise exception 'empty' using errcode = '22023'; end if;
  v_n := private.broadcast(v_text);
  perform private.bot_log('📣 ' || private.uname(v_me) || ' разослал(а) из консоли (' || v_n || '): ' || v_text);
  return v_n;
end $$;

-- Сам файл консоли кладёт деплой (scripts/supabase-setup.mjs); отдаём только владельцу и основателям.
create function public.dev_file(p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_dev();
  if p_name !~ '^[a-z0-9_.]{1,40}$' then raise exception 'bad name' using errcode = '22023'; end if;
  return private.setting('dev_file:' || p_name);
end $$;

revoke execute on function
  private.setting(text), private.maintenance_on(), private.shield_on(), private.assert_dev(),
  private.signup_problem(text), public.signup_check(text), private.check_signup(), public.get_service_status(),
  private.check_message_rate(), public.dev_status(), public.dev_set_maintenance(boolean, text, timestamptz),
  public.dev_set_shield(boolean), public.dev_set_signups(text), public.dev_invite_create(int, int),
  public.dev_invite_list(), public.dev_invite_revoke(text), public.dev_logs(int), public.dev_broadcast(text),
  public.dev_file(text)
from public, anon;
revoke execute on function
  private.setting(text), private.maintenance_on(), private.shield_on(), private.assert_dev(),
  private.signup_problem(text), private.check_signup(), private.check_message_rate()
from authenticated;
grant execute on function public.signup_check(text), public.get_service_status() to anon, authenticated;
grant execute on function
  public.dev_status(), public.dev_set_maintenance(boolean, text, timestamptz), public.dev_set_shield(boolean),
  public.dev_set_signups(text), public.dev_invite_create(int, int), public.dev_invite_list(),
  public.dev_invite_revoke(text), public.dev_logs(int), public.dev_broadcast(text), public.dev_file(text)
to authenticated;
