// Снимает настоящие экраны Bobogram для промо-ролика.
//
// Нужно: локальный Supabase (`npm run db:start` в корне репозитория).
// Dev-сервер Vite скрипт поднимет сам, если он ещё не запущен.
//
// Что делает:
//   1. Создаёт демо-пользователей @alex, @mia, @sam и пару чатов (только локальная база).
//   2. Снимает телефон (390×844 @3x) и ПК (1440×900 @2x) в светлой и тёмной теме.
//   3. Записывает координаты элементов в public/shots/layout.json —
//      по ним Remotion кладёт анимированные слои ровно поверх скриншотов.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const here = dirname(fileURLToPath(import.meta.url));
const videoDir = join(here, '..');
const repoDir = join(videoDir, '..');
const outDir = join(videoDir, 'public', 'shots');

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
const SUPABASE_URL = 'http://127.0.0.1:54321';
// Стандартные демо-ключи локального Supabase (не секретные, те же, что в playwright.config.ts).
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const PASSWORD = 'bobogram-demo';
const CHROMIUM = process.env.PW_CHROMIUM; // например /opt/pw-browsers/chromium-1194/chrome-linux/chrome

// В Bobogram юзернейм — от 4 символов (как в Telegram), поэтому @mia_chen и @sam_rivera.
const USERS = {
  alex: { username: 'alex', name: 'Alex Morgan', avatar: { from: '#5ab4ff', to: '#1d5fc2', glyph: 'A' } },
  mia: { username: 'mia_chen', name: 'Mia Chen', avatar: { from: '#8fd0ff', to: '#3390ec', glyph: 'M' } },
  sam: { username: 'sam_rivera', name: 'Sam Rivera', avatar: { from: '#3390ec', to: '#0b2a5b', glyph: 'S' } },
};

// Переписка в чате с Mia — та же, что рисует ролик (src/data/chat.ts).
const CHAT = {
  hello: 'Found you by @username 👋',
  question: 'Nice! Pizza tonight? 🍕',
  answer: 'Yes! 8 pm at Sam’s',
  last: 'I’ll bring the movie 🎬',
};
const OFFLINE_TEXT = 'On my way!';

const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anonClient = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// ---------- сервер приложения ----------
async function reachable(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function ensureApp() {
  if (await reachable(APP_URL)) return null;
  console.log('Запускаю Vite…');
  const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort', '--host', '127.0.0.1'], {
    cwd: repoDir,
    env: { ...process.env, VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: ANON_KEY },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    if (await reachable(APP_URL)) return vite;
    await new Promise((r) => setTimeout(r, 1000));
  }
  vite.kill();
  throw new Error('Vite не поднялся на ' + APP_URL);
}

// ---------- шрифты ----------
async function fontDataUrl(file) {
  const buf = await readFile(join(videoDir, 'node_modules', '@fontsource', file));
  return 'data:font/woff2;base64,' + buf.toString('base64');
}

// Латиница и кириллица Inter — диапазоны как в @fontsource/inter.
const RANGES = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
};

export async function fontCss() {
  const faces = [];
  for (const w of [300, 400, 500, 600, 700])
    for (const [subset, range] of Object.entries(RANGES)) {
      const url = await fontDataUrl(`inter/files/inter-${subset}-${w}-normal.woff2`);
      faces.push(
        `@font-face{font-family:'Inter';font-weight:${w};font-style:normal;unicode-range:${range};src:url(${url}) format('woff2');}`,
      );
    }
  return faces.join('\n');
}

// Inter вместо системного шрифта (на iPhone тут был бы SF Pro), без анимаций и мигающей каретки,
// чтобы кадры были стабильными.
function pageCss(fonts) {
  return `${fonts}
body, input, textarea, button, select { font-family: 'Inter', 'Noto Color Emoji', sans-serif !important; }
*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
/* Звонки в ролике не показываем. */
[aria-label="Voice call"], [aria-label="Video call"],
[aria-label="Аудиозвонок"], [aria-label="Видеозвонок"] { display: none !important; }
`;
}

// ---------- демо-данные ----------
async function makeAvatars(browser, fonts) {
  const page = await browser.newPage();
  await page.setContent(`<style>${fonts}</style><span style="font-family:Inter;font-weight:600">A</span>`);
  await page.evaluate(() => document.fonts.ready);
  const icon = await readFile(join(repoDir, 'public', 'icon.svg'), 'utf8');
  const specs = {
    ...Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, u.avatar])),
    weekend: { from: '#0b2a5b', to: '#3390ec', glyph: '⛰️' },
    books: { from: '#8fd0ff', to: '#1d5fc2', glyph: '📚' },
    tips: { svg: icon },
  };
  const result = await page.evaluate(async (specs) => {
    const out = {};
    for (const [key, s] of Object.entries(specs)) {
      const c = document.createElement('canvas');
      c.width = c.height = 320;
      const ctx = c.getContext('2d');
      if (s.svg) {
        const img = new Image();
        img.src = 'data:image/svg+xml;base64,' + btoa(s.svg);
        await img.decode();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 320, 320);
        // Иконка с закруглёнными углами: заливаем её фоном, чтобы в круге не было белых уголков.
        ctx.fillStyle = '#1591d4';
        ctx.fillRect(0, 0, 320, 320);
        ctx.drawImage(img, -24, -24, 368, 368);
      } else {
        const g = ctx.createLinearGradient(0, 0, 320, 320);
        g.addColorStop(0, s.from);
        g.addColorStop(1, s.to);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 320, 320);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const emoji = /\p{Extended_Pictographic}/u.test(s.glyph);
        ctx.font = emoji ? '150px "Noto Color Emoji"' : '600 150px Inter';
        ctx.fillText(s.glyph, 160, emoji ? 172 : 168);
      }
      out[key] = c.toDataURL('image/jpeg', 0.9);
    }
    return out;
  }, specs);
  await page.close();
  return result;
}

async function resetDemoUsers() {
  const rows = check(
    await service
      .from('profiles')
      .select('id, username')
      .in(
        'username',
        Object.values(USERS).map((u) => u.username),
      ),
  );
  for (const r of rows) {
    // Чаты, где состояли демо-пользователи, удаляем вместе с ними (только локальная база).
    const members = check(await service.from('chat_members').select('chat_id').eq('user_id', r.id));
    const ids = members.map((m) => m.chat_id);
    if (ids.length) check(await service.from('chats').delete().in('id', ids));
    check(await service.auth.admin.deleteUser(r.id));
  }
}

/**
 * Цвет имени отправителя в группах и запасной цвет аватара приложение выбирает по хешу id
 * (src/ui/Avatar.tsx, MessageBubble.tsx): 7 цветов, пятый — синий #65aadd. Подбираем id под него.
 */
function blueId() {
  for (;;) {
    const id = crypto.randomUUID();
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    if (Math.abs(h) % 7 === 5) return id;
  }
}

async function signUp(key, name = USERS[key].name) {
  const { username } = USERS[key];
  const email = `${username}-${Date.now()}@demo.bobogram.app`;
  // Как обычная регистрация (тот же триггер создаёт профиль), только с выбранным id.
  const { data, error } = await service.auth.admin.createUser({
    id: blueId(),
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { username, display_name: name },
  });
  if (error) throw new Error(`${username}: ${error.message}`);
  const client = anonClient();
  check(await client.auth.signInWithPassword({ email, password: PASSWORD }));
  return { client, id: data.user.id };
}

async function send(user, chatId, text, replyTo = null) {
  const id = crypto.randomUUID();
  check(
    await user.client.rpc('send_message', {
      p_id: id,
      p_chat: chatId,
      p_text: text,
      p_reply_to: replyTo,
      p_forwarded_from: null,
      p_call: null,
      p_media: null,
      p_topic: null,
    }),
  );
  await new Promise((r) => setTimeout(r, 1100)); // разное время у сообщений — стабильный порядок
  return id;
}

async function seedBase(avatars) {
  await resetDemoUsers();
  const u = {};
  for (const name of Object.keys(USERS)) {
    u[name] = await signUp(name);
    check(await u[name].client.from('profiles').update({ avatar: avatars[name] }).eq('id', u[name].id));
  }
  // Тёмная тема в синих тонах («Midnight») в приложении премиальная.
  check(
    await service
      .from('profiles')
      .update({ premium_until: new Date(Date.now() + 365 * 864e5).toISOString() })
      .eq('id', u.alex.id),
  );

  const createChat = async (owner, type, title, description, avatar, members) =>
    check(
      await owner.client.rpc('create_chat', {
        p_type: type,
        p_title: title,
        p_description: description,
        p_avatar: avatar,
        p_members: members,
      }),
    );

  const books = await createChat(u.sam, 'group', 'Book Club', '', avatars.books, [u.alex.id]);
  await send(u.sam, books, 'Next book: The Martian');
  const tips = await createChat(u.sam, 'channel', 'Bobogram Tips', '', avatars.tips, [u.alex.id]);
  await send(u.sam, tips, 'Tip: share your QR code to add friends fast');
  // Mia тоже в группе: в билборде она отвечает там голосовым и голосует в опросе.
  const weekend = await createChat(u.sam, 'group', 'Weekend Crew', '', avatars.weekend, [
    u.alex.id,
    u.mia.id,
  ]);
  await send(u.sam, weekend, 'Hike at 9 on Saturday ⛰️');
  const dm = check(await u.sam.client.rpc('get_or_create_private_chat', { p_other: u.alex.id }));
  await send(u.sam, dm, 'Movie night on Friday? 🍿');
  await send(u.alex, dm, 'I’m in!');
  await send(u.sam, dm, 'Great, I’ll bring popcorn');
  // Всё прочитано: зелёный бейдж непрочитанного выбивается из синей палитры ролика.
  for (const c of [books, tips, weekend, dm]) check(await u.alex.client.rpc('mark_read', { p_chat: c }));
  u.weekendId = weekend;
  return u;
}

async function seedConversation(u) {
  const chat = check(await u.alex.client.rpc('get_or_create_private_chat', { p_other: u.mia.id }));
  await send(u.mia, chat, CHAT.hello);
  check(await u.alex.client.rpc('mark_read', { p_chat: chat }));
  const question = await send(u.alex, chat, CHAT.question);
  check(await u.mia.client.rpc('mark_read', { p_chat: chat }));
  const answer = await send(u.mia, chat, CHAT.answer, {
    id: question,
    senderId: u.alex.id,
    snippet: CHAT.question,
  });
  check(await u.alex.client.rpc('toggle_reaction', { p_id: answer, p_emoji: '👍' }));
  await send(u.mia, chat, CHAT.last);
  check(await u.alex.client.rpc('mark_read', { p_chat: chat }));
}

// ---------- съёмка ----------
const appearance = (dark) => ({
  theme: dark ? 'midnight' : 'classic',
  background: 'sky',
  bubbleColor: '#3390ec',
  radius: 15,
  fontSize: 16,
});

async function newContext(browser, { dark, desktop, css, look = appearance(dark), lang = 'en', device }) {
  const context = await browser.newContext(
    device ??
      (desktop
        ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }
        : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }),
  );
  await context.addInitScript(
    ({ dark, appearance, css, lang }) => {
      localStorage.setItem('bobogram.lang', lang);
      localStorage.setItem('bobogram.theme', JSON.stringify(dark ? 'dark' : 'light'));
      localStorage.setItem('bobogram.appearance', JSON.stringify(appearance));
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      });
    },
    { dark, appearance: look, css, lang },
  );
  await context.grantPermissions([], { origin: APP_URL });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' });
  return page;
}

const rect = async (locator) => {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error('нет элемента: ' + locator);
  return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
};

async function settle(page) {
  // Курсор в пустое место, чтобы не было подсветки :hover от последнего клика.
  await page.mouse.move(page.viewportSize().width / 2, page.viewportSize().height - 120);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
}

async function shot(page, name) {
  await settle(page);
  await page.screenshot({ path: join(outDir, name) });
  console.log('  ✓', name);
}

async function login(page) {
  await page.goto(APP_URL);
  await page.locator('.field-prefix input').fill('alex');
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form .btn-primary').click();
  await page.getByPlaceholder('Search @username or chats').waitFor();
  await page.locator('.chat-item', { hasText: 'Great, I’ll bring popcorn' }).waitFor();
}

/** Экраны до появления чата с Mia: вход, список чатов, поиск. */
async function capturePhoneIntro(page, theme, layout) {
  await page.goto(APP_URL);
  await page.locator('.field-prefix input').waitFor();
  await shot(page, `phone-login-${theme}.png`);
  layout.login = {
    username: await rect(page.locator('.field-prefix input')),
    usernameBox: await rect(page.locator('.field-prefix')),
    password: await rect(page.locator('input[type="password"]')),
    button: await rect(page.locator('form .btn-primary')),
    fontSize: await page
      .locator('.field-prefix input')
      .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    paddingLeft: await page
      .locator('.field-prefix input')
      .evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft)),
    passwordPaddingLeft: await page
      .locator('input[type="password"]')
      .evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft)),
  };

  await login(page);
  await shot(page, `phone-chats-${theme}.png`);
  const search = page.getByPlaceholder('Search @username or chats');
  layout.chats = {
    search: await rect(search),
    searchBox: await rect(page.locator('.search-box')),
    fontSize: await search.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    paddingLeft: await search.evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft)),
  };

  // Поле поиска в фокусе, но ещё пустое: на нём ролик «печатает» mia.
  await search.click();
  await shot(page, `phone-search-focus-${theme}.png`);

  await search.fill('mia');
  const hit = page.locator('.list-item', { hasText: 'Mia Chen' });
  await hit.waitFor();
  // Подпись «Chats» без найденных чатов — пустой заголовок, убираем.
  await page.evaluate(() => {
    for (const c of document.querySelectorAll('.list-caption'))
      if (c.nextElementSibling?.classList.contains('list-caption')) c.style.display = 'none';
  });
  await shot(page, `phone-search-${theme}.png`);
  layout.search = { result: await rect(hit), avatar: await rect(hit.locator('.avatar')) };
}

/** Пустой чат с Mia: подложка, поверх которой ролик рисует сообщения. */
async function capturePhoneEmptyChat(page, theme, layout) {
  await page.locator('.list-item', { hasText: 'Mia Chen' }).first().click();
  await page.locator('.composer textarea').waitFor();
  await page.getByText('No messages yet. Say hi!').waitFor();
  await page.addStyleTag({ content: '.msg-row.system { visibility: hidden !important; }' });
  await shot(page, `phone-chat-empty-${theme}.png`);
  layout.chat = {
    header: await rect(page.locator('.chat-header')),
    status: await rect(page.locator('.chat-header-sub')),
    title: await rect(page.locator('.chat-header-title')),
    messages: await rect(page.locator('.messages')),
    composer: await rect(page.locator('.composer')),
    composerInput: await rect(page.locator('.composer textarea')),
    statusStyle: await page.locator('.chat-header-sub').evaluate((e) => {
      const cs = getComputedStyle(e);
      return { font: cs.fontSize, weight: cs.fontWeight, color: cs.color, lineHeight: cs.lineHeight };
    }),
    headerBg: await page.locator('.chat-header').evaluate((e) => getComputedStyle(e).backgroundColor),
  };
}

/** Чат с перепиской: эталон для нарисованных пузырей и кадры для ПК. */
async function measureMessages(page) {
  return page.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
    };
    const rows = [...document.querySelectorAll('.messages .msg-row')].reverse();
    return rows.map((row) => {
      const bubble = row.querySelector('.bubble');
      const cs = bubble ? getComputedStyle(bubble) : null;
      return {
        own: row.classList.contains('own'),
        system: row.classList.contains('system'),
        last: row.classList.contains('last'),
        row: r(row),
        bubble: r(bubble ?? row.querySelector('.pill')),
        text: (row.querySelector('.msg-text') ?? row.querySelector('.pill'))?.textContent ?? '',
        textRect: r(row.querySelector('.msg-text')),
        meta: row.querySelector('.msg-meta')?.textContent ?? '',
        metaRect: r(row.querySelector('.msg-meta')),
        reply: r(row.querySelector('.msg-reply')),
        reactions: r(row.querySelector('.reactions')),
        reaction: r(row.querySelector('.reaction')),
        tick: r(row.querySelector('.tick')),
        style: cs && {
          padding: cs.padding,
          radius: cs.borderRadius,
          font: cs.fontSize,
          lineHeight: cs.lineHeight,
          bg: cs.backgroundColor,
          color: cs.color,
          shadow: cs.boxShadow,
        },
      };
    });
  });
}

async function capturePhoneFullChat(page, theme, layout) {
  await page.reload();
  await page.locator('.bubble', { hasText: 'bring the movie' }).waitFor();
  await page.locator('.reaction').first().waitFor();
  await page.locator('.msg-reply-text', { hasText: 'Pizza' }).waitFor();
  await shot(page, `phone-chat-full-${theme}.png`);
  layout.chatFull = {
    status: await rect(page.locator('.chat-header-sub')),
    rows: await measureMessages(page),
  };
}

/** Офлайн по-настоящему: сеть выключена, сообщение ждёт в очереди с часиками, потом уходит. */
async function captureOffline(pages, layout) {
  const page = pages.dark;
  await page.context().setOffline(true);
  await page.locator('.offline-banner').waitFor();
  await page.locator('.composer textarea').fill(OFFLINE_TEXT);
  await page.keyboard.press('Enter');
  const row = page.locator('.msg-row', { hasText: OFFLINE_TEXT });
  await row.locator('.tick circle').waitFor(); // часики
  await page.locator('.composer textarea').blur();
  await shot(page, 'phone-chat-offline-dark.png');
  layout.dark.chatOffline = {
    banner: await rect(page.locator('.offline-banner')),
    rows: await measureMessages(page),
  };
  await page.context().setOffline(false);
  await page.locator('.offline-banner').waitFor({ state: 'detached' });
  await row.locator('.tick circle').waitFor({ state: 'detached', timeout: 30_000 });
  await shot(page, 'phone-chat-sent-dark.png');
  layout.dark.chatSent = { rows: await measureMessages(page) };

  await pages.light.reload();
  await pages.light.locator('.msg-row', { hasText: OFFLINE_TEXT }).waitFor();
  await pages.light.locator('.msg-reply-text', { hasText: 'Pizza' }).waitFor();
  await shot(pages.light, 'phone-chat-sent-light.png');
  layout.light.chatSent = { rows: await measureMessages(pages.light) };
}

async function captureDesktop(browser, theme, css, layout) {
  const page = await newContext(browser, { dark: theme === 'dark', desktop: true, css });
  await login(page);
  await page.locator('.chat-item', { hasText: 'Mia Chen' }).first().click();
  await page.locator('.bubble', { hasText: 'bring the movie' }).waitFor();
  await page.locator('.reaction').first().waitFor();
  await page.locator('.msg-reply-text', { hasText: 'Pizza' }).waitFor();
  await shot(page, `desktop-chat-${theme}.png`);
  layout.desktop = {
    rows: await measureMessages(page),
    sidebar: await rect(page.locator('.chat-item', { hasText: 'Mia Chen' })),
  };
  await page.context().close();
}

// ---------- билборд: сторис, опрос, голосовое, оформление ----------
const bb = (name) => join('billboard', name);

/** Картинка для сторис Mia: рисуем сами (синее небо и горы), без стоковых фото. */
async function makeStoryImage(browser, fonts, caption = 'Weekend hike') {
  const page = await browser.newPage();
  await page.setContent(`<style>${fonts}</style><span style="font-family:Inter;font-weight:700">A</span>`);
  await page.evaluate(() => document.fonts.ready);
  // Подгружаем начертания под конкретную подпись (кириллица — отдельный файл Inter).
  await page.evaluate((c) => document.fonts.load('700 120px Inter', c), caption);
  const b64 = await page.evaluate((caption) => {
    // Пропорции экрана телефона 390×844: сторис заполняет его без чёрных полей.
    const W = 1080;
    const H = 2338;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#dff1ff');
    sky.addColorStop(0.45, '#8fd0ff');
    sky.addColorStop(1, '#3390ec');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const sun = ctx.createRadialGradient(760, 520, 0, 760, 520, 420);
    sun.addColorStop(0, 'rgba(255,255,255,0.95)');
    sun.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    sun.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);
    const ridge = (points, color) => {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (const [x, y] of points) ctx.lineTo(x, y);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    ridge(
      [
        [0, 1300],
        [220, 1100],
        [380, 1210],
        [600, 960],
        [820, 1180],
        [1080, 1060],
      ],
      '#5aa6e8',
    );
    ridge(
      [
        [0, 1500],
        [260, 1280],
        [470, 1430],
        [700, 1210],
        [920, 1400],
        [1080, 1320],
      ],
      '#1d5fc2',
    );
    ridge(
      [
        [0, 1760],
        [300, 1570],
        [560, 1710],
        [820, 1540],
        [1080, 1660],
      ],
      '#0b2a5b',
    );
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '700 120px Inter';
    // Длинная подпись (по-русски) уменьшается, чтобы влезть в ширину с полями.
    const size = Math.min(120, (120 * 940) / ctx.measureText(caption).width);
    ctx.font = `700 ${size}px Inter`;
    ctx.fillText(caption, W / 2, 2020);
    return c.toDataURL('image/jpeg', 0.92).split(',')[1];
  }, caption);
  await page.close();
  return Buffer.from(b64, 'base64');
}

/** Голосовое: синтезированный WAV (без чужих записей) и полоски громкости 0..31, как считает приложение. */
function makeVoice() {
  const rate = 16000;
  const seconds = 7;
  const n = rate * seconds;
  const env = (t) => {
    // «Слоги»: несколько всплесков громкости, как у речи.
    const syll = Math.max(0, Math.sin(t * Math.PI * 2.6)) ** 0.6;
    const phrase = 0.55 + 0.45 * Math.sin(t * 1.3 + 0.6);
    const fade = Math.min(1, t * 4, (seconds - t) * 4);
    return syll * phrase * fade;
  };
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const v = env(t) * (0.6 * Math.sin(2 * Math.PI * 180 * t) + 0.3 * Math.sin(2 * Math.PI * 360 * t));
    data.writeInt16LE(Math.round(v * 0.35 * 32767), 44 + i * 2);
  }
  const bars = 48;
  const waveform = Array.from({ length: bars }, (_, i) =>
    Math.max(2, Math.round(env(((i + 0.5) / bars) * seconds) * 31)),
  );
  return { wav: data, duration: seconds, waveform };
}

async function seedBillboard(browser, fonts, u) {
  // Сторис Mia.
  const story = await makeStoryImage(browser, fonts);
  const storyPath = `${u.mia.id}/story-${crypto.randomUUID()}.jpg`;
  check(await u.mia.client.storage.from('media').upload(storyPath, story, { contentType: 'image/jpeg' }));
  check(
    await u.mia.client
      .from('stories')
      .insert({ media_path: storyPath, mime: 'image/jpeg', size: story.length, width: 1080, height: 2338 }),
  );

  // Опрос в Weekend Crew: Sam и Mia уже проголосовали, Alex голосует в ролике.
  const pollId = crypto.randomUUID();
  check(
    await u.sam.client.rpc('create_poll', {
      p_id: pollId,
      p_chat: u.weekendId,
      p_question: 'Where to hike?',
      p_options: ['Blue Lake', 'Sky Ridge', 'Pine Trail'],
      p_anonymous: false,
      p_multiple: false,
      p_topic: null,
    }),
  );
  check(await u.sam.client.rpc('vote_poll', { p_message: pollId, p_options: [1] }));
  check(await u.mia.client.rpc('vote_poll', { p_message: pollId, p_options: [1] }));
  await new Promise((r) => setTimeout(r, 1100));

  // Голосовое от Mia.
  const voice = makeVoice();
  const voicePath = `${u.mia.id}/${crypto.randomUUID()}.wav`;
  check(await u.mia.client.storage.from('media').upload(voicePath, voice.wav, { contentType: 'audio/wav' }));
  check(
    await u.mia.client.rpc('send_message', {
      p_id: crypto.randomUUID(),
      p_chat: u.weekendId,
      p_text: '',
      p_reply_to: null,
      p_forwarded_from: null,
      p_call: null,
      p_media: {
        kind: 'voice',
        path: voicePath,
        mime: 'audio/wav',
        size: voice.wav.length,
        duration: voice.duration,
        waveform: voice.waveform,
      },
      p_topic: null,
    }),
  );
  await new Promise((r) => setTimeout(r, 1100));

  // Mia отвечает в личке последней: в списке чатов нет зелёной галочки «отправлено».
  const dm = check(await u.alex.client.rpc('get_or_create_private_chat', { p_other: u.mia.id }));
  await send(u.mia, dm, 'See you there! 🙌');
  // Всё прочитано: зелёный бейдж непрочитанного выбивается из синей палитры.
  for (const c of [u.weekendId, dm]) check(await u.alex.client.rpc('mark_read', { p_chat: c }));
}

const measure = (page, selector) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
  }, selector);

async function openChatList(page) {
  await page.goto(APP_URL);
  await page.getByPlaceholder('Search @username or chats').waitFor();
  await page.locator('.chat-item', { hasText: 'Weekend Crew' }).waitFor();
}

async function openGroup(page) {
  await page.locator('.chat-item', { hasText: 'Weekend Crew' }).first().click();
  await page.locator('.poll').waitFor();
  await page.locator('.voice').waitFor();
  // Ждём, пока голосовое получит ссылку на файл (кнопка станет активной).
  await page.locator('.voice-play:not([disabled])').waitFor();
}

async function captureBillboard(browser, pages, users) {
  await mkdir(join(outDir, 'billboard'), { recursive: true });
  const fonts = await fontCss();
  await seedBillboard(browser, fonts, users);
  const out = { light: {}, dark: {} };

  // 1. Список чатов с кольцом сторис у Mia — в обеих темах, пока сторис не просмотрена.
  for (const theme of ['light', 'dark']) {
    const page = pages[theme];
    await openChatList(page);
    const bubble = page.locator('.stories-bar .story-bubble', { hasText: 'Mia' });
    await bubble.waitFor();
    await shot(page, bb(`chats-${theme}.png`));
    out[theme].chats = {
      storyBubble: await rect(bubble),
      storyAvatar: await rect(bubble.locator('.avatar')),
      group: await rect(page.locator('.chat-item', { hasText: 'Weekend Crew' })),
    };
  }

  // 2. Сторис на весь экран. Прогресс идёт по таймеру — обнуляем его, полоску рисует ролик.
  for (const theme of ['light', 'dark']) {
    const page = pages[theme];
    await page.locator('.stories-bar .story-bubble', { hasText: 'Mia' }).click();
    await page.locator('.story-photo').waitFor();
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = '.story-progress i { width: 0 !important; }';
      document.head.appendChild(s);
    });
    await page.evaluate(() => document.querySelector('.story-photo')?.decode());
    await shot(page, bb(`story-${theme}.png`));
    out[theme].story = { progress: await measure(page, '.story-progress span') };
    await page.keyboard.press('Escape');
    await page.locator('.story-viewer').waitFor({ state: 'detached' });
  }

  // 3. Группа: опрос до голоса и голосовое.
  for (const theme of ['light', 'dark']) {
    const page = pages[theme];
    await openGroup(page);
    await shot(page, bb(`group-${theme}.png`));
    out[theme].group = {
      poll: await measure(page, '.msg-row:has(.poll) .bubble'),
      voice: await measure(page, '.msg-row:has(.voice) .bubble'),
      wave: await measure(page, '.voice-wave'),
      play: await measure(page, '.voice-play'),
      options: await page.evaluate(() =>
        [...document.querySelectorAll('.poll-option')].map((el) => {
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        }),
      ),
    };
  }

  // 4. Alex голосует (по-настоящему, кликом), снимаем итоги без полос — полосы растут в ролике.
  await pages.light.locator('.poll-option', { hasText: 'Blue Lake' }).click();
  await pages.light.locator('.poll-pct').first().waitFor();
  for (const theme of ['light', 'dark']) {
    const page = pages[theme];
    if (theme === 'dark') {
      // Страница уже открыта в группе — просто перечитываем её с новыми итогами.
      await page.reload();
      await page.locator('.poll-pct').first().waitFor();
      await page.locator('.voice-play:not([disabled])').waitFor();
    }
    await page.mouse.move(195, 700);
    // Полоса голоса Alex появляется после ответа сервера — ждём её, иначе замер будет нулевым.
    await page.waitForFunction(
      () => (document.querySelector('.poll-bar')?.getBoundingClientRect().width ?? 0) > 0,
    );
    const bars = await page.evaluate(() =>
      [...document.querySelectorAll('.poll-bar')].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          x: b.x,
          y: b.y,
          w: b.width,
          h: b.height,
          color: getComputedStyle(el).backgroundColor,
          radius: getComputedStyle(el.parentElement).borderRadius,
        };
      }),
    );
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.id = 'bb-hide-bars';
      s.textContent = '.poll-bar { visibility: hidden !important; }';
      document.head.appendChild(s);
    });
    await shot(page, bb(`group-voted-${theme}.png`));
    // «Проигранное» голосовое: все полоски яркие, на кнопке пауза.
    await page.evaluate(() => {
      for (const s of document.querySelectorAll('.voice-wave span')) s.classList.add('on');
      const svg = document.querySelector('.voice-play svg');
      if (svg) svg.innerHTML = '<path d="M8 5v14M16 5v14" stroke-width="3.2" />';
    });
    await shot(page, bb(`group-played-${theme}.png`));
    out[theme].voted = { bars };
  }

  // 5. Оформление: тот же чат с Mia в разных темах, фонах и пузырях (только синие варианты).
  const variants = [
    {
      dark: false,
      appearance: { theme: 'classic', background: 'sky', bubbleColor: '#3390ec', radius: 15, fontSize: 16 },
    },
    {
      dark: false,
      appearance: { theme: 'midnight', background: 'dots', bubbleColor: '#dcecff', radius: 20, fontSize: 16 },
    },
    {
      dark: true,
      appearance: { theme: 'midnight', background: 'sky', bubbleColor: '#3390ec', radius: 15, fontSize: 16 },
    },
    {
      dark: true,
      appearance: { theme: 'midnight', background: 'plain', bubbleColor: null, radius: 8, fontSize: 16 },
    },
  ];
  out.themes = [];
  for (const [i, v] of variants.entries()) {
    // Своя вкладка на каждый вариант: оформление хранится в localStorage и читается при загрузке.
    const page = await newContext(browser, {
      dark: v.dark,
      desktop: false,
      css: pageCss(fonts),
      look: v.appearance,
    });
    await login(page);
    await page.locator('.chat-item', { hasText: 'See you there' }).first().click();
    await page.locator('.msg-reply-text', { hasText: 'Pizza' }).waitFor();
    await shot(page, bb(`theme-${i + 1}.png`));
    out.themes.push({ dark: v.dark, ...v.appearance });
    await page.context().close();
  }
  return out;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const vite = await ensureApp();
  // Серое сглаживание текста: без цветной каймы, которая видна при зуме камеры.
  const browser = await chromium.launch({
    args: ['--disable-lcd-text'],
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  });
  try {
    const fonts = await fontCss();
    const css = pageCss(fonts);
    console.log('Демо-данные…');
    const avatars = await makeAvatars(browser, fonts);
    const users = await seedBase(avatars);

    const layout = {
      phone: { viewport: { w: 390, h: 844 } },
      desktopViewport: { w: 1440, h: 900 },
      light: {},
      dark: {},
    };
    const pages = {};
    for (const theme of ['light', 'dark']) {
      console.log(`Телефон, ${theme}: вход, чаты, поиск`);
      pages[theme] = await newContext(browser, { dark: theme === 'dark', desktop: false, css });
      await capturePhoneIntro(pages[theme], theme, layout[theme]);
    }
    for (const theme of ['light', 'dark']) {
      console.log(`Телефон, ${theme}: пустой чат`);
      await capturePhoneEmptyChat(pages[theme], theme, layout[theme]);
    }
    console.log('Переписка с Mia…');
    await seedConversation(users);
    for (const theme of ['light', 'dark']) {
      console.log(`Телефон, ${theme}: чат с перепиской`);
      await capturePhoneFullChat(pages[theme], theme, layout[theme]);
      console.log(`ПК, ${theme}`);
      await captureDesktop(browser, theme, css, layout[theme]);
    }
    console.log('Офлайн: сообщение в очереди и отправка');
    await captureOffline(pages, layout);
    console.log('Билборд: сторис, опрос, голосовое, оформление');
    layout.billboard = await captureBillboard(browser, pages, users);
    await writeFile(join(outDir, 'layout.json'), JSON.stringify(layout, null, 2) + '\n');
    console.log('Готово:', outDir);
  } finally {
    await browser.close();
    vite?.kill();
  }
}

// Общие части для других сценариев съёмки (scripts/capture-ru.mjs).
export {
  APP_URL,
  CHROMIUM,
  PASSWORD,
  USERS,
  check,
  ensureApp,
  makeAvatars,
  makeStoryImage,
  measure,
  measureMessages,
  newContext,
  pageCss,
  rect,
  resetDemoUsers,
  send,
  service,
  shot,
  signUp,
};

// Запуск напрямую: node scripts/capture.mjs (при импорте ничего не снимаем).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
