-- Очистка истории только для текущего пользователя: сообщения остаются у остальных.
alter table public.chat_members
  add column if not exists cleared_at timestamptz not null default '1970-01-01 00:00:00+00';

create or replace function public.clear_chat_for_me(p_chat uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
begin
  update public.chat_members
  set cleared_at = now(), last_read_at = now()
  where chat_id = p_chat and user_id = v_me;
  if not found then raise exception 'not a member' using errcode = '42501'; end if;
end $$;

create function public.get_messages(p_chat uuid, p_before timestamptz default null, p_count int default 50)
returns setof public.messages
language sql stable security definer set search_path = '' as $$
  select m.*
  from public.messages m
  join public.chat_members cm on cm.chat_id = m.chat_id and cm.user_id = auth.uid()
  where private.is_active()
    and m.chat_id = p_chat
    and m.created_at > cm.cleared_at
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_count, 50), 200))
$$;

drop function public.get_chats(uuid);
create function public.get_chats(p_chat uuid default null)
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
        'system', x.system, 'call', x.call, 'media', x.media, 'deleted', false
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

revoke execute on function public.clear_chat_for_me(uuid), public.get_messages(uuid, timestamptz, int) from public, anon;
grant execute on function
  public.clear_chat_for_me(uuid), public.get_messages(uuid, timestamptz, int), public.get_chats(uuid)
to authenticated;
