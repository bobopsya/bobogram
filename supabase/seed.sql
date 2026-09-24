-- Только для локальной разработки: база вызывает функцию пушей внутри docker-сети.
insert into private.config (key, value) values ('functions_url', 'http://kong:8000/functions/v1')
on conflict (key) do update set value = excluded.value;
