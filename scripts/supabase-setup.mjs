#!/usr/bin/env node
// Автоматическая настройка проекта Supabase для Bobogram (запускается в GitHub Actions).
//
// Нужен только секрет SUPABASE_ACCESS_TOKEN (Supabase → Account → Access Tokens).
// Проект ищется по имени «bobogram» (или берётся SUPABASE_PROJECT_REF, если задан).
//
// Что делает:
//   1. применяет SQL-миграции из supabase/migrations (каждую один раз);
//   2. настраивает вход: без подтверждения почты, адрес сайта;
//   3. публикует серверную функцию supabase/functions/bobogram;
//   4. отдаёт адрес проекта и публичный ключ для сборки сайта (в GITHUB_OUTPUT).
import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const API = process.env.SUPABASE_API_URL || 'https://api.supabase.com/v1';
const token = process.env.SUPABASE_ACCESS_TOKEN;
const siteUrl = process.env.SITE_URL || 'https://bobogram.org/';

function output(name, value) {
  console.log(`${name}=${name.includes('KEY') ? '***' : value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

if (!token) {
  console.log('SUPABASE_ACCESS_TOKEN не задан — сайт соберётся без базы (покажет экран «Нужна настройка»).');
  output('configured', 'false');
  process.exit(0);
}

async function api(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (res.ok) return res.status === 204 ? null : res.json();
    const text = await res.text();
    // Проект может ещё создаваться или API ограничивает частоту — подождём.
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
}

// ---------- 1. найти проект ----------
let ref = process.env.SUPABASE_PROJECT_REF;
if (ref) {
  const project = await api(`/projects/${ref}`).catch((err) => fail(`Нет доступа к проекту ${ref}: ${err.message}`));
  console.log(`Проект: ${project.name} (${ref}), статус ${project.status}`);
  if (project.status && project.status !== 'ACTIVE_HEALTHY') {
    fail(
      project.status.includes('PAUSED') || project.status === 'INACTIVE'
        ? 'Проект Supabase на паузе. Откройте supabase.com → проект → Restore project и перезапустите деплой.'
        : `Проект ещё не готов (статус ${project.status}). Подождите пару минут и перезапустите деплой.`,
    );
  }
} else {
  const projects = await api('/projects');
  const byName = projects.filter((p) => p.name?.toLowerCase() === 'bobogram');
  const project = byName[0] ?? (projects.length === 1 ? projects[0] : null);
  if (!project) {
    fail(
      projects.length
        ? `Не нашёл проект с именем «bobogram». Есть: ${projects.map((p) => p.name).join(', ')}. ` +
            'Переименуйте нужный проект в bobogram или добавьте секрет SUPABASE_PROJECT_REF.'
        : 'В аккаунте Supabase нет проектов. Создайте проект с именем bobogram (см. docs/SETUP.md).',
    );
  }
  ref = project.ref ?? project.id;
  console.log(`Проект: ${project.name} (${ref}), статус ${project.status}`);
  if (project.status && project.status !== 'ACTIVE_HEALTHY') {
    fail(
      project.status.includes('PAUSED') || project.status === 'INACTIVE'
        ? 'Проект Supabase на паузе. Откройте supabase.com → проект → Restore project и перезапустите деплой.'
        : `Проект ещё не готов (статус ${project.status}). Подождите пару минут и перезапустите деплой.`,
    );
  }
}

const query = (sql) => api(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query: sql }) });

// ---------- 2. миграции ----------
await query(`
  create schema if not exists private;
  create table if not exists private.bobogram_migrations (name text primary key, applied_at timestamptz not null default now());
`);
const applied = new Set((await query('select name from private.bobogram_migrations')).map((r) => r.name));
const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
for (const file of files) {
  if (applied.has(file)) continue;
  console.log(`Применяю миграцию ${file}…`);
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  const name = file.replace(/'/g, "''");
  await query(`begin;\n${sql}\ninsert into private.bobogram_migrations (name) values ('${name}');\ncommit;`);
}
console.log(`Миграции: применено ${files.length - applied.size} новых, всего ${files.length}.`);

// Адрес серверной функции — чтобы база сама вызывала рассылку пушей.
await query(`
  insert into private.config (key, value) values ('functions_url', 'https://${ref}.supabase.co/functions/v1')
  on conflict (key) do update set value = excluded.value;
`);

// Свой TURN-сервер для звонков (scripts/turn-setup.sh на VPS): секрет и адрес.
const turnSecret = process.env.TURN_SECRET?.trim();
const turnHost = process.env.TURN_HOST?.trim();
if (turnSecret && turnHost) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(turnSecret) || !/^[A-Za-z0-9.:-]{3,253}$/.test(turnHost)) {
    fail('TURN_SECRET или TURN_HOST в неверном формате.');
  }
  await query(`
    insert into private.config (key, value) values ('turn_secret', '${turnSecret}'), ('turn_host', '${turnHost}')
    on conflict (key) do update set value = excluded.value;
  `);
  console.log(`TURN-сервер: ${turnHost}`);
} else {
  console.log('TURN_SECRET не задан — звонки идут без своего TURN-сервера.');
}

// ---------- 3. вход по юзернейму: без писем и подтверждений ----------
await api(`/projects/${ref}/config/auth`, {
  method: 'PATCH',
  body: JSON.stringify({
    site_url: siteUrl,
    // Старый адрес на GitHub Pages тоже пускаем: он перенаправляет на домен.
    uri_allow_list: `${siteUrl},https://bobopsya.github.io/bobogram/`,
    external_email_enabled: true,
    mailer_autoconfirm: true,
    mailer_secure_email_change_enabled: false,
    disable_signup: false,
    password_min_length: 6,
  }),
});
console.log('Настройки входа обновлены.');

// ---------- 4. серверная функция ----------
console.log('Публикую серверную функцию…');
if (!process.env.SKIP_FUNCTION_DEPLOY) execFileSync(
  'npx',
  ['supabase', 'functions', 'deploy', 'bobogram', '--project-ref', ref, '--no-verify-jwt', '--use-api'],
  { stdio: 'inherit', env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } },
);

// ---------- 5. ключи для сайта ----------
const keys = await api(`/projects/${ref}/api-keys?reveal=true`);
const publishable = keys.find((k) => k.type === 'publishable') ?? keys.find((k) => k.name === 'anon');
if (!publishable?.api_key) fail('Не удалось получить публичный ключ проекта.');

output('configured', 'true');
output('SUPABASE_URL', `https://${ref}.supabase.co`);
output('SUPABASE_ANON_KEY', publishable.api_key);
console.log('\n✅ Supabase настроен.');
