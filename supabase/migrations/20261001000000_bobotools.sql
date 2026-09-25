-- @bobotools: служебный бот. Пишет логи действий в лог-группу и выполняет команды в группах.
-- Всё работает внутри базы: без внешних сервисов и ключей.

-- ============ аккаунт бота ============
alter table public.profiles add column is_bot boolean not null default false;

-- Первый зарегистрированный ЧЕЛОВЕК — админ (боты не в счёт).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_username text := trim(new.raw_user_meta_data ->> 'username');
begin
  -- Флаг бота ставит только миграция, из метаданных регистрации он не берётся.
  insert into public.profiles (id, username, display_name, role)
  values (
    new.id,
    v_username,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), v_username),
    case when exists (select 1 from public.profiles where not is_bot) then 'user' else 'admin' end
  );
  return new;
end $$;

-- Аккаунт без пароля: войти в него нельзя.
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.profiles where lower(username) = 'bobotools';
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'bobotools@bot.bobogram.app', '', now(),
      '{"provider": "email", "providers": ["email"]}',
      '{"username": "bobotools", "display_name": "BoboTools"}',
      now(), now()
    );
  end if;
  update public.profiles
  set is_bot = true, role = 'user', display_name = 'BoboTools',
      bio = 'Служебный бот Bobogram. /help — список команд'
  where id = v_id;
  insert into private.config (key, value) values ('bot_id', v_id::text)
  on conflict (key) do update set value = excluded.value;
end $$;

create function private.bot_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select value::uuid from private.config where key = 'bot_id'
$$;

-- Лог-группа: группа разработчиков по названию; поменять — командой /setlogs.
do $$
declare
  v_chat uuid;
begin
  select id into v_chat from public.chats
  where type = 'group' and title ~* '(develop|девелоп|разраб)'
  order by created_at limit 1;
  if v_chat is not null then
    insert into private.config (key, value) values ('log_chat_id', v_chat::text) on conflict (key) do nothing;
    insert into public.chat_members (chat_id, user_id) values (v_chat, private.bot_id()) on conflict do nothing;
  end if;
end $$;

create function private.log_chat_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select value::uuid from private.config where key = 'log_chat_id'
$$;

-- Сообщение от бота. clock_timestamp — чтобы ответ шёл после команды из той же транзакции.
create function private.bot_say(p_chat uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_chat is null or private.bot_id() is null then return; end if;
  insert into public.messages (chat_id, sender_id, text, created_at)
  values (p_chat, private.bot_id(), left(p_text, 4096), clock_timestamp());
end $$;

create function private.bot_log(p_text text) returns void
language sql security definer set search_path = '' as $$
  select private.bot_say(private.log_chat_id(), p_text)
$$;

create function private.uname(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce('@' || (select username from public.profiles where id = p_user), 'кто-то')
$$;

create function private.fmt_until(p_until timestamptz) returns text
language sql immutable as $$
  select case when p_until is null then '' when p_until > '9000-01-01' then 'навсегда'
    else 'до ' || to_char(p_until at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') end
$$;

-- ============ логи действий ============
create function private.log_profile_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  a text := private.uname(v_actor);
  u text := '@' || new.username;
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

  if new.role is distinct from old.role then
    perform private.bot_log(case when new.role = 'admin'
      then '🛡️ Администратор ' || a || ' выдал(а) права администрации ' || u
      else '🛡️ Администратор ' || a || ' снял(а) права администрации с ' || u end);
  end if;
  if new.banned is distinct from old.banned then
    perform private.bot_log(case when new.banned then '🔨 Администратор ' || a || ' забанил(а) ' || u
      else '🕊 Администратор ' || a || ' разбанил(а) ' || u end);
  end if;
  if new.spam_until is distinct from old.spam_until then
    perform private.bot_log(case when new.spam_until is null or new.spam_until < now()
      then '🚫 Администратор ' || a || ' снял(а) спамблок с ' || u
      else '🚫 Администратор ' || a || ' выдал(а) спамблок ' || u || ' ' || private.fmt_until(new.spam_until) end);
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
create trigger profiles_log after insert or update on public.profiles
  for each row execute function private.log_profile_changes();

create function private.log_nft() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then return null; end if;
  if tg_op = 'INSERT' then
    perform private.bot_log('💎 Администратор ' || private.uname(auth.uid()) || ' выдал(а) НФТ-юзернейм @'
      || new.username || ' → ' || private.uname(new.owner_id));
  else
    perform private.bot_log('💎 Администратор ' || private.uname(auth.uid()) || ' отозвал(а) НФТ-юзернейм @'
      || old.username || ' у ' || private.uname(old.owner_id));
  end if;
  return null;
end $$;
create trigger nft_usernames_log after insert or delete on public.nft_usernames
  for each row execute function private.log_nft();

create function private.log_premium_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or new.note is distinct from old.note or new.created_at <> old.created_at) then
    perform private.bot_log('⭐ ' || private.uname(new.user_id) || ' просит премиум'
      || case when new.note <> '' then ': «' || new.note || '»' else '' end);
  end if;
  return null;
end $$;
create trigger premium_requests_log after insert or update on public.premium_requests
  for each row execute function private.log_premium_request();

create function private.log_chat_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a text := private.uname(auth.uid());
begin
  if auth.uid() is null or not private.is_admin() then return null; end if;
  if tg_op = 'DELETE' then
    if old.type in ('group', 'channel') and old.owner_id is distinct from auth.uid() then
      perform private.bot_log('🗑 Администратор ' || a || ' удалил(а) «' || coalesce(old.title, '') || '»');
    end if;
    return null;
  end if;
  if new.boost_members is distinct from old.boost_members then
    perform private.bot_log('📈 Администратор ' || a || ' накрутил(а) «' || coalesce(new.title, '') || '»: +'
      || new.boost_members || ' подписчиков');
  end if;
  if new.verified is distinct from old.verified then
    perform private.bot_log('✅ Администратор ' || a || case when new.verified then ' выдал(а) галочку «' else ' снял(а) галочку с «' end
      || coalesce(new.title, '') || '»');
  end if;
  if new.scam is distinct from old.scam then
    perform private.bot_log('⚠️ Администратор ' || a || case when new.scam then ' пометил(а) SCAM «' else ' снял(а) SCAM с «' end
      || coalesce(new.title, '') || '»');
  end if;
  return null;
end $$;
create trigger chats_log after update or delete on public.chats
  for each row execute function private.log_chat_changes();

create function private.log_message_boost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and private.is_admin()
     and (new.boost_views is distinct from old.boost_views or new.boost_reactions is distinct from old.boost_reactions) then
    perform private.bot_log('📈 Администратор ' || private.uname(auth.uid()) || ' накрутил(а) пост в «'
      || coalesce((select title from public.chats where id = new.chat_id), '') || '»: +' || new.boost_views || ' просмотров');
  end if;
  return null;
end $$;
create trigger messages_boost_log after update of boost_views, boost_reactions on public.messages
  for each row execute function private.log_message_boost();

-- Сброс пароля делает серверная функция (service_role) — она пишет лог сама.
create function public.service_log(p_text text) returns void
language sql security definer set search_path = '' as $$
  select private.bot_log(p_text)
$$;

-- ============ жалобы ============
create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_user uuid references public.profiles (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  chat_id uuid references public.chats (id) on delete set null,
  reason text not null check (reason in ('spam', 'abuse', 'scam', 'other')),
  comment text not null default '' check (char_length(comment) <= 500),
  snippet text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
create policy reports_admin_read on public.reports for select to authenticated using (private.is_admin());

create function public.report(p_user uuid, p_message uuid, p_reason text, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_msg public.messages;
  v_reason text := case p_reason when 'spam' then 'спам' when 'abuse' then 'оскорбления'
    when 'scam' then 'мошенничество' else 'другое' end;
begin
  if p_message is not null then
    select * into v_msg from public.messages where id = p_message;
    if v_msg.id is null or not private.can_read_chat(v_msg.chat_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    p_user := v_msg.sender_id;
  end if;
  if p_user is null or p_user = v_me or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'bad target' using errcode = '22023';
  end if;
  -- Не больше 10 жалоб в час от одного человека.
  if (select count(*) from public.reports where reporter_id = v_me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many reports' using errcode = '22023';
  end if;
  insert into public.reports (reporter_id, target_user, message_id, chat_id, reason, comment, snippet)
  values (v_me, p_user, v_msg.id, v_msg.chat_id, p_reason, left(trim(coalesce(p_comment, '')), 500),
          left(coalesce(v_msg.text, ''), 300));
  perform private.bot_log('🚩 Жалоба от ' || private.uname(v_me) || ' на ' || private.uname(p_user) || ' (' || v_reason || ')'
    || case when v_msg.id is not null then E'\nСообщение: «' || left(coalesce(nullif(v_msg.text, ''), '[вложение]'), 300) || '»' else '' end
    || case when trim(coalesce(p_comment, '')) <> '' then E'\nКомментарий: ' || left(trim(p_comment), 300) else '' end);
end $$;

create function public.admin_resolve_report(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  update public.reports set resolved_at = now(), resolved_by = auth.uid() where id = p_id and resolved_at is null;
end $$;

-- ============ статистика ============
create function private.stats() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'users', (select count(*) from public.profiles where not is_bot),
    'users_day', (select count(*) from public.profiles where not is_bot and created_at > now() - interval '1 day'),
    'users_week', (select count(*) from public.profiles where not is_bot and created_at > now() - interval '7 days'),
    'messages_day', (select count(*) from public.messages where system is null and created_at > now() - interval '1 day'),
    'messages_week', (select count(*) from public.messages where system is null and created_at > now() - interval '7 days'),
    'groups', (select count(*) from public.chats where type = 'group'),
    'channels', (select count(*) from public.chats where type = 'channel'),
    'premium', (select count(*) from public.profiles where premium_until > now()),
    'banned', (select count(*) from public.profiles where banned),
    'spamblocked', (select count(*) from public.profiles where spam_until > now()),
    'online_hour', (select count(*) from public.profiles where last_seen > now() - interval '1 hour'),
    'reports_open', (select count(*) from public.reports where resolved_at is null)
  )
$$;

create function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return private.stats();
end $$;

-- ============ команды ============
create function private.find_user(p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where lower(p.username) = lower(trim(both '@' from trim(coalesce(p_name, ''))))
  union all
  select n.owner_id from public.nft_usernames n
  where lower(n.username) = lower(trim(both '@' from trim(coalesce(p_name, ''))))
  limit 1
$$;

create function private.run_command(p_msg public.messages) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := p_msg.sender_id;
  v_chat public.chats;
  v_cmd text := lower(substring(p_msg.text from '^/([A-Za-z_]+)'));
  v_arg text := trim(regexp_replace(p_msg.text, '^/[A-Za-z_]+(@bobotools)?', '', 'i'));
  v_target uuid;
  v_p public.profiles;
  v_admin boolean := private.is_admin();
  v_chat_admin boolean := coalesce(private.member_role(p_msg.chat_id), '') in ('owner', 'admin');
  v_role text;
  v_n int;
  s jsonb;
begin
  select * into v_chat from public.chats where id = p_msg.chat_id;

  if v_cmd = 'help' then
    perform private.bot_say(v_chat.id, E'🤖 Команды @bobotools\n'
      || E'/invite @user — добавить в группу\n/kick @user — убрать из группы\n'
      || E'Только администраторы сервиса:\n/ban, /unban @user\n/admin, /unadmin @user\n/info @user\n/stats\n'
      || E'/broadcast текст — рассылка всем (из лог-группы)\n/setlogs — сделать эту группу лог-группой');
    return;
  end if;

  if v_cmd in ('invite', 'kick') then
    if not (v_admin or v_chat_admin) then
      perform private.bot_say(v_chat.id, '⛔ Команда доступна администраторам группы и сервиса');
      return;
    end if;
  elsif v_cmd in ('ban', 'unban', 'admin', 'unadmin', 'info', 'stats', 'broadcast', 'setlogs') then
    if not v_admin then
      perform private.bot_say(v_chat.id, '⛔ Команда доступна только администраторам сервиса');
      return;
    end if;
  else
    return; -- не наша команда — молчим
  end if;

  if v_cmd in ('invite', 'kick', 'ban', 'unban', 'admin', 'unadmin', 'info') then
    v_target := private.find_user(split_part(v_arg, ' ', 1));
    if v_target is null then
      perform private.bot_say(v_chat.id, '❓ Пользователь не найден. Пример: /' || v_cmd || ' @username');
      return;
    end if;
    select * into v_p from public.profiles where id = v_target;
  end if;

  case v_cmd
  when 'invite' then
    if exists (select 1 from public.chat_members where chat_id = v_chat.id and user_id = v_target) then
      perform private.bot_say(v_chat.id, 'ℹ️ @' || v_p.username || ' уже в группе');
      return;
    end if;
    if private.is_blocked_by(v_target) then
      perform private.bot_say(v_chat.id, '⛔ @' || v_p.username || ' заблокировал(а) вас');
      return;
    end if;
    if (select count(*) from public.chat_members where chat_id = v_chat.id)
       >= private.chat_member_limit(v_chat.type, v_chat.owner_id) then
      perform private.bot_say(v_chat.id, '⛔ В группе уже максимум участников');
      return;
    end if;
    insert into public.chat_members (chat_id, user_id) values (v_chat.id, v_target);
    perform private.insert_system(v_chat.id, v_me, jsonb_build_object('kind', 'added', 'uids', jsonb_build_array(v_target)));
  when 'kick' then
    v_role := (select role from public.chat_members where chat_id = v_chat.id and user_id = v_target);
    if v_role is null then
      perform private.bot_say(v_chat.id, 'ℹ️ @' || v_p.username || ' не в группе');
    elsif v_role = 'owner' or v_target = v_me or v_target = private.bot_id()
          or (v_role = 'admin' and not v_admin and private.member_role(v_chat.id) <> 'owner') then
      perform private.bot_say(v_chat.id, '⛔ Этого участника убрать нельзя');
    else
      delete from public.chat_members where chat_id = v_chat.id and user_id = v_target;
      perform private.insert_system(v_chat.id, v_me, jsonb_build_object('kind', 'removed', 'uid', v_target));
    end if;
  when 'ban', 'unban' then
    if v_target = v_me or v_target = private.owner_id() or v_p.is_bot then
      perform private.bot_say(v_chat.id, '⛔ Этого пользователя нельзя ' || case when v_cmd = 'ban' then 'забанить' else 'разбанить' end);
    else
      update public.profiles set banned = (v_cmd = 'ban') where id = v_target;
      perform private.bot_say(v_chat.id, case when v_cmd = 'ban' then '🔨 @' || v_p.username || ' забанен(а)'
        else '🕊 @' || v_p.username || ' разбанен(а)' end);
    end if;
  when 'admin', 'unadmin' then
    if v_target = v_me or v_target = private.owner_id() or v_p.is_bot then
      perform private.bot_say(v_chat.id, '⛔ Нельзя менять права этому пользователю');
    else
      update public.profiles set role = case when v_cmd = 'admin' then 'admin' else 'user' end where id = v_target;
      perform private.bot_say(v_chat.id, case when v_cmd = 'admin' then '🛡️ @' || v_p.username || ' теперь администратор'
        else '🛡️ @' || v_p.username || ' больше не администратор' end);
    end if;
  when 'info' then
    perform private.bot_say(v_chat.id, 'ℹ️ ' || v_p.display_name || ' @' || v_p.username
      || E'\nРегистрация: ' || to_char(v_p.created_at at time zone 'Europe/Moscow', 'DD.MM.YYYY')
      || E'\nРоль: ' || case when v_p.id = private.owner_id() then '👑 владелец' when v_p.role = 'admin' then '🛡️ админ'
                            when v_p.is_bot then '🤖 бот' else 'пользователь' end
      || case when v_p.premium_until > now() then E'\nПремиум: ' || private.fmt_until(v_p.premium_until) else '' end
      || case when v_p.banned then E'\n🔨 Забанен' else '' end
      || case when v_p.spam_until > now() then E'\n🚫 Спамблок ' || private.fmt_until(v_p.spam_until) else '' end
      || case when v_p.verified then E'\n✅ Галочка' else '' end
      || case when v_p.scam then E'\n⚠️ SCAM' else '' end
      || case when v_p.profile_locked then E'\n🔒 Профиль заблокирован' else '' end
      || coalesce(E'\n💎 ' || (select string_agg('@' || username, ', ' order by username)
                                from public.nft_usernames where owner_id = v_p.id), '')
      || E'\nЖалоб на него: ' || (select count(*) from public.reports where target_user = v_p.id));
  when 'stats' then
    s := private.stats();
    perform private.bot_say(v_chat.id, E'📊 Статистика Bobogram\n'
      || '👥 Пользователей: ' || (s ->> 'users') || ' (+' || (s ->> 'users_day') || ' за день, +' || (s ->> 'users_week') || E' за неделю)\n'
      || '💬 Сообщений: ' || (s ->> 'messages_day') || ' за день, ' || (s ->> 'messages_week') || E' за неделю\n'
      || '👨‍👩‍👧 Групп: ' || (s ->> 'groups') || ', каналов: ' || (s ->> 'channels') || E'\n'
      || '🟢 Были в сети за час: ' || (s ->> 'online_hour') || E'\n'
      || '⭐ Премиум: ' || (s ->> 'premium') || ' · 🔨 Бан: ' || (s ->> 'banned') || ' · 🚫 Спамблок: ' || (s ->> 'spamblocked') || E'\n'
      || '🚩 Открытых жалоб: ' || (s ->> 'reports_open'));
  when 'setlogs' then
    insert into private.config (key, value) values ('log_chat_id', v_chat.id::text)
    on conflict (key) do update set value = excluded.value;
    insert into public.chat_members (chat_id, user_id) values (v_chat.id, private.bot_id()) on conflict do nothing;
    perform private.bot_say(v_chat.id, '✅ Теперь логи администрации приходят сюда');
  when 'broadcast' then
    if v_chat.id is distinct from private.log_chat_id() then
      perform private.bot_say(v_chat.id, '⛔ Рассылку можно запускать только из лог-группы');
      return;
    end if;
    if v_arg = '' then
      perform private.bot_say(v_chat.id, 'Пример: /broadcast Завтра обновление!');
      return;
    end if;
    v_n := private.broadcast(v_arg);
    perform private.bot_say(v_chat.id, '📣 Рассылка отправлена: ' || v_n || ' получателей');
  end case;
exception when others then
  perform private.bot_say(p_msg.chat_id, '❌ Не получилось: ' || sqlerrm);
end $$;

-- Личка бот ↔ пользователь (создаётся при необходимости).
create function private.bot_private_chat(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_bot uuid := private.bot_id();
  v_key text := least(v_bot::text, p_user::text) || '_' || greatest(v_bot::text, p_user::text);
  v_id uuid;
begin
  insert into public.chats (type, private_key) values ('private', v_key) on conflict (private_key) do nothing;
  select id into v_id from public.chats where private_key = v_key;
  insert into public.chat_members (chat_id, user_id) values (v_id, v_bot), (v_id, p_user) on conflict do nothing;
  return v_id;
end $$;

create function private.broadcast(p_text text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_n int := 0;
begin
  for v_user in select id from public.profiles where not banned and not is_bot loop
    perform private.bot_say(private.bot_private_chat(v_user), '📣 ' || p_text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function private.on_command() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.sender_id is distinct from private.bot_id()
     and exists (select 1 from public.chats where id = new.chat_id and type in ('group', 'channel')) then
    perform private.run_command(new);
  end if;
  return null;
end $$;
create trigger messages_command after insert on public.messages
  for each row when (new.system is null and new.text ~ '^/[A-Za-z_]+') execute function private.on_command();

-- ============ права ============
revoke execute on function
  private.bot_id(), private.log_chat_id(), private.bot_say(uuid, text), private.bot_log(text), private.uname(uuid),
  private.fmt_until(timestamptz), private.log_profile_changes(), private.log_nft(), private.log_premium_request(),
  private.log_chat_changes(), private.log_message_boost(), private.stats(), private.find_user(text),
  private.run_command(public.messages), private.bot_private_chat(uuid), private.broadcast(text), private.on_command(),
  public.service_log(text), public.report(uuid, uuid, text, text), public.admin_resolve_report(bigint),
  public.admin_stats()
from public, anon, authenticated;
grant execute on function public.service_log(text) to service_role;
grant execute on function public.report(uuid, uuid, text, text), public.admin_resolve_report(bigint), public.admin_stats()
to authenticated;
