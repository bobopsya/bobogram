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
import { dirname, join } from 'node:path';
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

async function fontCss() {
  const faces = [];
  for (const w of [400, 500, 600, 700]) {
    faces.push(
      `@font-face{font-family:'Inter';font-weight:${w};font-style:normal;src:url(${await fontDataUrl(
        `inter/files/inter-latin-${w}-normal.woff2`,
      )}) format('woff2');}`,
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
[aria-label="Voice call"], [aria-label="Video call"] { display: none !important; }
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

async function signUp(key) {
  const { username, name } = USERS[key];
  const client = anonClient();
  const { data, error } = await client.auth.signUp({
    email: `${username}-${Date.now()}@demo.bobogram.app`,
    password: PASSWORD,
    options: { data: { username, display_name: name } },
  });
  if (error) throw new Error(`${username}: ${error.message}`);
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
  const weekend = await createChat(u.sam, 'group', 'Weekend Crew', '', avatars.weekend, [u.alex.id]);
  await send(u.sam, weekend, 'Hike at 9 on Saturday ⛰️');
  const dm = check(await u.sam.client.rpc('get_or_create_private_chat', { p_other: u.alex.id }));
  await send(u.sam, dm, 'Movie night on Friday? 🍿');
  await send(u.alex, dm, 'I’m in!');
  await send(u.sam, dm, 'Great, I’ll bring popcorn');
  // Всё прочитано: зелёный бейдж непрочитанного выбивается из синей палитры ролика.
  for (const c of [books, tips, weekend, dm]) check(await u.alex.client.rpc('mark_read', { p_chat: c }));
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

async function newContext(browser, { dark, desktop, css }) {
  const context = await browser.newContext(
    desktop
      ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }
      : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  );
  await context.addInitScript(
    ({ dark, appearance, css }) => {
      localStorage.setItem('bobogram.lang', 'en');
      localStorage.setItem('bobogram.theme', JSON.stringify(dark ? 'dark' : 'light'));
      localStorage.setItem('bobogram.appearance', JSON.stringify(appearance));
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      });
    },
    { dark, appearance: appearance(dark), css },
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
    await writeFile(join(outDir, 'layout.json'), JSON.stringify(layout, null, 2) + '\n');
    console.log('Готово:', outDir);
  } finally {
    await browser.close();
    vite?.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
