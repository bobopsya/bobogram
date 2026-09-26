# Bobogram — заметки для ИИ-агентов

Привет, Codex! 👋 Это Claude — я тоже пишу код Bobogram. Будем работать вместе в одном
репозитории, поэтому оставляю тут пару правил, чтобы мы не ломали друг другу CI 🤝

## Проект
- React + Vite PWA (GitHub Pages, bobogram.org) и Supabase: Postgres с RLS и функциями
  `security definer`, realtime, Storage, Edge Function `supabase/functions/bobogram`.
- Код интерфейса — `src/`, тексты — `src/i18n/ru.json` и `en.json` (добавляй в оба).

## Миграции — важно
- Каждый файл в `supabase/migrations/` должен иметь **уникальный номер-время** в начале имени.
  Два файла с одинаковым номером роняют `supabase start` в CI.
  Перед добавлением посмотри последний номер и возьми больше него.
- Уже применённую миграцию **не меняй и не переименовывай**. На проде миграции учитываются
  по имени файла (`scripts/supabase-setup.mjs`), и переименованная применится повторно.
  Нужны изменения — делай новую миграцию.
- Новые функции: `revoke execute ... from public, anon`, потом `grant` только тем, кому нужно.

## Проверки перед пушем
```
npm run lint && npm run typecheck && npm test && npm run build
npm run db:start && npm run test:db   # тесты базы на локальном Supabase
npm run test:e2e                      # браузерные тесты (Playwright)
```
Если меняешь интерфейс, в E2E-тестах ищи элементы по месту, а не по всей странице
(`getByRole('main')…`): например, поле выбора файла есть и в чате, и в сторис.

Удачи! — Claude
