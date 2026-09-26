-- Фото-сторис на 24 часа.

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  media_path text not null,
  mime text not null default 'image/jpeg' check (mime like 'image/%'),
  size bigint not null default 0 check (size >= 0 and size <= 10485760),
  width int not null check (width > 0 and width <= 4000),
  height int not null check (height > 0 and height <= 4000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index stories_author_active on public.stories (author_id, expires_at desc);

create table public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;

grant select, insert, delete on public.stories to authenticated;
grant select, insert on public.story_views to authenticated;

create policy stories_select on public.stories for select to authenticated
using (expires_at > now() or author_id = auth.uid());

create policy stories_insert on public.stories for insert to authenticated
with check (
  author_id = auth.uid()
  and expires_at <= now() + interval '24 hours 5 minutes'
  and media_path ~ ('^' || auth.uid()::text || '/story-[0-9a-f-]{36}\.jpg$')
  and exists (select 1 from storage.objects where bucket_id = 'media' and name = media_path)
);

create policy stories_delete on public.stories for delete to authenticated
using (author_id = auth.uid());

create policy story_views_select on public.story_views for select to authenticated
using (viewer_id = auth.uid());

create policy story_views_insert on public.story_views for insert to authenticated
with check (
  viewer_id = auth.uid()
  and exists (select 1 from public.stories s where s.id = story_id and s.expires_at > now())
);

-- Сторис используют тот же закрытый bucket media: открыть файл можно, если сторис активна.
create or replace function private.can_see_media(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages m
    where m.media ->> 'path' = p_path and not m.deleted and private.can_read_chat(m.chat_id)
  ) or exists (
    select 1 from public.stories s
    where s.media_path = p_path and (s.expires_at > now() or s.author_id = auth.uid())
  )
$$;
