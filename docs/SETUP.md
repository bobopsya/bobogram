# Настройка Bobogram: пошаговая инструкция

Bobogram — это статический сайт на GitHub Pages. Данные хранятся в **Firebase**, пуши и TURN для звонков идут через **Cloudflare Worker**. Все сервисы работают на бесплатных тарифах, банковская карта не нужна.

Настройка занимает 30–40 минут. Делать её нужно один раз.

> Что понадобится: аккаунт Google (для Firebase), аккаунт Cloudflare (бесплатный), компьютер с установленным [Node.js 22+](https://nodejs.org/).

---

## 1. Проект Firebase

1. Откройте <https://console.firebase.google.com> и нажмите **Create a project** (Создать проект).
2. Назовите проект, например `bobogram`. **Google Analytics отключите**: он не нужен.
3. На главной странице проекта нажмите значок **`</>`** (Web), чтобы добавить веб-приложение.
   - Название: `bobogram`. Галочку «Firebase Hosting» **не ставьте**.
   - Появится блок `const firebaseConfig = {...}`. **Сохраните эти значения**, они понадобятся на шаге 6.

## 2. Вход по почте

1. В меню слева: **Build → Authentication → Get started**.
2. Вкладка **Sign-in method** → **Email/Password** → включите первый переключатель → **Save**.
3. Вкладка **Settings → Authorized domains** → **Add domain** → `bobopsya.github.io`.
4. Необязательно: вкладка **Templates** → карандаш → язык шаблона писем **Russian**.

> Вход по SMS не используется: в Firebase он требует платного плана Blaze.

## 3. Базы данных

**Firestore** (сообщения, чаты, профили):

1. **Build → Firestore Database → Create database**.
2. Расположение: `eur3 (europe-west)` или ближайшее к вам. **Изменить его потом нельзя.**
3. Режим: **Start in production mode**.

**Realtime Database** (статус «в сети» и «печатает…»):

1. **Build → Realtime Database → Create Database**.
2. Расположение: `europe-west1`. Режим: **Start in locked mode**.
3. Скопируйте адрес базы вверху страницы, например `https://bobogram-default-rtdb.europe-west1.firebasedatabase.app`.

## 4. Правила безопасности

Правила лежат в репозитории (`firebase/firestore.rules`, `firebase/database.rules.json`). Их нужно загрузить в Firebase. Без этого приложение работать не будет.

```bash
git clone https://github.com/bobopsya/bobogram.git
cd bobogram
npm install
npx firebase login                  # откроется браузер для входа в Google
npx firebase use --add              # выберите ваш проект, alias: default
npx firebase deploy --only firestore:rules,database
```

<details>
<summary>Без командной строки</summary>

- **Firestore Database → Rules**: вставьте содержимое `firebase/firestore.rules` → **Publish**.
- **Realtime Database → Rules**: вставьте содержимое `firebase/database.rules.json` → **Publish**.
</details>

## 5. Ключи для пуш-уведомлений

1. ⚙️ **Project settings → Cloud Messaging**.
2. Раздел **Web configuration → Web Push certificates → Generate key pair**. Скопируйте ключ: это **VAPID key**.
3. ⚙️ **Project settings → Service accounts → Generate new private key**. Скачается JSON-файл.
   **Никому его не показывайте и не кладите в репозиторий.** Из него понадобятся поля `client_email` и `private_key`.

## 6. Переменные в GitHub

В репозитории: **Settings → Secrets and variables → Actions → вкладка Variables → New repository variable**. Добавьте:

| Имя | Откуда взять |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` из шага 1 |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | `appId` |
| `VITE_FIREBASE_DATABASE_URL` | адрес Realtime Database из шага 3 |
| `VITE_FIREBASE_VAPID_KEY` | VAPID key из шага 5 |
| `VITE_WORKER_URL` | адрес Worker'а из шага 8 (можно добавить позже) |

> Эти значения не секретные: они всё равно попадают в код сайта. Данные защищают правила из шага 4.

## 7. Публикация сайта

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Влейте ветку с кодом в `main`, или откройте **Actions → Deploy to GitHub Pages → Run workflow**.
3. Через 1–2 минуты сайт откроется по адресу **https://bobopsya.github.io/bobogram/**.

Каждый пуш в `main` публикует новую версию автоматически.

## 8. Cloudflare Worker (пуши и звонки)

Без Worker'а чат работает, но нет пушей при закрытом приложении, а звонки через мобильный интернет могут не соединяться.

1. Зарегистрируйтесь на <https://dash.cloudflare.com/sign-up> (бесплатно).
2. В терминале, в папке репозитория:

```bash
cd worker
npm install
npx wrangler login
```

3. Откройте `worker/wrangler.toml` и впишите ваш `FIREBASE_PROJECT_ID`.
4. Добавьте секреты. Каждая команда попросит вставить значение:

```bash
npx wrangler secret put FIREBASE_CLIENT_EMAIL   # поле client_email из JSON шага 5
npx wrangler secret put FIREBASE_PRIVATE_KEY    # поле private_key целиком, от -----BEGIN до END-----\n
npx wrangler deploy
```

5. `wrangler deploy` покажет адрес вида `https://bobogram-worker.ИМЯ.workers.dev`. Добавьте его в GitHub как `VITE_WORKER_URL` (шаг 6) и перезапустите деплой (шаг 7).

### TURN-сервер для звонков

1. В панели Cloudflare: **Realtime → TURN Server → Create**.
2. Скопируйте **Turn Token ID** и **API Token**.
3. Добавьте их в Worker:

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

Бесплатно до 1000 ГБ трафика в месяц.

## 9. Назначить себя администратором

1. Зарегистрируйтесь в Bobogram.
2. В Firebase: **Firestore Database → Data → users →** ваш документ (найдите по `username`).
3. Поменяйте поле `role` с `user` на `admin`.

В меню появится **Админ-панель**. В ней можно банить пользователей и удалять группы или каналы. Личные переписки админу недоступны.

## 10. Установка на iPhone

1. Откройте сайт в **Safari**.
2. Нажмите **«Поделиться»** (квадрат со стрелкой) → **«На экран Домой»**.
3. Запустите Bobogram с иконки → **Настройки → Включить уведомления**.

Пуш-уведомления на iPhone работают только в установленном так приложении (iOS 16.4+).

На ПК (Chrome, Edge) можно установить приложение значком в адресной строке.

---

## Лимиты бесплатных тарифов

| Сервис | Лимит | На сколько хватит |
|---|---|---|
| Firestore | 50 000 чтений и 20 000 записей в день, 1 ГБ | десятки активных пользователей |
| Realtime Database | 100 одновременных подключений, 1 ГБ | 100 человек онлайн одновременно |
| Firebase Auth | без ограничений на вход по почте | — |
| Cloudflare Workers | 100 000 запросов в день | тысячи сообщений в день |
| Cloudflare TURN | 1000 ГБ в месяц | сотни часов видеозвонков |

## Разработка на своём компьютере

```bash
npm install
npm run emulators      # локальные Firebase (нужна Java 11+)
npm run dev:emu        # в другом терминале: http://127.0.0.1:5173/bobogram/
```

Письма подтверждения в эмуляторе не отправляются. Ссылки для подтверждения печатаются в терминале с эмуляторами.

Проверки:

```bash
npm run lint && npm run typecheck && npm test   # линтер, типы, юнит-тесты
npm run test:rules                              # правила Firestore на эмуляторе
npm run test:e2e                                # сквозные тесты в браузере
```

## Если что-то не работает

- **«Нужна настройка»** на сайте: не заданы переменные из шага 6, или деплой был до того, как их добавили. Перезапустите деплой.
- **Ошибка «Недостаточно прав»**: не загружены правила (шаг 4).
- **Письмо не приходит**: проверьте «Спам». Также проверьте, что `bobopsya.github.io` есть в Authorized domains (шаг 2).
- **Нет пушей на iPhone**: приложение должно быть установлено «На экран Домой», уведомления нужно включить в настройках Bobogram, а в `VITE_WORKER_URL` должен быть адрес Worker'а.
- **Звонок не соединяется**: настройте TURN (шаг 8).
