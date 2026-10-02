# Промо-ролик Bobogram

15 секунд, 1920×1080, 30 fps, 450 кадров. Ритм 120 BPM: 1 удар = 0,5 с = 15 кадров,
смены сцен и главные акценты стоят на целых ударах — музыку можно наложить без правок.

## Пересобрать одной командой

```bash
cd video && npm ci && npm run render
```

Результат: `video/out/bobogram-promo.mp4` (H.264, CRF 16, yuv420p, `+faststart`, без звука).
Скрипт в конце сам проверяет файл через ffprobe: 1920×1080, 30 fps, 450 кадров, 15,0 с.

Контрольные кадры: `npm run stills` (1 с, 8 с, 14 с) или `npm run stills -- f120,f300` (номера кадров).
Живой предпросмотр: `npm run studio`.

## Скриншоты приложения

Лежат в `public/shots/` вместе с `layout.json` (координаты полей, пузырей, кнопок —
по ним анимированные слои ложатся ровно на скриншоты). Пересъёмка нужна только если поменялся интерфейс:

```bash
npm run db:start            # в корне репозитория: локальный Supabase (нужен Docker)
cd video && npm run capture # демо-данные + скриншоты телефона и ПК, светлая и тёмная тема
```

Скрипт создаёт в **локальной** базе пользователей `@alex`, `@mia_chen`, `@sam_rivera` и чаты,
снимает телефон 390×844 @3x и ПК 1440×900 @2x. Если Playwright не находит свой Chromium,
укажите путь: `PW_CHROMIUM=/путь/к/chrome npm run capture`.

## Как устроено

| Файл                                   | Что там                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/timing.ts`, `src/lib/cues.ts` | удары и все события ролика в кадрах                                                                                                       |
| `src/lib/motion.ts`                    | одна пружина на весь ролик, ключи камеры                                                                                                  |
| `src/lib/camera.ts`                    | единая камера: сцены — её непрерывные наезды и отъезды                                                                                    |
| `src/components/`                      | `Background`, `PhoneFrame`, `BrowserFrame`, `Caption`, `TypingDots`, `QrCard`, `LangChips`, `Logo`, `ThemeToggle`, `OfflineBadge`, `Shot` |
| `src/scenes/PhoneScreen.tsx`           | экран телефона: вход → чаты → поиск                                                                                                       |
| `src/scenes/ChatThread.tsx`            | переписка: каждый пузырь — кусок настоящего скриншота отдельным слоем                                                                     |
| `src/scenes/Hud.tsx`                   | подписи, логотип, QR-карточка, переключатель темы, чипы                                                                                   |
| `scripts/capture.mjs`                  | съёмка экранов (Playwright + локальный Supabase)                                                                                          |
| `scripts/render.mjs`                   | рендер + `faststart` + проверка ffprobe                                                                                                   |

Шрифты: Inter, Noto Sans Devanagari, Noto Sans SC (SIL OFL, из `@fontsource`).
Логотип — `public/icon.svg` приложения без изменений.
