import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Сервисный ключ локального Supabase (стандартный демо-ключ, не секретный) — чтобы назначить админа.
const service = createClient(
  'http://127.0.0.1:54321',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  { auth: { persistSession: false } },
);

const run = Date.now().toString(36).slice(-6);

async function signUp(browser: Browser, name: string, username: string, mobile = false): Promise<Page> {
  const context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' }
      : { locale: 'ru-RU' },
  );
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[browser]', m.text()));
  await page.goto('./');
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрируйтесь' }).click();
  await page.getByLabel('Имя', { exact: true }).fill(name);
  await page.locator('.field-prefix input').fill(username);
  await expect(page.getByText('Имя свободно')).toBeVisible();
  const passwords = page.locator('input[type="password"]');
  await passwords.nth(0).fill('secret123');
  await passwords.nth(1).fill('secret123');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByPlaceholder('Поиск по @имени или чатам')).toBeVisible();
  return page;
}

test('регистрация, личная переписка, реакции, правка, группа', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `alice${run}`);
  const bob = await signUp(browser, 'Боб', `bob${run}`, true);

  // Алиса находит Боба по @имени и пишет ему.
  await alice.getByPlaceholder('Поиск по @имени или чатам').fill(`@bob${run}`);
  await alice.locator('.list-item', { hasText: 'Боб' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Привет, Боб!');
  await alice.keyboard.press('Enter');
  await expect(alice.locator('.bubble', { hasText: 'Привет, Боб!' })).toBeVisible();

  // Боб видит чат с непрочитанным и отвечает.
  const item = bob.locator('.chat-item', { hasText: 'Алиса' });
  await expect(item.locator('.badge')).toHaveText('1');
  await item.click();
  await expect(bob.locator('.bubble', { hasText: 'Привет, Боб!' })).toBeVisible();
  await bob.getByPlaceholder('Сообщение').fill('Привет, Алиса 👋');
  await bob.getByRole('button', { name: 'Отправить' }).click();
  await expect(alice.locator('.bubble', { hasText: 'Привет, Алиса 👋' })).toBeVisible();

  // Две галочки у Алисы: Боб прочитал.
  await expect(alice.locator('.msg-row.own .tick').last()).toBeVisible();

  // Реакция через контекстное меню.
  await alice.locator('.bubble', { hasText: 'Привет, Алиса' }).click({ button: 'right' });
  await alice.locator('.quick-reactions button', { hasText: '🔥' }).click();
  await expect(bob.locator('.reaction', { hasText: '🔥' })).toBeVisible();

  // Правка своего сообщения.
  await alice.locator('.bubble', { hasText: 'Привет, Боб!' }).click({ button: 'right' });
  await alice.getByRole('menuitem', { name: 'Изменить' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Привет, Боб! Как дела?');
  await alice.keyboard.press('Enter');
  await expect(bob.locator('.bubble', { hasText: 'Как дела?' })).toContainText('изм.');

  // Ответ на сообщение.
  await alice.locator('.bubble', { hasText: 'Привет, Алиса' }).click({ button: 'right' });
  await alice.getByRole('menuitem', { name: 'Ответить' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Отлично!');
  await alice.keyboard.press('Enter');
  await expect(bob.locator('.bubble', { hasText: 'Отлично!' }).locator('.msg-reply')).toContainText(
    'Привет, Алиса',
  );

  await bob.screenshot({ path: 'test-results/mobile-chat.png' });

  // Группа.
  await alice.goto('./#/new/group');
  await alice.locator('.people-picker .list-item', { hasText: 'Боб' }).click();
  await alice.getByRole('button', { name: 'Далее' }).click();
  await alice.getByLabel('Название группы').fill('Друзья');
  await alice.getByRole('button', { name: 'Создать группу' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Всем привет в группе');
  await alice.keyboard.press('Enter');

  await bob.getByRole('button', { name: 'Назад' }).first().click();
  await bob.locator('.chat-item', { hasText: 'Друзья' }).click();
  await expect(bob.locator('.bubble', { hasText: 'Всем привет в группе' })).toBeVisible();
  await expect(bob.locator('.msg-row.system', { hasText: 'Алиса создал(а) «Друзья»' })).toBeVisible();
  await alice.screenshot({ path: 'test-results/desktop-group.png' });
});

test('видеозвонок соединяется и пишет запись в чат', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `alicec${run}`);
  const bob = await signUp(browser, 'Боб', `bobc${run}`);
  for (const page of [alice, bob]) await page.context().grantPermissions(['camera', 'microphone']);

  await alice.getByPlaceholder('Поиск по @имени или чатам').fill(`@bobc${run}`);
  await alice.locator('.list-item', { hasText: 'Боб' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Позвоню?');
  await alice.keyboard.press('Enter');
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toBeVisible();

  await alice.getByRole('button', { name: 'Видеозвонок' }).first().click();
  await expect(bob.getByText('Входящий видеозвонок')).toBeVisible();
  await bob.getByRole('button', { name: 'Принять' }).click();

  // Идёт таймер — значит соединение установлено.
  await expect(alice.locator('.call-screen')).toContainText(/\d:\d\d/, { timeout: 30_000 });
  await expect(bob.locator('.call-screen')).toContainText(/\d:\d\d/, { timeout: 30_000 });
  await alice.waitForTimeout(1500);
  await bob.screenshot({ path: 'test-results/call.png' });
  await bob.getByRole('button', { name: 'Завершить' }).click();
  await expect(alice.locator('.call-screen')).toBeHidden({ timeout: 10_000 });
  await expect(alice.locator('.msg-call')).toContainText('Видеозвонок');
});

test('аудиозвонок: демонстрация экрана доходит до собеседника', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `alices${run}`);
  const bob = await signUp(browser, 'Боб', `bobs${run}`);
  for (const page of [alice, bob]) await page.context().grantPermissions(['camera', 'microphone']);

  await alice.getByPlaceholder('Поиск по @имени или чатам').fill(`@bobs${run}`);
  await alice.locator('.list-item', { hasText: 'Боб' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Покажу экран');
  await alice.keyboard.press('Enter');
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toBeVisible();

  await alice.getByRole('button', { name: 'Аудиозвонок' }).first().click();
  await expect(bob.getByText('Входящий аудиозвонок')).toBeVisible();
  await bob.getByRole('button', { name: 'Принять' }).click();
  await expect(alice.locator('.call-screen')).toContainText(/\d:\d\d/, { timeout: 30_000 });

  await alice.locator('.call-btn', { hasText: 'Экран' }).click();
  await expect(alice.getByText('Вы показываете экран')).toBeVisible();
  await expect(bob.getByText('Алиса показывает экран')).toBeVisible({ timeout: 15_000 });
  // Кадры экрана реально приходят.
  await expect
    .poll(() => bob.locator('video.call-remote').evaluate((v: HTMLVideoElement) => v.videoWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await bob.screenshot({ path: 'test-results/screen-share.png' });

  await alice.locator('.call-btn', { hasText: 'Экран' }).click();
  await expect(bob.getByText('Алиса показывает экран')).toBeHidden({ timeout: 15_000 });
  await bob.getByRole('button', { name: 'Завершить' }).click();
  await expect(alice.locator('.call-screen')).toBeHidden({ timeout: 10_000 });
});

test('фото с подписью и голосовое доходят до собеседника', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `alicem${run}`);
  const bob = await signUp(browser, 'Боб', `bobm${run}`, true);
  await alice.context().grantPermissions(['microphone']);

  await alice.getByPlaceholder('Поиск по @имени или чатам').fill(`@bobm${run}`);
  await alice.locator('.list-item', { hasText: 'Боб' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Смотри');

  // Картинка 400×300, нарисованная прямо в браузере.
  const png = await alice.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#3a8';
    ctx.fillRect(0, 0, 400, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  await alice
    .getByRole('main')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'pic.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
  await expect(alice.getByPlaceholder('Подпись')).toHaveValue('Смотри');
  await alice.getByRole('dialog').getByRole('button', { name: 'Отправить' }).click();

  await bob.locator('.chat-item', { hasText: 'Алиса' }).click();
  const photo = bob.locator('.msg-photo img');
  await expect(photo).toHaveClass(/loaded/, { timeout: 20_000 });
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(400);
  await expect(bob.locator('.bubble.has-photo')).toContainText('Смотри');

  // Голосовое (фейковый микрофон Chromium).
  await alice.getByRole('button', { name: 'Записать голосовое' }).click();
  await expect(alice.locator('.rec-time')).toHaveText(/0:01/, { timeout: 5_000 });
  await alice.waitForTimeout(600);
  await alice.locator('.composer.recording').getByRole('button', { name: 'Отправить' }).click();
  const voice = bob.locator('.voice');
  await expect(voice).toBeVisible({ timeout: 20_000 });
  await expect(voice.locator('.voice-time')).toHaveText(/0:0[12]/);
  await expect(voice.locator('.voice-play')).toBeEnabled();
  await voice.locator('.voice-play').click();
  await expect(voice.locator('.voice-wave span.on').first()).toBeVisible({ timeout: 10_000 });
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toContainText('Голосовое сообщение');
  await bob.screenshot({ path: 'test-results/media.png' });
});

test('телефон: Enter отправляет, плавающая дата при прокрутке', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `alicee${run}`, true);
  await signUp(browser, 'Боб', `bobe${run}`);

  await alice.getByPlaceholder('Поиск по @имени или чатам').fill(`@bobe${run}`);
  await alice.locator('.list-item', { hasText: 'Боб' }).click();
  const input = alice.getByPlaceholder('Сообщение');
  for (let i = 1; i <= 30; i++) {
    await input.fill(`Сообщение ${i}`);
    await input.press('Enter');
  }
  await expect(alice.locator('.bubble', { hasText: 'Сообщение 30' })).toBeVisible();
  await expect(input).toHaveValue('');

  // «Сегодня» больше не прилипает, а при прокрутке вверх появляется плавающая дата.
  expect(
    await alice
      .locator('.date-sep')
      .first()
      .evaluate((el) => getComputedStyle(el).position),
  ).not.toBe('sticky');
  await alice.locator('.messages').evaluate((el) => {
    el.scrollTop = -600;
    el.dispatchEvent(new Event('scroll'));
  });
  await expect(alice.locator('.floating-date')).toHaveText('Сегодня');
  await expect(alice.locator('.floating-date')).toBeHidden({ timeout: 5_000 });

  // Выключили «Отправка по Enter» — Enter переносит строку.
  await alice.goto('./#/settings');
  await alice.locator('.setting-row', { hasText: 'Отправка по Enter' }).getByRole('switch').click();
  await alice.goBack();
  await input.fill('строка 1');
  await input.press('Enter');
  await input.pressSequentially('строка 2');
  await expect(input).toHaveValue('строка 1\nстрока 2');
});

test('админ выдаёт НФТ-юзернейм, по нему находят профиль', async ({ browser }) => {
  const boss = await signUp(browser, 'Админ', `boss${run}`);
  const bob = await signUp(browser, 'Боб', `bobn${run}`);
  const { data } = await service.from('profiles').select('id').eq('username', `boss${run}`).single();
  await service.from('profiles').update({ role: 'admin' }).eq('id', data!.id);

  await boss.goto('./#/admin');
  await boss.reload();
  await boss.getByPlaceholder('Поиск').fill(`bobn${run}`);
  await boss
    .locator('.list-item', { hasText: `@bobn${run}` })
    .getByRole('button', { name: 'more' })
    .click();
  await boss.getByRole('menuitem', { name: 'НФТ-юзернеймы' }).click();
  const dialog = boss.getByRole('dialog');
  await dialog.locator('input').fill(`gem${run}`);
  await expect(dialog.getByText('Имя свободно')).toBeVisible();
  await dialog.getByRole('button', { name: 'Выдать' }).click();
  await expect(dialog.getByText(`💎 @gem${run}`)).toBeVisible();
  await boss.keyboard.press('Escape');

  // Поиск по НФТ-имени и профиль по ссылке.
  await boss.goto('./');
  await boss.getByPlaceholder('Поиск по @имени или чатам').fill(`@gem${run}`);
  await expect(boss.locator('.list-item', { hasText: `💎 @gem${run}` })).toBeVisible();
  await boss.goto(`./#/u/gem${run}`);
  await expect(boss.locator('.nft-name', { hasText: `@gem${run}` })).toBeVisible();
  await boss.screenshot({ path: 'test-results/nft-profile.png' });
  // У владельца имя видно в своём профиле.
  await bob.goto(`./#/u/bobn${run}`);
  await expect(bob.locator('.nft-name', { hasText: `@gem${run}` })).toBeVisible();
});

test('админ v4: правка профиля, стиль, спамблок', async ({ browser }) => {
  const boss = await signUp(browser, 'Босс', `bossv${run}`);
  const spammer = await signUp(browser, 'Спамер', `spamv${run}`, true);
  await signUp(browser, 'Жертва', `victv${run}`);
  const { data } = await service.from('profiles').select('id').eq('username', `bossv${run}`).single();
  await service.from('profiles').update({ role: 'admin' }).eq('id', data!.id);

  await boss.goto('./#/admin');
  await boss.reload();
  await boss.getByPlaceholder('Поиск').fill(`spamv${run}`);
  const row = boss.locator('.list-item', { hasText: `@spamv${run}` });
  await row.getByRole('button', { name: 'more' }).click();
  await boss.getByRole('menuitem', { name: 'Изменить профиль' }).click();
  const dialog = boss.getByRole('dialog');
  await dialog.getByLabel('Имя', { exact: true }).fill(`Переименован${run}`);
  await dialog.locator('.style-swatch[aria-label="fire"]').click();
  await dialog.getByLabel('Эмодзи-статус').fill('🔥');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(boss.getByText('Профиль обновлён')).toBeVisible();
  await expect(boss.locator('.list-item', { hasText: `Переименован${run}` })).toContainText('🔥');

  await boss
    .locator('.list-item', { hasText: `Переименован${run}` })
    .getByRole('button', { name: 'more' })
    .click();
  await boss.getByRole('menuitem', { name: 'Спамблок…' }).click();
  await boss.getByRole('menuitem', { name: 'Спамблок на 1 день' }).click();
  await boss.screenshot({ path: 'test-results/admin-menu.png' });
  await expect(boss.locator('.list-item', { hasText: `Переименован${run}` })).toContainText('спамблок');

  // Спамер не может написать первым.
  await spammer.getByPlaceholder('Поиск по @имени или чатам').fill(`@victv${run}`);
  await spammer.locator('.list-item', { hasText: 'Жертва' }).click();
  await spammer.getByPlaceholder('Сообщение').fill('купи слона');
  await spammer.getByPlaceholder('Сообщение').press('Enter');
  await expect(spammer.getByText('Вы в спамблоке и не можете писать первым')).toBeVisible();
});

test('@bobotools: /setlogs, /invite, жалоба в лог, статистика', async ({ browser }) => {
  const boss = await signUp(browser, 'Босс', `bossb${run}`);
  const friend = await signUp(browser, 'Друг', `frndb${run}`, true);
  await signUp(browser, 'Новичок', `newb${run}`);
  const { data } = await service.from('profiles').select('id').eq('username', `bossb${run}`).single();
  await service.from('profiles').update({ role: 'admin' }).eq('id', data!.id);
  await boss.reload();

  // Группа с другом и лог-группа.
  async function newGroup(title: string, members: string[]) {
    await boss.goto('./#/new/group');
    for (const m of members) {
      await boss.locator('.people-picker input').fill(m);
      await boss.locator('.people-picker .list-item', { hasText: m }).first().click();
    }
    await boss.getByRole('button', { name: 'Далее' }).click();
    await boss.getByLabel('Название группы').fill(title);
    await boss.getByRole('button', { name: 'Создать группу' }).click();
    await expect(boss.getByPlaceholder('Сообщение')).toBeVisible();
  }
  await newGroup(`Логи ${run}`, []);
  await boss.getByPlaceholder('Сообщение').fill('/setlogs');
  await boss.keyboard.press('Enter');
  await expect(boss.locator('.bubble', { hasText: 'Теперь логи администрации приходят сюда' })).toBeVisible();

  await newGroup(`Команда ${run}`, [`frndb${run}`]);
  await boss.getByPlaceholder('Сообщение').fill(`/invite @newb${run}`);
  await boss.keyboard.press('Enter');
  await expect(boss.locator('.msg-row.system', { hasText: 'Новичок' })).toBeVisible();

  // Друг жалуется на сообщение босса.
  await boss.getByPlaceholder('Сообщение').fill('грубое сообщение');
  await boss.keyboard.press('Enter');
  await friend.locator('.chat-item', { hasText: `Команда ${run}` }).click();
  const bubble = friend.locator('.bubble', { hasText: 'грубое сообщение' });
  await bubble.click({ button: 'right' });
  await friend.getByRole('menuitem', { name: 'Пожаловаться' }).click();
  await friend.getByLabel('Оскорбления').check();
  await friend.getByRole('button', { name: 'Отправить жалобу' }).click();
  await expect(friend.getByText('Жалоба отправлена администраторам')).toBeVisible();

  await boss.locator('.chat-item', { hasText: `Логи ${run}` }).click();
  await expect(boss.locator('.bubble', { hasText: '🚩 Жалоба от' })).toContainText('грубое сообщение');

  await boss.goto('./#/admin');
  await boss.getByRole('button', { name: 'Статистика' }).click();
  await expect(boss.locator('.stat-tile', { hasText: 'Пользователей' })).toBeVisible();
});

test('накрутка канала из меню канала', async ({ browser }) => {
  const boss = await signUp(browser, 'Босс', `bossk${run}`, true);
  const { data } = await service.from('profiles').select('id').eq('username', `bossk${run}`).single();
  await service.from('profiles').update({ role: 'admin' }).eq('id', data!.id);
  await boss.reload();

  await boss.goto('./#/new/channel');
  await boss.getByLabel('Название канала').fill(`Новости ${run}`);
  await boss.getByRole('button', { name: 'Создать канал' }).click();
  await boss.getByPlaceholder('Сообщение').fill('первый пост');
  await boss.keyboard.press('Enter');
  await expect(boss.locator('.bubble', { hasText: 'первый пост' })).toBeVisible();

  await boss.locator('.chat-header').getByRole('button', { name: 'more' }).click();
  await boss.getByRole('menuitem', { name: 'Накрутка канала' }).click();
  const dialog = boss.getByRole('dialog');
  await dialog.locator('.boost-section').nth(1).locator('input').fill('1000');
  await dialog.getByRole('button', { name: 'Добавить' }).click();
  await expect(boss.getByText('Сохранено').or(boss.locator('.toast'))).toBeVisible();
  await dialog.locator('.boost-section').nth(2).locator('input').first().fill('500');
  await dialog.locator('.boost-section').nth(2).getByRole('button', { name: 'Сохранить' }).click();
  await boss.screenshot({ path: 'test-results/channel-boost.png' });
  await boss.keyboard.press('Escape');

  // Старый пост получил ~1000 просмотров, новый — ~500 сразу.
  await expect(boss.locator('.bubble', { hasText: 'первый пост' }).locator('.msg-views')).toContainText(/\d/);
  await boss.getByPlaceholder('Сообщение').fill('второй пост');
  await boss.keyboard.press('Enter');
  await expect(boss.locator('.bubble', { hasText: 'второй пост' }).locator('.msg-views')).toContainText(
    /\d{3}/,
    {
      timeout: 15_000,
    },
  );
});

test('темы в группе: включить, создать, писать в тему', async ({ browser }) => {
  const own = await signUp(browser, 'Хозяин', `tpo${run}`);
  const mem = await signUp(browser, 'Гость', `tpm${run}`, true);
  const title = `Форум ${run}`;
  await own.goto('./#/new/group');
  await own.getByRole('button', { name: 'Далее' }).click();
  await own.getByLabel('Название группы').fill(title);
  await own.getByRole('button', { name: 'Создать группу' }).click();
  await own.getByPlaceholder('Сообщение').fill('до тем');
  await own.keyboard.press('Enter');
  await expect(own.locator('.bubble', { hasText: 'до тем' })).toBeVisible();
  const chatId = own.url().split('/c/')[1];
  const { data: m } = await service.from('profiles').select('id').eq('username', `tpm${run}`).single();
  await service.from('chat_members').insert({ chat_id: chatId, user_id: m!.id });

  await own.goto(`./#/c/${chatId}/info`);
  await own.locator('.info-item', { hasText: 'Темы' }).getByRole('switch').click();
  await own.goto(`./#/c/${chatId}`);
  await expect(own.locator('.chat-item', { hasText: 'Общее' })).toBeVisible();
  await own.getByRole('button', { name: 'Новая тема' }).click();
  await own.getByRole('dialog').getByRole('button', { name: '🎮' }).click();
  await own.getByLabel('Название темы').fill('Игры');
  await own.getByRole('dialog').getByRole('button', { name: 'Создать' }).click();
  await expect(own.locator('.chat-header', { hasText: 'Игры' })).toBeVisible();
  await own.getByPlaceholder('Сообщение').fill('го в доту');
  await own.keyboard.press('Enter');
  await expect(own.locator('.bubble', { hasText: 'го в доту' })).toBeVisible();
  await expect(own.locator('.bubble', { hasText: 'до тем' })).toHaveCount(0);

  await mem.goto(`./#/c/${chatId}`);
  const games = mem.locator('.chat-item', { hasText: 'Игры' });
  await expect(games).toContainText('го в доту');
  await expect(games.locator('.badge')).toHaveText('1');
  await mem.screenshot({ path: 'test-results/topics-list.png' });
  await games.click();
  await expect(mem.locator('.bubble', { hasText: 'го в доту' })).toBeVisible();
  await mem.getByPlaceholder('Сообщение').fill('я в деле');
  await mem.keyboard.press('Enter');
  await expect(own.locator('.bubble', { hasText: 'я в деле' })).toBeVisible();
  await mem.locator('.chat-header').getByRole('button', { name: 'Назад' }).click();
  await mem.locator('.chat-item', { hasText: 'Общее' }).click();
  await expect(mem.locator('.bubble', { hasText: 'до тем' })).toBeVisible();
  await expect(mem.locator('.bubble', { hasText: 'го в доту' })).toHaveCount(0);
});

test('после обновления сайта админка открывается без экрана ошибки', async ({ browser }) => {
  const boss = await signUp(browser, 'Админ', `upd${run}`);
  const { data } = await service.from('profiles').select('id').eq('username', `upd${run}`).single();
  await service.from('profiles').update({ role: 'admin' }).eq('id', data!.id);
  await boss.reload();
  // Старый файл админки уже удалён с сервера — первая загрузка падает.
  let failed = false;
  await boss.route(/AdminPanel/, (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.abort();
  });
  await boss.goto('./#/admin');
  await expect(boss.getByText('Что-то пошло не так')).toHaveCount(0);
  await expect(boss.getByText('Админ-панель')).toBeVisible({ timeout: 15_000 });
  expect(failed).toBe(true);
});

test('сторис из списка чатов открывается на весь экран и закрывается крестиком', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `sta${run}`, true);
  const { data: a } = await service.from('profiles').select('id').eq('username', `sta${run}`).single();
  const { data: b } = await service.auth.admin.createUser({
    email: `${crypto.randomUUID()}@users.bobogram.app`,
    password: 'secret123',
    email_confirm: true,
    user_metadata: { username: `stb${run}`, display_name: 'Сторисный' },
  });
  const bid = b.user!.id;
  const path = `${bid}/story-${crypto.randomUUID()}.jpg`;
  await service.storage
    .from('media')
    .upload(path, Buffer.from('ffd8ffd9', 'hex'), { contentType: 'image/jpeg' });
  await service.from('stories').insert({ author_id: bid, media_path: path, width: 10, height: 10 });
  const key = [a!.id, bid].sort().join('_');
  const { data: chat } = await service
    .from('chats')
    .insert({ type: 'private', private_key: key })
    .select('id')
    .single();
  await service.from('chat_members').insert([
    { chat_id: chat!.id, user_id: a!.id },
    { chat_id: chat!.id, user_id: bid },
  ]);
  await service.from('messages').insert({ chat_id: chat!.id, sender_id: bid, text: 'смотри сторис' });

  await alice.reload();
  // Лента сторис над чатами: кружок автора с цветным кольцом.
  await expect(
    alice.locator('.stories-bar .story-bubble', { hasText: 'Сторисный' }).locator('.unviewed'),
  ).toBeVisible();
  await alice.screenshot({ path: 'test-results/stories-bar.png' });
  const row = alice.locator('.chat-item', { hasText: 'Сторисный' });
  await row.locator('.story-avatar.unviewed').click();
  const viewer = alice.locator('.story-viewer');
  await expect(viewer).toBeVisible();
  const box = await viewer.boundingBox();
  expect(box!.height).toBeGreaterThan(600);
  await viewer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(viewer).toHaveCount(0);
  // Закрытие сторис не открывает чат.
  await expect(alice.getByPlaceholder('Сообщение')).toHaveCount(0);
  await row.click();
  await expect(alice.locator('.bubble', { hasText: 'смотри сторис' })).toBeVisible();
});

test('iPhone: окно фото с подписью остаётся над клавиатурой', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `kbd${run}`, true);
  const { data: a } = await service.from('profiles').select('id').eq('username', `kbd${run}`).single();
  const { data: chat } = await service
    .from('chats')
    .insert({ type: 'saved', private_key: `saved_${a!.id}` })
    .select('id')
    .single();
  await service.from('chat_members').insert({ chat_id: chat!.id, user_id: a!.id });
  await alice.goto(`./#/c/${chat!.id}`);
  const png = await alice.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1600;
    c.getContext('2d')!.fillRect(0, 0, 900, 1600);
    return c.toDataURL('image/png').split(',')[1];
  });
  await alice
    .getByRole('main')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'tall.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
  const caption = alice.getByPlaceholder('Подпись');
  await caption.click();
  // Клавиатура iPhone: видимая часть экрана — 420px из 844 (так её сообщает visualViewport).
  await alice.evaluate(() => document.documentElement.style.setProperty('--app-height', '420px'));
  await alice.waitForTimeout(400);
  const send = alice.getByRole('dialog').getByRole('button', { name: 'Отправить' });
  for (const el of [caption, send]) {
    const box = await el.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(420);
  }
  // Превью фото тоже видно, просто меньше.
  const img = await alice.locator('.photo-previews img').boundingBox();
  expect(img!.height).toBeGreaterThan(60);
  expect(img!.y).toBeGreaterThanOrEqual(0);
  await alice.screenshot({ path: 'test-results/iphone-keyboard.png' });
});

test('форматирование: панель при выделении, спойлер, премиум-стиль', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `fmt${run}`);
  const { data: a } = await service.from('profiles').select('id').eq('username', `fmt${run}`).single();
  const { data: chat } = await service
    .from('chats')
    .insert({ type: 'saved', private_key: `saved_${a!.id}` })
    .select('id')
    .single();
  await service.from('chat_members').insert({ chat_id: chat!.id, user_id: a!.id });
  await alice.goto(`./#/c/${chat!.id}`);

  const input = alice.getByPlaceholder('Сообщение');
  await input.fill('привет мир');
  await input.press('End');
  for (let i = 0; i < 3; i++) await input.press('Shift+ArrowLeft');
  await alice.getByRole('button', { name: 'Жирный' }).click();
  await expect(input).toHaveValue('привет **мир**');
  await input.press('Enter');
  await expect(alice.locator('.bubble strong', { hasText: 'мир' })).toBeVisible();

  await input.fill('ответ: ||секрет|| и `код`\n> цитата');
  await input.press('Enter');
  const spoiler = alice.locator('.bubble .md-spoiler', { hasText: 'секрет' });
  await expect(spoiler).not.toHaveClass(/open/);
  await spoiler.click();
  await expect(spoiler).toHaveClass(/open/);
  await expect(alice.locator('.bubble .md-code', { hasText: 'код' })).toBeVisible();
  await expect(alice.locator('.bubble .md-quote', { hasText: 'цитата' })).toBeVisible();

  // Без премиума цветной текст уходит обычным.
  await input.fill('{red|красный}');
  await input.press('Enter');
  await expect(alice.locator('.bubble', { hasText: /^красный/ }).locator('.md-color')).toHaveCount(0);
  // С премиумом — цветной.
  await service.from('profiles').update({ premium_until: '9999-12-31' }).eq('id', a!.id);
  await alice.reload();
  await input.fill('{fire|огонь}');
  await input.press('Enter');
  await expect(alice.locator('.bubble .md-color', { hasText: 'огонь' })).toBeVisible();
  await alice.screenshot({ path: 'test-results/markup.png' });
});

test('админка: «⋮» открывает меню даже при нажатии у края кнопки', async ({ browser }) => {
  const boss = await signUp(browser, 'Админ', `edge${run}`);
  await signUp(browser, 'Кто-то', `edgeu${run}`);
  const { data } = await service.from('profiles').select('id').eq('username', `edge${run}`).single();
  await service.from('profiles').update({ role: 'admin' }).eq('id', data!.id);
  await boss.goto('./#/admin');
  await boss.reload();
  await boss.getByRole('main').getByPlaceholder('Поиск', { exact: true }).fill(`edgeu${run}`);
  const more = boss.locator('.list-item', { hasText: `@edgeu${run}` }).getByRole('button', { name: 'more' });
  await more.scrollIntoViewIfNeeded();
  // Как человек: нажали у самого правого края и отпустили там же.
  const box = (await more.boundingBox())!;
  await boss.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await boss.mouse.down();
  await boss.waitForTimeout(150);
  await boss.mouse.up();
  await expect(boss.getByRole('menuitem').first()).toBeVisible();
});

test('подсказка значка в списке чатов видна целиком', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `tip${run}`);
  const { data: a } = await service.from('profiles').select('id').eq('username', `tip${run}`).single();
  const { data: b } = await service.auth.admin.createUser({
    email: `${crypto.randomUUID()}@users.bobogram.app`,
    password: 'secret123',
    email_confirm: true,
    user_metadata: { username: `tipd${run}`, display_name: 'Разраб' },
  });
  await service.from('profiles').update({ developer: true }).eq('id', b.user!.id);
  const { data: chat } = await service
    .from('chats')
    .insert({ type: 'private', private_key: [a!.id, b.user!.id].sort().join('_') })
    .select('id')
    .single();
  await service.from('chat_members').insert([
    { chat_id: chat!.id, user_id: a!.id },
    { chat_id: chat!.id, user_id: b.user!.id },
  ]);
  await service.from('messages').insert({ chat_id: chat!.id, sender_id: b.user!.id, text: 'привет' });
  await alice.reload();
  await alice.locator('.chat-item', { hasText: 'Разраб' }).locator('.dev-badge').click();
  const tip = alice.getByRole('tooltip');
  await expect(tip).toContainText('Разработчик Bobogram');
  // Нижняя часть подсказки не обрезана строкой: в этой точке — сама подсказка.
  const box = (await tip.boundingBox())!;
  const hit = await alice.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.dev-popover'), {
    x: box.x + box.width / 2,
    y: box.y + box.height - 4,
  });
  expect(hit).toBe(true);
  // Нажатие по значку не открывает чат.
  await expect(alice.getByPlaceholder('Сообщение')).toHaveCount(0);
});

test('админка: «Инфо» об устройстве и блокировка устройства', async ({ browser }) => {
  const boss = await signUp(browser, 'Админ', `inf${run}`);
  const target = await signUp(browser, 'Нарушитель', `infu${run}`, true);
  await expect(target.getByPlaceholder('Поиск по @имени или чатам')).toBeVisible();
  const { data } = await service.from('profiles').select('id').eq('username', `inf${run}`).single();
  await service.from('profiles').update({ role: 'admin' }).eq('id', data!.id);
  await boss.goto('./#/admin');
  await boss.reload();
  await boss.getByRole('main').getByPlaceholder('Поиск', { exact: true }).fill(`infu${run}`);
  await boss
    .locator('.list-item', { hasText: `@infu${run}` })
    .getByRole('button', { name: 'more' })
    .click();
  await boss.getByRole('menuitem', { name: 'Инфо' }).click();
  const dialog = boss.getByRole('dialog');
  // Мобильный браузер Chromium: «Android · Chrome …» или «Компьютер …» — главное, что устройство есть и есть IP.
  await expect(dialog.locator('.info-card-title')).toHaveCount(1);
  await expect(dialog.getByText('IP', { exact: true })).toBeVisible();
  await boss.screenshot({ path: 'test-results/admin-info.png' });
  await dialog.getByRole('button', { name: 'Заблокировать устройство' }).click();
  await expect(dialog.getByRole('button', { name: 'Разблокировать устройство' })).toBeVisible();
  await target.reload();
  await expect(target.getByText('Аккаунт заблокирован')).toBeVisible();
  // Снимаем, чтобы не мешать другим тестам.
  await dialog.getByRole('button', { name: 'Разблокировать устройство' }).click();
  await expect(dialog.getByRole('button', { name: 'Заблокировать устройство' })).toBeVisible();
});

test('группа: @упоминание с подсказкой и опрос', async ({ browser }) => {
  const own = await signUp(browser, 'Хозяин', `mnt${run}`);
  const mem = await signUp(browser, 'Участник', `mntm${run}`, true);
  await own.goto('./#/new/group');
  await own.getByRole('button', { name: 'Далее' }).click();
  await own.getByLabel('Название группы').fill(`Опросная ${run}`);
  await own.getByRole('button', { name: 'Создать группу' }).click();
  await expect(own.getByPlaceholder('Сообщение')).toBeVisible();
  const chatId = own.url().split('/c/')[1];
  const { data: m } = await service.from('profiles').select('id').eq('username', `mntm${run}`).single();
  await service.from('chat_members').insert({ chat_id: chatId, user_id: m!.id });
  await own.reload();

  const input = own.getByPlaceholder('Сообщение');
  await input.pressSequentially('привет @mntm');
  await own.locator('.mention-item', { hasText: 'Участник' }).click();
  await expect(input).toHaveValue(`привет @mntm${run} `);
  await input.press('Enter');

  await mem.goto(`./#/c/${chatId}`);
  await expect(mem.locator('.bubble .md-mention.me', { hasText: `@mntm${run}` })).toBeVisible();

  // Опрос.
  await own.getByRole('button', { name: 'Прикрепить фото' }).click();
  await own.getByRole('menuitem', { name: 'Опрос' }).click();
  const dialog = own.getByRole('dialog');
  await dialog.getByLabel('Вопрос').fill('Пицца или суши?');
  await dialog.getByPlaceholder('Вариант 1').fill('Пицца');
  await dialog.getByPlaceholder('Вариант 2').fill('Суши');
  await dialog.getByRole('button', { name: 'Создать' }).click();
  const poll = mem.locator('.poll', { hasText: 'Пицца или суши?' });
  await poll.getByRole('button', { name: 'Суши' }).click();
  await expect(poll.locator('.poll-pct').nth(1)).toHaveText('100%');
  await expect(own.locator('.poll', { hasText: 'Пицца или суши?' }).getByText('1 голос')).toBeVisible();
  await mem.screenshot({ path: 'test-results/poll.png' });
});

test('файл, видео и видеокружочек', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `vid${run}`);
  const { data: a } = await service.from('profiles').select('id').eq('username', `vid${run}`).single();
  const { data: chat } = await service
    .from('chats')
    .insert({ type: 'saved', private_key: `saved_${a!.id}` })
    .select('id')
    .single();
  await service.from('chat_members').insert({ chat_id: chat!.id, user_id: a!.id });
  await alice.goto(`./#/c/${chat!.id}`);
  const main = alice.getByRole('main');

  // Файл — через меню скрепки.
  await main.locator('input[type="file"]:not([accept])').setInputFiles({
    name: 'отчёт.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 тест'),
  });
  await expect(alice.locator('.msg-file', { hasText: 'отчёт.pdf' })).toBeVisible();
  const kinds = async () =>
    (
      await service
        .from('messages')
        .select('media')
        .eq('chat_id', chat!.id)
        .not('media', 'is', null)
        .order('created_at')
    ).data!.map((m) => (m.media as { kind: string }).kind);
  await expect.poll(kinds).toEqual(['file']);

  // Видео — тем же окном, что и фото.
  await main
    .locator('input[type="file"][accept="image/*,video/*"]')
    .setInputFiles('tests/e2e/fixtures/clip.mp4');
  await alice.getByRole('dialog').getByRole('button', { name: 'Отправить' }).click();
  await expect(alice.locator('.msg-video video')).toBeVisible();
  await expect.poll(kinds, { timeout: 15_000 }).toEqual(['file', 'video']);

  // Кружок с фейковой камеры.
  await alice.getByRole('button', { name: 'Записать видеосообщение' }).click();
  await expect(alice.locator('.note-capture video')).toBeVisible();
  await alice.waitForTimeout(1500);
  await alice.locator('.note-capture').getByRole('button', { name: 'Отправить' }).click();
  await expect(alice.locator('.video-note video')).toBeVisible();
  await expect.poll(kinds, { timeout: 15_000 }).toEqual(['file', 'video', 'video_note']);
  await alice.screenshot({ path: 'test-results/media-kinds.png' });
});

test('поиск по сообщениям, папки, отложенное, автоудаление', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `srch${run}`);
  const bob = await signUp(browser, 'Боб', `srchb${run}`);
  await alice.getByPlaceholder('Поиск по @имени или чатам').fill(`@srchb${run}`);
  await alice.locator('.list-item', { hasText: 'Боб' }).first().click();
  const input = alice.getByPlaceholder('Сообщение');
  await input.fill(`ключевое слово ${run}`);
  await input.press('Enter');
  for (let i = 0; i < 3; i++) {
    await input.fill(`просто сообщение ${i}`);
    await input.press('Enter');
  }

  // Глобальный поиск находит сообщение, клик — переход к нему.
  await bob.getByPlaceholder('Поиск по @имени или чатам').fill(`слово ${run}`);
  const hit = bob.locator('.search-hit', { hasText: `ключевое слово ${run}` });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(bob.locator('.msg-row.highlighted', { hasText: `ключевое слово ${run}` })).toBeVisible();

  // Папки: «Группы» — пусто, «Личные» — есть чат.
  await bob.goto('./');
  await bob.getByRole('tab', { name: 'Группы' }).click();
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toHaveCount(0);
  await bob.getByRole('tab', { name: 'Личные' }).click();
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toBeVisible();
  // Своя папка.
  await bob.getByRole('button', { name: 'Новая папка' }).click();
  const dialog = bob.getByRole('dialog');
  await dialog.getByLabel('Название папки').fill('Друзья');
  await dialog.locator('.folder-chat', { hasText: 'Алиса' }).locator('input').check();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await bob.getByRole('tab', { name: 'Друзья' }).click();
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toBeVisible();

  // Отложенное: правый клик по «Отправить» → «Отправить позже».
  await input.fill('напомню позже');
  await alice.getByRole('button', { name: 'Отправить' }).click({ button: 'right' });
  await alice.getByRole('menuitem', { name: 'Отправить позже' }).click();
  await alice.getByRole('dialog').getByRole('button', { name: 'Через час' }).click();
  await alice.getByRole('dialog').getByRole('button', { name: 'Запланировать' }).click();
  await expect(alice.locator('.toast', { hasText: 'Сообщение уйдёт' })).toBeVisible();
  await service
    .from('scheduled_messages')
    .update({ send_at: new Date(Date.now() - 1000).toISOString() })
    .neq('text', '');
  await service.rpc('run_scheduled_jobs');
  await expect(alice.locator('.bubble', { hasText: 'напомню позже' })).toBeVisible();

  // Автоудаление в личке.
  await alice.locator('.chat-header').getByRole('button', { name: 'more' }).click();
  await alice.getByRole('menuitem', { name: 'Автоудаление' }).click();
  await alice.getByRole('menuitem', { name: '1 день' }).click();
  await expect(
    alice.locator('.msg-row.system', { hasText: 'включил(а) автоудаление: 1 день' }),
  ).toBeVisible();
});

test('комментарии к постам и голосовой чат в группе', async ({ browser }) => {
  const own = await signUp(browser, 'Автор', `cmt${run}`);
  const sub = await signUp(browser, 'Читатель', `cmts${run}`, true);
  const { data: s } = await service.from('profiles').select('id').eq('username', `cmts${run}`).single();

  // Канал: владелец включает комментарии, подписчик комментирует.
  await own.goto('./#/new/channel');
  await own.getByLabel('Название канала').fill(`Блог ${run}`);
  await own.getByRole('button', { name: 'Создать канал' }).click();
  await own.getByPlaceholder('Сообщение').fill('новый пост');
  await own.keyboard.press('Enter');
  const channelId = own.url().split('/c/')[1];
  await service.from('chat_members').insert({ chat_id: channelId, user_id: s!.id });
  await own.goto(`./#/c/${channelId}/info`);
  await own.locator('.info-item', { hasText: 'Комментарии' }).getByRole('switch').click();
  await sub.goto(`./#/c/${channelId}`);
  await sub.locator('.comments-btn').first().click();
  await sub.getByPlaceholder('Комментарий…').fill('отличный пост');
  await sub.getByPlaceholder('Комментарий…').press('Enter');
  await expect(sub.locator('.comment', { hasText: 'отличный пост' })).toBeVisible();
  await own.goto(`./#/c/${channelId}`);
  await expect(own.locator('.comments-btn', { hasText: '1 комментарий' })).toBeVisible();

  // Группа: голосовой чат на двоих.
  await own.goto('./#/new/group');
  await own.getByRole('button', { name: 'Далее' }).click();
  await own.getByLabel('Название группы').fill(`Созвон ${run}`);
  await own.getByRole('button', { name: 'Создать группу' }).click();
  await expect(own.getByPlaceholder('Сообщение')).toBeVisible();
  const groupId = own.url().split('/c/')[1];
  await service.from('chat_members').insert({ chat_id: groupId, user_id: s!.id });
  await own.locator('.chat-header').getByRole('button', { name: 'more' }).click();
  await own.getByRole('menuitem', { name: 'Начать голосовой чат' }).click();
  await expect(own.locator('.gc-panel')).toBeVisible();
  await sub.goto(`./#/c/${groupId}`);
  await sub.locator('.gc-bar').getByRole('button', { name: 'Присоединиться' }).click();
  await expect(sub.locator('.gc-panel')).toHaveAttribute('data-connected', '1', { timeout: 20_000 });
  await expect(own.locator('.gc-panel')).toHaveAttribute('data-connected', '1', { timeout: 20_000 });
  await expect(own.locator('.gc-member')).toHaveCount(2);
  await sub.screenshot({ path: 'test-results/group-call.png' });
  await sub.getByRole('button', { name: 'Выйти' }).click();
  await expect(own.locator('.gc-member')).toHaveCount(1);
  await own.getByRole('button', { name: 'Выйти' }).click();
  await expect(own.locator('.gc-panel')).toHaveCount(0);
});

test('без сети сообщение ждёт с «часиками» и уходит, когда сеть появилась', async ({ browser }) => {
  const alice = await signUp(browser, 'Алиса', `aliceo${run}`);
  const bob = await signUp(browser, 'Боб', `bobo${run}`);

  await alice.getByPlaceholder('Поиск по @имени или чатам').fill(`@bobo${run}`);
  await alice.locator('.list-item', { hasText: 'Боб' }).click();
  await alice.getByPlaceholder('Сообщение').fill('Первое');
  await alice.keyboard.press('Enter');
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toBeVisible();

  await alice.context().setOffline(true);
  await alice.getByPlaceholder('Сообщение').fill('Отправлено без сети');
  await alice.keyboard.press('Enter');
  const bubble = alice.locator('.msg-row.own', { hasText: 'Отправлено без сети' });
  await expect(bubble).toBeVisible();
  await expect(bubble.locator('.tick')).toBeVisible();
  await alice.waitForTimeout(1000);
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).not.toContainText('Отправлено без сети');

  await alice.context().setOffline(false);
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toContainText('Отправлено без сети', {
    timeout: 30_000,
  });
});
