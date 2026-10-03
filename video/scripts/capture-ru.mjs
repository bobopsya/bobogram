// Русские экраны Bobogram для ролика Metro: node scripts/capture-ru.mjs
// Нужен локальный Supabase (npm run db:start в корне). Демо-данные создаются заново (только локальная база).
// Снимки и координаты — в public/shots/ru/.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  APP_URL,
  CHROMIUM,
  PASSWORD,
  check,
  ensureApp,
  fontCss,
  makeAvatars,
  makeStoryImage,
  measure,
  measureMessages,
  newContext,
  pageCss,
  rect,
  resetDemoUsers,
  send,
  shot,
  signUp,
} from './capture.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shots', 'ru');
const ru = (name) => join('ru', name);

const NAMES = { alex: 'Алекс Морган', mia: 'Мия Чен', sam: 'Сэм Ривера' };
const SEARCH = 'Поиск по @имени или чатам';
// Фразы — оммаж русской рекламе Windows 8: «Друзья всегда на связи», «Где собираемся?».
export const RU = {
  typed: 'Друзья всегда на связи 💙',
  question: 'Где собираемся?',
  answer: 'В нашем любимом кафе! ☕',
  poll: 'Где отметим день рождения? 🎂',
  options: ['В любимом кафе', 'В парке', 'Дома у Сэма'],
};

async function seed(browser, fonts) {
  await resetDemoUsers();
  const avatars = await makeAvatars(browser, fonts);
  const u = {};
  for (const key of Object.keys(NAMES)) {
    u[key] = await signUp(key, NAMES[key]);
    check(await u[key].client.from('profiles').update({ avatar: avatars[key] }).eq('id', u[key].id));
  }
  const createChat = async (owner, type, title, avatar, members) =>
    check(
      await owner.client.rpc('create_chat', {
        p_type: type,
        p_title: title,
        p_description: '',
        p_avatar: avatar,
        p_members: members,
      }),
    );
  const books = await createChat(u.sam, 'group', 'Книжный клуб', avatars.books, [u.alex.id]);
  await send(u.sam, books, 'Следующая книга — «Марсианин»');
  const tips = await createChat(u.sam, 'channel', 'Советы Bobogram', avatars.tips, [u.alex.id]);
  await send(u.sam, tips, 'Поделитесь QR-кодом — друзья найдут вас за секунду');
  const dm = check(await u.sam.client.rpc('get_or_create_private_chat', { p_other: u.alex.id }));
  await send(u.sam, dm, 'Кино в пятницу? 🍿');
  await send(u.alex, dm, 'Я в деле!');
  await send(u.sam, dm, 'Отлично, возьму попкорн');

  // Группа «Друзья»: опрос про день рождения (Sam и Mia уже проголосовали).
  const friends = await createChat(u.sam, 'group', 'Друзья', avatars.weekend, [u.alex.id, u.mia.id]);
  await send(u.sam, friends, 'Скоро мой день рождения 🎉');
  const pollId = crypto.randomUUID();
  check(
    await u.sam.client.rpc('create_poll', {
      p_id: pollId,
      p_chat: friends,
      p_question: RU.poll,
      p_options: RU.options,
      p_anonymous: false,
      p_multiple: false,
      p_topic: null,
    }),
  );
  check(await u.sam.client.rpc('vote_poll', { p_message: pollId, p_options: [0] }));
  check(await u.mia.client.rpc('vote_poll', { p_message: pollId, p_options: [1] }));
  await new Promise((r) => setTimeout(r, 1100));

  // Личка с Mia и её сторис.
  const mia = check(await u.alex.client.rpc('get_or_create_private_chat', { p_other: u.mia.id }));
  await send(u.mia, mia, 'Нашла тебя по @username 👋');
  await send(u.alex, mia, 'Привет! Как дела? 😊');
  await send(u.mia, mia, 'Отлично! Увидимся в субботу?');
  const story = await makeStoryImage(browser, fonts, 'Выходные в горах');
  const storyPath = `${u.mia.id}/story-${crypto.randomUUID()}.jpg`;
  check(await u.mia.client.storage.from('media').upload(storyPath, story, { contentType: 'image/jpeg' }));
  check(
    await u.mia.client
      .from('stories')
      .insert({ media_path: storyPath, mime: 'image/jpeg', size: story.length, width: 1080, height: 2338 }),
  );
  for (const c of [books, tips, dm, friends, mia]) check(await u.alex.client.rpc('mark_read', { p_chat: c }));
  return { u, friends, mia };
}

async function login(page) {
  await page.goto(APP_URL);
  await page.locator('.field-prefix input').fill('alex');
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('form .btn-primary').click();
  await page.getByPlaceholder(SEARCH).waitFor();
  await page.locator('.chat-item', { hasText: 'Отлично, возьму попкорн' }).waitFor();
}

const openChat = (page, title) => page.locator('.chat-item', { hasText: title }).first().click();
/** Группа «Друзья» по точному заголовку: фраза «Друзья всегда на связи» есть и в строке Mia. */
const openFriends = (page) =>
  page
    .locator('.chat-item')
    .filter({ has: page.locator('.list-item-title', { hasText: /^\s*Друзья\s*$/ }) })
    .first()
    .click();

/** Поле ввода: где начинается текст, шрифт и фон (чтобы перекрыть плейсхолдер и впечатать фразу). */
const composer = (page) =>
  page.locator('.composer textarea').evaluate((el) => {
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    let bg = 'rgba(0, 0, 0, 0)';
    for (let n = el; n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent'); n = n.parentElement)
      bg = getComputedStyle(n).backgroundColor;
    return {
      x: b.x,
      y: b.y,
      w: b.width,
      h: b.height,
      paddingLeft: parseFloat(cs.paddingLeft),
      font: parseFloat(cs.fontSize),
      color: cs.color,
      bg,
    };
  });

async function main() {
  await mkdir(outDir, { recursive: true });
  const vite = await ensureApp();
  const browser = await chromium.launch({
    args: ['--disable-lcd-text'],
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
  });
  const layout = {};
  try {
    const fonts = await fontCss();
    const css = pageCss(fonts);
    console.log('Русские демо-данные…');
    const { u, friends } = await seed(browser, fonts);

    const page = await newContext(browser, { dark: false, desktop: false, css, lang: 'ru' });
    await login(page);
    // 1. Список чатов с кольцом сторис у Mia.
    const bubble = page.locator('.stories-bar .story-bubble', { hasText: 'Мия' });
    await bubble.waitFor();
    await shot(page, ru('chats.png'));
    layout.chats = {
      storyAvatar: await rect(bubble.locator('.avatar')),
      mia: await rect(page.locator('.chat-item', { hasText: 'Мия Чен' })),
      friends: await rect(page.locator('.chat-item', { hasText: 'Друзья' })),
    };

    // 2. Сторис на весь экран (прогресс рисует ролик).
    await bubble.click();
    await page.locator('.story-photo').waitFor();
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = '.story-progress i { width: 0 !important; }';
      document.head.appendChild(s);
    });
    await page.evaluate(() => document.querySelector('.story-photo')?.decode());
    await shot(page, ru('story.png'));
    layout.story = { progress: await measure(page, '.story-progress span') };
    await page.keyboard.press('Escape');
    await page.locator('.story-viewer').waitFor({ state: 'detached' });

    // 3. Чат с Mia: пустое поле ввода, затем отправленная фраза.
    await openChat(page, 'Увидимся в субботу');
    await page.locator('.bubble', { hasText: 'Увидимся в субботу' }).waitFor();
    await shot(page, ru('mia.png'));
    layout.mia = { composer: await composer(page) };
    await page.locator('.composer textarea').fill(RU.typed);
    await page.keyboard.press('Enter');
    await page.locator('.msg-row.own', { hasText: 'Друзья всегда на связи' }).locator('.tick').waitFor();
    await page.locator('.composer textarea').blur();
    await shot(page, ru('mia-sent.png'));
    layout.miaSent = { rows: await measureMessages(page) };

    // 4. Группа «Друзья»: опрос до голоса, голос Alex (по-настоящему, кликом), затем переписка.
    await page.goto(APP_URL);
    await page.getByPlaceholder(SEARCH).waitFor();
    await openFriends(page);
    await page.locator('.poll').waitFor();
    await shot(page, ru('group-poll.png'));
    layout.group = {
      options: await page.evaluate(() =>
        [...document.querySelectorAll('.poll-option')].map((el) => {
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        }),
      ),
    };
    await page.locator('.poll-option', { hasText: RU.options[0] }).click();
    // Итоги с голосом Alex приходят с сервера: ждём 67 % у первого варианта.
    await page.locator('.poll-option', { hasText: '67%' }).waitFor();
    await page.waitForTimeout(400);
    await page.mouse.move(195, 700);
    layout.group.bars = await page.evaluate(() =>
      [...document.querySelectorAll('.poll-bar')].map((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, color: getComputedStyle(el).backgroundColor };
      }),
    );
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = '.poll-bar { visibility: hidden !important; }';
      document.head.appendChild(s);
    });
    await shot(page, ru('group-voted.png'));

    await send(u.sam, friends, RU.question);
    await page.locator('.bubble', { hasText: RU.question }).waitFor();
    await shot(page, ru('group-q.png'));
    layout.groupQ = { rows: await measureMessages(page) };
    await send(u.mia, friends, RU.answer);
    await page.locator('.bubble', { hasText: 'любимом кафе!' }).waitFor();
    await shot(page, ru('group-a.png'));
    layout.groupA = { rows: await measureMessages(page) };
    await page.context().close();

    // Mia отвечает последней: в списке чатов на ПК и планшете нет зелёной галочки «отправлено».
    const dmMia = check(await u.alex.client.rpc('get_or_create_private_chat', { p_other: u.mia.id }));
    await send(u.mia, dmMia, '💙');
    check(await u.alex.client.rpc('mark_read', { p_chat: dmMia }));
    check(await u.alex.client.rpc('mark_read', { p_chat: friends }));

    // 5. ПК и планшет — для сцены «на любом устройстве».
    const desktop = await newContext(browser, { dark: false, desktop: true, css, lang: 'ru' });
    await login(desktop);
    await openFriends(desktop);
    await desktop.locator('.bubble', { hasText: 'любимом кафе!' }).waitFor();
    await shot(desktop, ru('desktop.png'));
    await desktop.context().close();

    const tablet = await newContext(browser, {
      dark: false,
      css,
      lang: 'ru',
      device: {
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    });
    await login(tablet);
    await openChat(tablet, 'Мия Чен');
    await tablet.locator('.bubble', { hasText: 'Друзья всегда на связи' }).waitFor();
    await shot(tablet, ru('tablet.png'));
    layout.tablet = { viewport: { w: 820, h: 1180 } };
    await tablet.context().close();

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
