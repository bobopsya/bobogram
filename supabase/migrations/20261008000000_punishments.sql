-- Наказания: причина и срок бана и спамблока; бан аккаунта сразу блокирует его IP и устройства.
-- Раньше бан аккаунта IP и устройство не трогал: с нового устройства (инкогнито) на тот же IP
-- можно было зарегистрироваться заново, а IPv6-адрес менялся внутри одной сети.

-- Причины и срок видны только самому человеку и администраторам (profiles читают все).
create table public.punishments (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  ban_reason text check (char_length(ban_reason) <= 300),
  ban_until timestamptz,
  spam_reason text check (char_length(spam_reason) <= 300),
  updated_at timestamptz not null default now()
);
alter table public.punishments enable row level security;
grant select on public.punishments to authenticated;
create policy punishments_read on public.punishments for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

-- Блокировка IP и устройства может быть временной.
alter table public.device_bans add column until timestamptz;

-- IPv6: у одного устройства меняется хвост адреса (приватные адреса), поэтому сравниваем сеть /64.
create function private.norm_ip(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v inet;
begin
  v := p::inet;
  if family(v) = 6 then return host(network(set_masklen(v, 64))); end if;
  return host(v);
exception when others then
  return p;
end $$;

create function private.is_ip_banned() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.device_bans b
    where b.kind = 'ip' and (b.until is null or b.until > now())
      and private.norm_ip(b.value) = private.norm_ip(private.request_ip()))
$$;

create or replace function private.assert_active() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if private.is_ip_banned() and not private.is_admin() and not private.is_protected(auth.uid()) then
    raise exception 'banned ip' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Вход с заблокированного устройства или IP — бан аккаунта на тот же срок и с той же причиной.
create or replace function public.report_device(p_device text, p_info jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  -- Не assert_active: с заблокированного IP он откажет раньше, чем мы забаним аккаунт.
  v_me uuid := auth.uid();
  v_headers json := current_setting('request.headers', true)::json;
  v_ban record;
begin
  if v_me is null or not private.is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_device is null or char_length(p_device) not between 8 and 64 then
    raise exception 'bad device' using errcode = '22023';
  end if;
  if not private.is_admin() and not private.is_protected(v_me) then
    select b.kind, b.reason, b.until into v_ban
    from public.device_bans b
    where (b.until is null or b.until > now())
      and ((b.kind = 'device' and b.value = p_device)
           or (b.kind = 'ip' and private.norm_ip(b.value) = private.norm_ip(private.request_ip())))
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
          || case v_ban.kind when 'device' then 'устройства' else 'IP ' || coalesce(private.request_ip(), '?') end);
      end if;
      return;
    end if;
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

-- Бан с причиной и сроком (null — навсегда). IP и устройства берутся из того, что мы о человеке знаем.
create function public.admin_ban_user(
  p_user uuid, p_reason text, p_until timestamptz, p_ip boolean default true, p_device boolean default true
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(left(trim(coalesce(p_reason, '')), 300), '');
begin
  perform private.assert_admin();
  if p_user = auth.uid() or p_user = private.owner_id() or not private.may_manage(auth.uid(), p_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_until is not null and p_until <= now() then raise exception 'bad time' using errcode = '22023'; end if;
  insert into public.punishments (user_id, ban_reason, ban_until) values (p_user, v_reason, p_until)
  on conflict (user_id) do update set ban_reason = excluded.ban_reason, ban_until = excluded.ban_until, updated_at = now();
  -- Блокировки этого пользователя пересоздаём (срок мог поменяться); чужие правила на общем IP не ослабляем.
  delete from public.device_bans where banned_user = p_user;
  if p_ip then
    insert into public.device_bans (kind, value, reason, banned_user, created_by, until)
    select distinct 'ip', private.norm_ip(d.ip), v_reason, p_user, auth.uid(), p_until
    from public.user_devices d where d.user_id = p_user and d.ip is not null
    on conflict (kind, value) do update set
      until = case when device_bans.until is null or excluded.until is null then null
                   else greatest(device_bans.until, excluded.until) end,
      reason = coalesce(device_bans.reason, excluded.reason);
  end if;
  if p_device then
    insert into public.device_bans (kind, value, reason, banned_user, created_by, until)
    select distinct 'device', d.device_id, v_reason, p_user, auth.uid(), p_until
    from public.user_devices d where d.user_id = p_user
    on conflict (kind, value) do update set
      until = case when device_bans.until is null or excluded.until is null then null
                   else greatest(device_bans.until, excluded.until) end,
      reason = coalesce(device_bans.reason, excluded.reason);
  end if;
  update public.profiles set banned = true where id = p_user;
end $$;

-- Спамблок с причиной (срок — как раньше, в p_until; null — снять).
drop function public.admin_set_spamblock(uuid, timestamptz);
create function public.admin_set_spamblock(p_user uuid, p_until timestamptz, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  if p_user = private.owner_id() then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.punishments (user_id, spam_reason)
  values (p_user, case when p_until is null then null else nullif(left(trim(coalesce(p_reason, '')), 300), '') end)
  on conflict (user_id) do update set spam_reason = excluded.spam_reason, updated_at = now();
  update public.profiles set spam_until = p_until where id = p_user;
end $$;

-- Разбан (кто бы его ни сделал: админ, бот, срок) снимает и блокировки IP/устройств этого человека.
create function private.lift_ban_records() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.device_bans where banned_user = new.id;
  update public.punishments set ban_reason = null, ban_until = null, updated_at = now() where user_id = new.id;
  return null;
end $$;
create trigger profiles_unban after update of banned on public.profiles
  for each row when (old.banned and not new.banned) execute function private.lift_ban_records();

-- Раз в минуту: временный бан закончился — разбанить.
create function private.lift_expired_punishments() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  update public.profiles pr set banned = false from public.punishments x
  where x.user_id = pr.id and pr.banned and x.ban_until is not null and x.ban_until <= now();
  get diagnostics v_n = row_count;
  delete from public.device_bans where until is not null and until <= now();
  return v_n;
end $$;
select cron.schedule('bobogram-punishments', '* * * * *', 'select private.lift_expired_punishments()');

create or replace function public.run_scheduled_jobs() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('sent', private.flush_scheduled(), 'expired', private.expire_messages(),
                            'lifted', private.lift_expired_punishments())
$$;

-- В журнал действий — причина и срок.
create or replace function private.log_profile_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  a text := private.uname(v_actor);
  u text := '@' || new.username;
  p public.punishments;
begin
  if new.is_bot then return new; end if;
  if tg_op = 'INSERT' then
    perform private.bot_log('👤 Новый пользователь ' || u || ' (' || new.display_name || ')');
    return new;
  end if;
  -- Пользователь меняет себе @имя.
  if v_actor = new.id and new.username is distinct from old.username then
    perform private.bot_log('✏️ @' || old.username || ' теперь ' || u);
  end if;
  if v_actor is null or v_actor = new.id or not private.is_admin() then return new; end if;
  select * into p from public.punishments where user_id = new.id;

  if new.role is distinct from old.role then
    perform private.bot_log(case when new.role = 'admin'
      then '🛡️ Администратор ' || a || ' выдал(а) права администрации ' || u
      else '🛡️ Администратор ' || a || ' снял(а) права администрации с ' || u end);
  end if;
  if new.banned is distinct from old.banned then
    perform private.bot_log(case when new.banned
      then '🔨 Администратор ' || a || ' забанил(а) ' || u || ' '
        || coalesce(nullif(private.fmt_until(p.ban_until), ''), 'навсегда')
        || case when p.ban_reason is null then '' else E'\nПричина: ' || p.ban_reason end
      else '🕊 Администратор ' || a || ' разбанил(а) ' || u end);
  end if;
  if new.spam_until is distinct from old.spam_until then
    perform private.bot_log(case when new.spam_until is null or new.spam_until < now()
      then '🚫 Администратор ' || a || ' снял(а) спамблок с ' || u
      else '🚫 Администратор ' || a || ' выдал(а) спамблок ' || u || ' ' || private.fmt_until(new.spam_until)
        || case when p.spam_reason is null then '' else E'\nПричина: ' || p.spam_reason end end);
  end if;
  if new.premium_until is distinct from old.premium_until then
    perform private.bot_log(case when new.premium_until is null or new.premium_until < now()
      then '⭐ Администратор ' || a || ' снял(а) премиум с ' || u
      else '⭐ Администратор ' || a || ' выдал(а) премиум ' || u || ' ' || private.fmt_until(new.premium_until) end);
  end if;
  if new.verified is distinct from old.verified then
    perform private.bot_log('✅ Администратор ' || a || case when new.verified then ' выдал(а) галочку ' else ' снял(а) галочку с ' end || u);
  end if;
  if new.scam is distinct from old.scam then
    perform private.bot_log('⚠️ Администратор ' || a || case when new.scam then ' пометил(а) SCAM ' else ' снял(а) метку SCAM с ' end || u);
  end if;
  if new.profile_locked is distinct from old.profile_locked then
    perform private.bot_log('🔒 Администратор ' || a || case when new.profile_locked
      then ' запретил(а) менять профиль ' else ' разрешил(а) менять профиль ' end || u);
  end if;
  if new.display_name is distinct from old.display_name or new.username is distinct from old.username
     or new.bio is distinct from old.bio or new.avatar is distinct from old.avatar then
    perform private.bot_log('✏️ Администратор ' || a || ' изменил(а) профиль @' || old.username
      || case when new.username is distinct from old.username then ' → ' || u else '' end);
  end if;
  if new.name_color is distinct from old.name_color or new.emoji_status is distinct from old.emoji_status
     or new.profile_bg is distinct from old.profile_bg then
    perform private.bot_log('🎨 Администратор ' || a || ' изменил(а) стиль профиля ' || u);
  end if;
  return new;
end $$;

revoke execute on function
  private.norm_ip(text), private.is_ip_banned(), private.lift_ban_records(), private.lift_expired_punishments(),
  public.admin_ban_user(uuid, text, timestamptz, boolean, boolean), public.admin_set_spamblock(uuid, timestamptz, text)
from public, anon;
revoke execute on function
  private.norm_ip(text), private.is_ip_banned(), private.lift_ban_records(), private.lift_expired_punishments()
from authenticated;
grant execute on function
  public.admin_ban_user(uuid, text, timestamptz, boolean, boolean), public.admin_set_spamblock(uuid, timestamptz, text)
to authenticated;
