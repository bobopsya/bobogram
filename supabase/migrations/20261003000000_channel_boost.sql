-- Накрутка каналов: просмотры всем постам сразу, авто-накрутка новых постов, команды бота.

alter table public.chats
  add column auto_boost_views int not null default 0 check (auto_boost_views between 0 and 10000000),
  add column auto_boost_reactions jsonb not null default '{}';

-- Разброс ±20%, чтобы цифры выглядели естественно.
create function private.jitter(p_n int) returns int
language sql volatile as $$
  select case when coalesce(p_n, 0) <= 0 then 0 else greatest(1, round(p_n * (0.8 + random() * 0.4)))::int end
$$;

create function private.clean_reactions(p_reactions jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  v_clean jsonb := '{}';
  k text;
  v jsonb;
begin
  if jsonb_typeof(coalesce(p_reactions, '{}')) <> 'object' then
    raise exception 'bad reactions' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(coalesce(p_reactions, '{}')) loop
    if char_length(k) between 1 and 16 and jsonb_typeof(v) = 'number' and (v::text)::numeric >= 1 then
      v_clean := v_clean || jsonb_build_object(k, least((v::text)::numeric, 10000000)::int);
    end if;
  end loop;
  return v_clean;
end $$;

-- Лог накрутки отдельного поста молчит при массовой накрутке: пишем одну строку сами.
create or replace function private.log_message_boost() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('bobogram.bulk_boost', true), '') = 'on' then return null; end if;
  if auth.uid() is not null and private.is_admin()
     and (new.boost_views is distinct from old.boost_views or new.boost_reactions is distinct from old.boost_reactions) then
    perform private.bot_log('📈 Администратор ' || private.uname(auth.uid()) || ' накрутил(а) пост в «'
      || coalesce((select title from public.chats where id = new.chat_id), '') || '»: +' || new.boost_views || ' просмотров');
  end if;
  return null;
end $$;

-- +N просмотров каждому посту канала (с разбросом). Возвращает число постов.
create function public.admin_boost_channel_views(p_chat uuid, p_views int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int;
begin
  perform private.assert_admin();
  if p_views is null or p_views < 1 or p_views > 10000000 then raise exception 'bad number' using errcode = '22023'; end if;
  perform set_config('bobogram.bulk_boost', 'on', true);
  update public.messages set boost_views = boost_views + private.jitter(p_views)
  where chat_id = p_chat and system is null and not deleted
    and exists (select 1 from public.chats where id = p_chat and type = 'channel');
  get diagnostics v_n = row_count;
  perform set_config('bobogram.bulk_boost', 'off', true);
  perform private.bot_log('📈 Администратор ' || private.uname(auth.uid()) || ' накрутил(а) «'
    || coalesce((select title from public.chats where id = p_chat), '') || '»: ~+' || p_views
    || ' просмотров каждому из ' || v_n || ' постов');
  return v_n;
end $$;

-- Авто-накрутка: каждый новый пост сразу получает ~N просмотров и реакции. 0 и {} — выключить.
create function public.admin_set_auto_boost(p_chat uuid, p_views int, p_reactions jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_reactions jsonb := private.clean_reactions(p_reactions);
begin
  perform private.assert_admin();
  update public.chats
  set auto_boost_views = greatest(0, least(coalesce(p_views, 0), 10000000)), auto_boost_reactions = v_reactions
  where id = p_chat and type = 'channel';
  if not found then raise exception 'not a channel' using errcode = '22023'; end if;
  perform private.bot_log('🤖 Администратор ' || private.uname(auth.uid()) || case
    when coalesce(p_views, 0) <= 0 and v_reactions = '{}' then ' выключил(а) авто-накрутку «'
    else ' включил(а) авто-накрутку «' end
    || coalesce((select title from public.chats where id = p_chat), '') || '»'
    || case when coalesce(p_views, 0) > 0 then ': ~' || p_views || ' просмотров на пост' else '' end);
end $$;

create function private.apply_auto_boost() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_chat public.chats;
  k text;
  v jsonb;
  v_r jsonb := '{}';
begin
  if new.system is not null or new.call is not null then return new; end if;
  select * into v_chat from public.chats where id = new.chat_id;
  if v_chat.type <> 'channel' or (v_chat.auto_boost_views <= 0 and v_chat.auto_boost_reactions = '{}') then
    return new;
  end if;
  new.boost_views := new.boost_views + private.jitter(v_chat.auto_boost_views);
  for k, v in select * from jsonb_each(v_chat.auto_boost_reactions) loop
    v_r := v_r || jsonb_build_object(k, private.jitter((v::text)::int));
  end loop;
  new.boost_reactions := v_r;
  return new;
end $$;
create trigger messages_auto_boost before insert on public.messages
  for each row execute function private.apply_auto_boost();

-- ============ команды бота ============
-- /boost <канал> N, /boostviews <канал> N, /autoboost <канал> N (0 — выключить).
-- Канал — название или ссылка-приглашение (…#/join/КОД).
create function private.find_channel(p_ref text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ref text := trim(coalesce(p_ref, ''));
  v_code text := substring(v_ref from 'join/([A-Za-z0-9_-]+)');
  v_id uuid;
begin
  if v_code is not null then
    select id into v_id from public.chats where invite_code = v_code and type = 'channel';
    return v_id;
  end if;
  select id into v_id from public.chats where type = 'channel' and lower(title) = lower(trim(both '«»"' from v_ref)) limit 1;
  return v_id;
end $$;

create function private.run_boost_command(p_msg public.messages, p_cmd text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rest text := trim(regexp_replace(p_msg.text, '^/[A-Za-z_]+(@bobotools)?', '', 'i'));
  v_num int := nullif(substring(v_rest from '(\d+)\s*$'), '')::int;
  v_ref text := trim(regexp_replace(v_rest, '\s*\d+\s*$', ''));
  v_chat uuid;
  v_title text;
  v_n int;
begin
  if not private.is_admin() then
    perform private.bot_say(p_msg.chat_id, '⛔ Команда доступна только администраторам сервиса');
    return;
  end if;
  v_chat := private.find_channel(v_ref);
  if v_chat is null or v_num is null then
    perform private.bot_say(p_msg.chat_id, '❓ Пример: /' || p_cmd || ' Название канала 500 (или ссылка-приглашение вместо названия)');
    return;
  end if;
  select title into v_title from public.chats where id = v_chat;
  case p_cmd
  when 'boost' then
    perform public.admin_boost_members(v_chat, v_num);
    perform private.bot_say(p_msg.chat_id, '📈 «' || v_title || '»: накрутка подписчиков = ' || v_num);
  when 'boostviews' then
    v_n := public.admin_boost_channel_views(v_chat, v_num);
    perform private.bot_say(p_msg.chat_id, '📈 «' || v_title || '»: ~+' || v_num || ' просмотров каждому из ' || v_n || ' постов');
  when 'autoboost' then
    perform public.admin_set_auto_boost(v_chat, v_num, (select auto_boost_reactions from public.chats where id = v_chat));
    perform private.bot_say(p_msg.chat_id, case when v_num > 0
      then '🤖 «' || v_title || '»: каждому новому посту ~' || v_num || ' просмотров'
      else '🤖 «' || v_title || '»: авто-накрутка выключена' end);
  end case;
exception when others then
  perform private.bot_say(p_msg.chat_id, '❌ Не получилось: ' || sqlerrm);
end $$;

create or replace function private.on_command() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cmd text := lower(substring(new.text from '^/([A-Za-z_]+)'));
begin
  if new.sender_id is distinct from private.bot_id()
     and exists (select 1 from public.chats where id = new.chat_id and type in ('group', 'channel')) then
    if v_cmd in ('boost', 'boostviews', 'autoboost') then
      perform private.run_boost_command(new, v_cmd);
    else
      perform private.run_command(new);
      if v_cmd = 'help' then
        perform private.bot_say(new.chat_id, E'📈 Накрутка каналов (админы сервиса):\n'
          || E'/boost Канал 500 — подписчики\n/boostviews Канал 1000 — просмотры всем постам\n'
          || '/autoboost Канал 300 — просмотры каждому новому посту (0 — выключить)');
      end if;
    end if;
  end if;
  return null;
end $$;

revoke execute on function
  private.jitter(int), private.clean_reactions(jsonb), private.apply_auto_boost(), private.find_channel(text),
  private.run_boost_command(public.messages, text), public.admin_boost_channel_views(uuid, int),
  public.admin_set_auto_boost(uuid, int, jsonb)
from public, anon;
revoke execute on function
  private.jitter(int), private.clean_reactions(jsonb), private.apply_auto_boost(), private.find_channel(text),
  private.run_boost_command(public.messages, text)
from authenticated;
grant execute on function public.admin_boost_channel_views(uuid, int), public.admin_set_auto_boost(uuid, int, jsonb)
to authenticated;
