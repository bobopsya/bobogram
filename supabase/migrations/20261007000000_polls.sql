-- Опросы: сообщение с вопросом и вариантами; голоса — в poll_votes, итоги — прямо в сообщении
-- (messages.poll.counts), чтобы все видели их через realtime без доступа к чужим голосам.

alter table public.messages add column poll jsonb;

create table public.poll_votes (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  option smallint not null check (option between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, option)
);
alter table public.poll_votes enable row level security;
grant select on public.poll_votes to authenticated;
-- Свои голоса видно (чтобы отметить выбранное), чужие — только через get_poll_voters у открытых опросов.
create policy poll_votes_own on public.poll_votes for select to authenticated using (user_id = auth.uid());

create function public.create_poll(
  p_id uuid, p_chat uuid, p_question text, p_options text[],
  p_anonymous boolean default true, p_multiple boolean default false, p_topic uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_options text[];
begin
  if (select type from public.chats where id = p_chat) not in ('group', 'channel') then
    raise exception 'polls only in groups' using errcode = '22023';
  end if;
  select array_agg(left(trim(o), 100)) into v_options from unnest(p_options) o where trim(o) <> '';
  if char_length(trim(coalesce(p_question, ''))) = 0 or coalesce(array_length(v_options, 1), 0) not between 2 and 10 then
    raise exception 'bad poll' using errcode = '22023';
  end if;
  -- Все проверки прав — как у обычного сообщения.
  perform public.send_message(p_id, p_chat, left(trim(p_question), 300), null, null, null, null, p_topic);
  update public.messages set poll = jsonb_build_object(
    'question', left(trim(p_question), 300), 'options', to_jsonb(v_options),
    'anonymous', coalesce(p_anonymous, true), 'multiple', coalesce(p_multiple, false),
    'counts', (select jsonb_agg(0) from unnest(v_options)), 'voters', 0)
  where id = p_id;
  return p_id;
end $$;

-- Голос (пустой массив — отозвать). Итоги пересчитываются в самом сообщении.
create function public.vote_poll(p_message uuid, p_options int[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_msg public.messages;
  v_n int;
begin
  select * into v_msg from public.messages where id = p_message;
  if v_msg.poll is null or v_msg.deleted or private.member_role(v_msg.chat_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_n := jsonb_array_length(v_msg.poll -> 'options');
  if exists (select 1 from unnest(p_options) o where o < 0 or o >= v_n)
     or (not (v_msg.poll ->> 'multiple')::boolean and coalesce(array_length(p_options, 1), 0) > 1) then
    raise exception 'bad vote' using errcode = '22023';
  end if;
  delete from public.poll_votes where message_id = p_message and user_id = v_me;
  insert into public.poll_votes (message_id, user_id, option)
  select p_message, v_me, o from (select distinct unnest(p_options) o) x;
  update public.messages set poll = poll || jsonb_build_object(
    'counts', (select jsonb_agg((select count(*) from public.poll_votes v where v.message_id = p_message and v.option = i)
                                 order by i) from generate_series(0, v_n - 1) i),
    'voters', (select count(distinct user_id) from public.poll_votes where message_id = p_message))
  where id = p_message;
end $$;

-- Кто за что голосовал — только в открытых (не анонимных) опросах.
create function public.get_poll_voters(p_message uuid) returns table (option int, user_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_message;
  if v_msg.poll is null or not private.can_read_chat(v_msg.chat_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (v_msg.poll ->> 'anonymous')::boolean then return; end if;
  return query select v.option::int, v.user_id from public.poll_votes v where v.message_id = p_message order by v.created_at;
end $$;

revoke execute on function
  public.create_poll(uuid, uuid, text, text[], boolean, boolean, uuid), public.vote_poll(uuid, int[]),
  public.get_poll_voters(uuid)
from public, anon;
grant execute on function
  public.create_poll(uuid, uuid, text, text[], boolean, boolean, uuid), public.vote_poll(uuid, int[]),
  public.get_poll_voters(uuid)
to authenticated;
