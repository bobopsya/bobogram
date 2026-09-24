import { expect, test, type Browser, type Page } from '@playwright/test';

const AUTH = 'http://127.0.0.1:9099';
const PROJECT = 'demo-bobogram';
const run = Date.now().toString(36);

async function verifyEmail(page: Page, email: string) {
  const res = await page.request.get(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes } = (await res.json()) as { oobCodes: { email: string; oobLink: string; requestType: string }[] };
  if (!oobCodes.some((c) => c.email === email)) console.log('oobCodes', JSON.stringify(oobCodes));
  const code = oobCodes.reverse().find((c) => c.email === email && c.requestType === 'VERIFY_EMAIL');
  expect(code, 'письмо с подтверждением').toBeTruthy();
  await page.request.get(code!.oobLink);
}

async function signUp(browser: Browser, name: string, username: string, mobile = false) {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' } : { locale: 'ru-RU' },
  );
  const page = await context.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('[browser]', m.text()));
  const email = `${username}@example.com`;
  await page.goto('./');
  await page.getByRole('button', { name: 'Нет аккаунта? Зарегистрируйтесь' }).click();
  await page.getByLabel('Почта').fill(email);
  await page.getByLabel('Пароль').fill('secret123');
  await page.getByLabel('Имя', { exact: true }).fill(name);
  await page.locator('.field-prefix input').fill(username);
  await expect(page.getByText('Имя свободно')).toBeVisible();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByText('Подтвердите почту')).toBeVisible();
  await page.waitForTimeout(1500);
  await verifyEmail(page, email);
  await page.getByRole('button', { name: 'Я подтвердил(а)' }).click();
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
