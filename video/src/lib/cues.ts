import { beat } from './timing';

// Все события ролика в кадрах. Смены сцен и главные акценты — на целых ударах (beat(n)),
// мелкие детали (буквы, точки пароля) идут между ударами.
export const CUE = {
  // 1. Вход (удары 0–5)
  logoGrow: -4, // пружина стартует чуть раньше нуля: первый кадр уже с иконкой
  logoDock: beat(1),
  phoneIn: 8,
  usernameFocus: beat(2),
  typeUser: [33, 36, 39, 42],
  passwordFocus: 46,
  typePass: [47, 49, 51, 53, 55, 57],
  press: beat(4),
  toList: 63,

  // 2. Поиск и QR (удары 5–10)
  zoomSearch: beat(5),
  searchFocus: 83,
  typeSearch: [88, 91, 94],
  results: 98,
  highlight: beat(7),
  zoomOut: 111,
  qrIn: beat(8),
  scan: beat(9),
  pushChat: 139,
  qrOut: 141,
  zoomChat: 143,

  // 3. Чат (удары 10–18)
  m1: beat(10),
  m2: beat(11),
  read: 176,
  m3: beat(12),
  react: beat(13),
  typing: beat(14),
  m4: beat(16),

  // 4. Везде и в двух темах (удары 18–23)
  pullBack: 264, // сразу после ухода подписи «Chats that feel alive.», чтобы телефон не наехал на текст
  browserIn: 266,
  toggleIn: beat(19),
  wipe: beat(20),

  // 5. Языки и офлайн (удары 23–25)
  browserOut: 333,
  toPhone: 336,
  chips: beat(23),
  offlineMsg: 348,
  sent: beat(24),

  // 6. Финал (удары 25–30)
  gather: beat(25),
  morph: 377,
  url: beat(27),
} as const;
