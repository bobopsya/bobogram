import { expect, test, type Browser, type Page } from '@playwright/test';


const run = Date.now().toString(36).slice(-6);

async function signUp(browser: Browser, name: string, username: string, mobile = false): Promise<Page> {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' } : { locale: 'ru-RU' },
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
  await expect(bob.locator('.bubble', { hasText: 'Отлично!' }).locator('.msg-reply')).toContainText('Привет, Алиса');

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
  await expect(bob.getByText('Алиса создал(а) «Друзья»')).toBeVisible();
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
    .poll(() => bob.locator('video.call-remote').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await bob.screenshot({ path: 'test-results/screen-share.png' });

  await alice.locator('.call-btn', { hasText: 'Экран' }).click();
  await expect(bob.getByText('Алиса показывает экран')).toBeHidden({ timeout: 15_000 });
  await bob.getByRole('button', { name: 'Завершить' }).click();
  await expect(alice.locator('.call-screen')).toBeHidden({ timeout: 10_000 });
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
  await expect(bob.locator('.chat-item', { hasText: 'Алиса' })).toContainText('Отправлено без сети', { timeout: 30_000 });
});
