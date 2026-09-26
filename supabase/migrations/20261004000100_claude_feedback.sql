-- @claude есть у всех в чатах: пишет без звука и пуша, что сюда можно присылать баги и идеи.
-- Ответы пользователей пересылаются в группу логов администрации.

-- Тихое сообщение: без пуша и без звука в приложении.
alter table public.messages add column silent boolean not null default false;

drop trigger messages_push on public.messages;
create trigger messages_push after insert on public.messages
  for each row when (new.system is null and not new.silent) execute function private.notify_push();

create or replace function private.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chats set
    last_message = jsonb_build_object(
      'id', new.id, 'text', private.snippet(new.text), 'sender_id', new.sender_id,
      'created_at', new.created_at, 'system', new.system, 'call', new.call, 'deleted', false,
      'media', case when new.media is null then null else jsonb_build_object('kind', new.media ->> 'kind') end,
      'silent', new.silent),
    updated_at = new.created_at
  where id = new.chat_id;
  update public.chat_members set last_read_at = greatest(last_read_at, new.created_at)
  where chat_id = new.chat_id and user_id = new.sender_id;
  return new;
end $$;

-- Список чатов: превью последнего сообщения знает, что оно тихое (без звука).
create or replace function public.get_chats(p_chat uuid default null)
returns table (
  id uuid, type text, title text, description text, avatar text, owner_id uuid, invite_code text,
  pinned_message_ids uuid[], last_message jsonb, created_at timestamptz, updated_at timestamptz,
  my_role text, last_read_at timestamptz, pinned boolean, muted boolean, cleared_at timestamptz,
  unread int, member_count int, other_id uuid, others_read_at timestamptz,
  verified boolean, scam boolean
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.type, c.title, c.description, c.avatar, c.owner_id,
    case when m.role in ('owner', 'admin') then c.invite_code end,
    case when m.user_id is null then c.pinned_message_ids else coalesce((
      select array_agg(p.id order by p.ord)
      from unnest(c.pinned_message_ids) with ordinality as p(id, ord)
      join public.messages pm on pm.id = p.id
      where pm.created_at > m.cleared_at
    ), '{}'::uuid[]) end,
    case when m.user_id is null then c.last_message else (
      select jsonb_build_object(
        'id', x.id, 'text', x.text, 'sender_id', x.sender_id, 'created_at', x.created_at,
        'system', x.system, 'call', x.call, 'media', x.media, 'deleted', false, 'silent', x.silent
      )
      from public.messages x
      where x.chat_id = c.id
        and x.created_at > m.cleared_at
        and not x.deleted
        and not (m.user_id = any (x.deleted_for))
      order by x.created_at desc
      limit 1
    ) end,
    c.created_at, c.updated_at,
    m.role, coalesce(m.last_read_at, now()), coalesce(m.pinned, false), coalesce(m.muted, false),
    coalesce(m.cleared_at, '1970-01-01 00:00:00+00'::timestamptz),
    case when m.user_id is null then 0 else (
      select count(*)::int from public.messages x
      where x.chat_id = c.id
        and x.created_at > greatest(m.last_read_at, m.cleared_at)
        and x.sender_id <> m.user_id
        and not x.deleted
        and not (m.user_id = any (x.deleted_for))
    ) end,
    (select count(*)::int from public.chat_members y where y.chat_id = c.id) + c.boost_members,
    case when c.type = 'private' then
      (select y.user_id from public.chat_members y where y.chat_id = c.id and y.user_id <> auth.uid() limit 1)
    end,
    (select max(y.last_read_at) from public.chat_members y where y.chat_id = c.id and y.user_id <> auth.uid()),
    c.verified, c.scam
  from public.chats c
  left join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
  where private.is_active() and (
    (p_chat is null and m.user_id is not null)
    or (c.id = p_chat and (m.user_id is not null or (private.is_admin() and c.type in ('group', 'channel'))))
  )
$$;

create function private.claude_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where lower(username) = 'claude' limit 1
$$;

create function private.claude_chat(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_claude uuid := private.claude_id();
  v_key text;
  v_id uuid;
begin
  if v_claude is null or p_user is null or p_user = v_claude then return null; end if;
  v_key := least(v_claude::text, p_user::text) || '_' || greatest(v_claude::text, p_user::text);
  insert into public.chats (type, private_key) values ('private', v_key) on conflict (private_key) do nothing;
  select id into v_id from public.chats where private_key = v_key;
  insert into public.chat_members (chat_id, user_id) values (v_id, v_claude), (v_id, p_user) on conflict do nothing;
  return v_id;
end $$;

create function private.claude_welcome(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_chat uuid := private.claude_chat(p_user);
begin
  if v_chat is null then return; end if;
  insert into public.messages (chat_id, sender_id, text, silent, created_at)
  values (v_chat, private.claude_id(),
    E'Привет! 👋 Я Claude — помогаю делать Bobogram.\n\n'
    || E'Нашли баг или есть идея? Напишите сюда — всё передаётся команде разработчиков 🛠',
    true, clock_timestamp());
end $$;

-- Всем, кто уже есть.
select private.claude_welcome(id) from public.profiles where not banned and not is_bot;

-- И каждому новому.
create function private.on_profile_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_bot then perform private.claude_welcome(new.id); end if;
  return null;
exception when others then
  return null;
end $$;
create trigger profiles_claude_welcome after insert on public.profiles
  for each row execute function private.on_profile_created();

-- Сообщение для @claude — в группу логов; раз в час короткий ответ «передал».
create function private.forward_feedback() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_claude uuid := private.claude_id();
begin
  if v_claude is null or new.sender_id = v_claude
     or not exists (select 1 from public.chats where id = new.chat_id and type = 'private')
     or not exists (select 1 from public.chat_members where chat_id = new.chat_id and user_id = v_claude) then
    return null;
  end if;
  perform private.bot_log('🐞 Фидбек от ' || private.uname(new.sender_id) || E':\n'
    || coalesce(nullif(new.text, ''), '')
    || case new.media ->> 'kind' when 'photo' then ' [📷 фото]' when 'voice' then ' [🎤 голосовое]' else '' end);
  if not exists (
    select 1 from public.messages
    where chat_id = new.chat_id and sender_id = v_claude and created_at > now() - interval '1 hour'
      and not silent
  ) then
    insert into public.messages (chat_id, sender_id, text, created_at)
    values (new.chat_id, v_claude, 'Спасибо! Передал команде 👍', clock_timestamp());
  end if;
  return null;
exception when others then
  return null;
end $$;
create trigger messages_feedback after insert on public.messages
  for each row when (new.system is null) execute function private.forward_feedback();

revoke execute on function
  private.claude_id(), private.claude_chat(uuid), private.claude_welcome(uuid), private.on_profile_created(),
  private.forward_feedback()
from public, anon, authenticated;
