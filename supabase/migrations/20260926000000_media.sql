-- Фото и голосовые сообщения.
-- Файлы лежат в закрытом бакете media по пути <uid отправителя>/<uuid>.<ext>.
-- Загружать можно только в свою папку; скачивать — тем, кто видит сообщение с этим файлом.

alter table public.messages add column media jsonb;
create index messages_media_path on public.messages ((media ->> 'path')) where media is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 10485760, array['image/*', 'audio/*'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Файл виден, если он есть в неудалённом сообщении чата, который пользователь может читать.
create function private.can_see_media(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages m
    where m.media ->> 'path' = p_path and not m.deleted and private.can_read_chat(m.chat_id)
  )
$$;

create policy media_upload on storage.objects for insert to authenticated
with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy media_read on storage.objects for select to authenticated
using (bucket_id = 'media' and (owner_id = (select auth.uid())::text or private.can_see_media(name)));

-- Удалённое для всех сообщение теряет и вложение.
create function private.clear_deleted_media() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted and not old.deleted then new.media := null; end if;
  return new;
end $$;
create trigger messages_clear_media before update on public.messages
  for each row execute function private.clear_deleted_media();

-- Превью в списке чатов: вид вложения.
create or replace function private.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chats set
    last_message = jsonb_build_object(
      'id', new.id, 'text', private.snippet(new.text), 'sender_id', new.sender_id,
      'created_at', new.created_at, 'system', new.system, 'call', new.call, 'deleted', false,
      'media', case when new.media is null then null else jsonb_build_object('kind', new.media ->> 'kind') end),
    updated_at = new.created_at
  where id = new.chat_id;
  update public.chat_members set last_read_at = greatest(last_read_at, new.created_at)
  where chat_id = new.chat_id and user_id = new.sender_id;
  return new;
end $$;

-- Проверяет и очищает описание вложения от клиента.
create function private.clean_media(p_media jsonb, p_me uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := p_media ->> 'kind';
  v_path text := p_media ->> 'path';
  v_wave jsonb := p_media -> 'waveform';
begin
  if p_media is null then return null; end if;
  if v_kind not in ('photo', 'voice') or v_path is null or v_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$' then
    raise exception 'bad media' using errcode = '22023';
  end if;
  -- Свой загруженный файл или файл из сообщения, которое я вижу (пересылка).
  if not exists (select 1 from storage.objects where bucket_id = 'media' and name = v_path)
     or not (split_part(v_path, '/', 1) = p_me::text or private.can_see_media(v_path)) then
    raise exception 'bad media' using errcode = '22023';
  end if;
  if jsonb_typeof(v_wave) is distinct from 'array' or jsonb_array_length(v_wave) > 100 then v_wave := null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'kind', v_kind,
    'path', v_path,
    'mime', left(p_media ->> 'mime', 60),
    'size', (p_media ->> 'size')::bigint,
    'width', (p_media ->> 'width')::int,
    'height', (p_media ->> 'height')::int,
    'duration', (p_media ->> 'duration')::numeric,
    'waveform', v_wave
  ));
end $$;

drop function public.send_message(uuid, uuid, text, jsonb, jsonb, jsonb);
create function public.send_message(
  p_id uuid, p_chat uuid, p_text text,
  p_reply_to jsonb default null, p_forwarded_from jsonb default null, p_call jsonb default null,
  p_media jsonb default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_type text;
  v_role text := private.member_role(p_chat);
  v_other uuid;
  v_media jsonb;
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
  v_media := private.clean_media(p_media, v_me);
  if p_call is null and v_media is null and char_length(trim(coalesce(p_text, ''))) = 0 then
    raise exception 'empty' using errcode = '22023';
  end if;
  insert into public.messages (id, chat_id, sender_id, text, reply_to, forwarded_from, call, media)
  values (p_id, p_chat, v_me, coalesce(p_text, ''), p_reply_to, p_forwarded_from, p_call, v_media);
  return p_id;
end $$;

-- Подпись к фото можно стереть при правке.
create or replace function public.edit_message(p_id uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := private.assert_active();
  v_msg public.messages;
begin
  select * into v_msg from public.messages where id = p_id;
  if v_msg.sender_id is distinct from v_me or v_msg.deleted or v_msg.system is not null or v_msg.call is not null
     or private.member_role(v_msg.chat_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_msg.media is null and char_length(trim(p_text)) = 0 then raise exception 'empty' using errcode = '22023'; end if;
  update public.messages set text = p_text, edited_at = now() where id = p_id;
  update public.chats set last_message = last_message || jsonb_build_object('text', private.snippet(p_text))
  where id = v_msg.chat_id and last_message ->> 'id' = p_id::text;
end $$;

revoke execute on function
  private.can_see_media(text), private.clean_media(jsonb, uuid), private.clear_deleted_media(),
  public.send_message(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb)
from public, anon;
-- can_see_media вызывается из политики хранилища от имени пользователя.
grant execute on function private.can_see_media(text) to authenticated;
revoke execute on function private.clean_media(jsonb, uuid) from authenticated;
grant execute on function public.send_message(uuid, uuid, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
