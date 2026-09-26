-- Темы в группах, как в Telegram: группа «с темами», у каждой темы своя переписка.
-- Тема «Общее» — сообщения без темы (topic_id is null).

alter table public.chats add column forum boolean not null default false;

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 64),
  emoji text check (emoji is null or char_length(emoji) between 1 and 16),
  closed boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index topics_chat on public.topics (chat_id, created_at);
alter table public.topics enable row level security;
grant select on public.topics to authenticated;
create policy topics_read on public.topics for select to authenticated using (private.can_read_chat(chat_id));

alter table public.messages add column topic_id uuid references public.topics (id) on delete cascade;
create index messages_topic on public.messages (chat_id, topic_id, created_at desc);

-- Прочитанность по темам. Ключ «Общего» — id самого чата.
create table public.topic_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  topic_key uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, topic_key)
);
alter table public.topic_reads enable row level security;

create function private.assert_topic_admin(p_chat uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  if (select type from public.chats where id = p_chat) is distinct from 'group'
     or (coalesce(private.member_role(p_chat), '') not in ('owner', 'admin') and not private.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v_me;
end $$;

create function public.set_forum(p_chat uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_topic_admin(p_chat);
  update public.chats set forum = p_on where id = p_chat;
end $$;

create function public.create_topic(p_chat uuid, p_title text, p_emoji text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_topic_admin(p_chat);
  v_id uuid;
begin
  if not (select forum from public.chats where id = p_chat) then
    raise exception 'not a forum' using errcode = '22023';
  end if;
  if (select count(*) from public.topics where chat_id = p_chat) >= 100 then
    raise exception 'too many topics' using errcode = '22023';
  end if;
  insert into public.topics (chat_id, title, emoji, created_by)
  values (p_chat, trim(p_title), nullif(trim(coalesce(p_emoji, '')), ''), v_me)
  returning id into v_id;
  return v_id;
end $$;

create function public.edit_topic(p_topic uuid, p_title text, p_emoji text, p_closed boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_topic_admin((select chat_id from public.topics where id = p_topic));
  update public.topics
  set title = trim(p_title), emoji = nullif(trim(coalesce(p_emoji, '')), ''), closed = p_closed
  where id = p_topic;
end $$;

create function public.delete_topic(p_topic uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_chat uuid := (select chat_id from public.topics where id = p_topic);
begin
  perform private.assert_topic_admin(v_chat);
  delete from public.topics where id = p_topic;
  -- Превью в списке чатов могло указывать на удалённое сообщение.
  update public.chats set last_message = (
    select jsonb_build_object(
      'id', x.id, 'text', private.snippet(x.text), 'sender_id', x.sender_id, 'created_at', x.created_at,
      'system', x.system, 'call', x.call, 'deleted', false,
      'media', case when x.media is null then null else jsonb_build_object('kind', x.media ->> 'kind') end)
    from public.messages x where x.chat_id = v_chat order by x.created_at desc limit 1)
  where id = v_chat;
end $$;

-- Список тем с последним сообщением и числом непрочитанных; первой строкой — «Общее» (id null).
create function public.get_topics(p_chat uuid)
returns table (
  id uuid, title text, emoji text, closed boolean, created_at timestamptz,
  last_message jsonb, unread int
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select cm.user_id, cm.cleared_at, cm.joined_at from public.chat_members cm
    where cm.chat_id = p_chat and cm.user_id = auth.uid()
  ),
  t as (
    select null::uuid as id, null::text as title, null::text as emoji, false as closed,
      c.created_at, p_chat as key
    from public.chats c where c.id = p_chat
    union all
    select tp.id, tp.title, tp.emoji, tp.closed, tp.created_at, tp.id
    from public.topics tp where tp.chat_id = p_chat
  )
  select t.id, t.title, t.emoji, t.closed, t.created_at,
    (select jsonb_build_object(
        'id', x.id, 'text', private.snippet(x.text), 'sender_id', x.sender_id, 'created_at', x.created_at,
        'system', x.system, 'call', x.call, 'deleted', false,
        'media', case when x.media is null then null else jsonb_build_object('kind', x.media ->> 'kind') end)
      from public.messages x, me
      where x.chat_id = p_chat and x.topic_id is not distinct from t.id
        and x.created_at > me.cleared_at and not x.deleted and not (me.user_id = any (x.deleted_for))
      order by x.created_at desc limit 1),
    (select count(*)::int from public.messages x, me
      where x.chat_id = p_chat and x.topic_id is not distinct from t.id
        and x.created_at > greatest(
          me.cleared_at, me.joined_at,
          coalesce((select r.last_read_at from public.topic_reads r where r.user_id = me.user_id and r.topic_key = t.key),
                   '-infinity'))
        and x.sender_id <> me.user_id and x.system is null and not x.deleted)
  from t
  where private.is_active() and private.can_read_chat(p_chat)
  order by t.id is not null, t.created_at
$$;

create function public.mark_topic_read(p_chat uuid, p_topic uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  if private.member_role(p_chat) is null then return; end if;
  if p_topic is not null and not exists (select 1 from public.topics where id = p_topic and chat_id = p_chat) then
    return;
  end if;
  insert into public.topic_reads (user_id, topic_key, last_read_at) values (v_me, coalesce(p_topic, p_chat), now())
  on conflict (user_id, topic_key) do update set last_read_at = now();
end $$;

-- Сообщения одной темы (p_filter_topic): p_topic null — «Общее».
drop function public.get_messages(uuid, timestamptz, int);
create function public.get_messages(
  p_chat uuid, p_before timestamptz default null, p_count int default 50,
  p_topic uuid default null, p_filter_topic boolean default false
)
returns setof public.messages
language sql stable security definer set search_path = '' as $$
  select m.*
  from public.messages m
  join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = auth.uid()
  where private.is_active()
    and m.chat_id = p_chat
    and m.created_at > cm.cleared_at
    and (p_before is null or m.created_at < p_before)
    and (not p_filter_topic or m.topic_id is not distinct from p_topic)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_count, 50), 200))
$$;

-- Отправка в тему. В закрытую пишут только админы.
drop function public.send_message(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb);
create function public.send_message(
  p_id uuid, p_chat uuid, p_text text,
  p_reply_to jsonb default null, p_forwarded_from jsonb default null, p_call jsonb default null,
  p_media jsonb default null, p_topic uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_type text;
  v_role text := private.member_role(p_chat);
  v_other uuid;
  v_media jsonb;
  v_topic public.topics;
begin
  -- Повторная отправка из офлайн-очереди — ничего не делаем.
  if exists (select 1 from public.messages where id = p_id) then return p_id; end if;
  select type into v_type from public.chats where id = p_chat;
  if v_role is null then raise exception 'not a member' using errcode = '42501'; end if;
  if v_type = 'channel' and v_role = 'member' then raise exception 'read only' using errcode = '42501'; end if;
  if v_type = 'private' then
    select user_id into v_other from public.chat_members where chat_id = p_chat and user_id <> v_me;
    if private.is_blocked_by(v_other) then raise exception 'blocked' using errcode = '42501'; end if;
  end if;
  if p_topic is not null then
    select * into v_topic from public.topics where id = p_topic and chat_id = p_chat;
    if v_topic.id is null then raise exception 'bad topic' using errcode = '22023'; end if;
    if v_topic.closed and v_role = 'member' and not private.is_admin() then
      raise exception 'topic closed' using errcode = '42501';
    end if;
  end if;
  v_media := private.clean_media(p_media, v_me);
  if p_call is null and v_media is null and char_length(trim(coalesce(p_text, ''))) = 0 then
    raise exception 'empty' using errcode = '22023';
  end if;
  insert into public.messages (id, chat_id, sender_id, text, reply_to, forwarded_from, call, media, topic_id)
  values (p_id, p_chat, v_me, coalesce(p_text, ''), p_reply_to, p_forwarded_from, p_call, v_media, p_topic);
  return p_id;
end $$;

-- Список чатов: знает, что группа с темами.
drop function public.get_chats(uuid);
create function public.get_chats(p_chat uuid default null)
returns table (
  id uuid, type text, title text, description text, avatar text, owner_id uuid, invite_code text,
  pinned_message_ids uuid[], last_message jsonb, created_at timestamptz, updated_at timestamptz,
  my_role text, last_read_at timestamptz, pinned boolean, muted boolean, cleared_at timestamptz,
  unread int, member_count int, other_id uuid, others_read_at timestamptz,
  verified boolean, scam boolean, forum boolean
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
    c.verified, c.scam, c.forum
  from public.chats c
  left join public.chat_members m on m.chat_id = c.id and m.user_id = auth.uid()
  where private.is_active() and (
    (p_chat is null and m.user_id is not null)
    or (c.id = p_chat and (m.user_id is not null or (private.is_admin() and c.type in ('group', 'channel'))))
  )
$$;

alter publication supabase_realtime add table public.topics;

revoke execute on function
  private.assert_topic_admin(uuid), public.set_forum(uuid, boolean), public.create_topic(uuid, text, text),
  public.edit_topic(uuid, text, text, boolean), public.delete_topic(uuid), public.get_topics(uuid),
  public.mark_topic_read(uuid, uuid), public.get_messages(uuid, timestamptz, int, uuid, boolean),
  public.send_message(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid), public.get_chats(uuid)
from public, anon;
revoke execute on function private.assert_topic_admin(uuid) from authenticated;
grant execute on function
  public.set_forum(uuid, boolean), public.create_topic(uuid, text, text),
  public.edit_topic(uuid, text, text, boolean), public.delete_topic(uuid), public.get_topics(uuid),
  public.mark_topic_read(uuid, uuid), public.get_messages(uuid, timestamptz, int, uuid, boolean),
  public.send_message(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid), public.get_chats(uuid)
to authenticated;
