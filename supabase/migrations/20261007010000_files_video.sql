-- Видео, файлы и видеокружочки. Лимит файла — 50 МБ.

update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array['image/*', 'audio/*', 'video/*', 'application/*', 'text/*']
where id = 'media';

create or replace function private.clean_media(p_media jsonb, p_me uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := p_media ->> 'kind';
  v_path text := p_media ->> 'path';
  v_wave jsonb := p_media -> 'waveform';
begin
  if p_media is null then return null; end if;
  if v_kind not in ('photo', 'voice', 'video', 'file', 'video_note') or v_path is null
     or v_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,8}$' then
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
    'mime', left(p_media ->> 'mime', 100),
    'name', left(p_media ->> 'name', 200),
    'size', (p_media ->> 'size')::bigint,
    'width', (p_media ->> 'width')::int,
    'height', (p_media ->> 'height')::int,
    'duration', (p_media ->> 'duration')::numeric,
    'waveform', v_wave
  ));
end $$;
