-- Форматирование сообщений: премиум-стили ({red|…}, {fire|…}, {big|…}, {small|…}, {wave|…})
-- доступны только с премиумом — у остальных сервер оставляет просто текст.

create function private.strip_premium_markup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.text ~ '\{[a-z]+\|'
     and not exists (select 1 from public.profiles where id = new.sender_id and premium_until > now()) then
    new.text := regexp_replace(new.text,
      '\{(red|orange|gold|green|teal|blue|violet|pink|fire|ocean|aurora|rainbow|big|small|wave)\|([^{}' || E'\n' || ']+)\}',
      '\2', 'g');
  end if;
  return new;
end $$;
create trigger messages_premium_markup before insert or update of text on public.messages
  for each row execute function private.strip_premium_markup();

revoke execute on function private.strip_premium_markup() from public, anon, authenticated;
