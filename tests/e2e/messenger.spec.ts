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
  await alice.locator('input[type="file"]').setInputFiles({
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
  await dialog.locator('.swatch[aria-label="fire"]').click();
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
