#!/usr/bin/env python3
"""bobodev — консоль владельца и основателей Bobogram.

Запуск:   python3 bobodev.py            (спросит @имя и пароль)
          python3 bobodev.py -u имя -c "status" -c "logs 10"   (одноразовые команды)
Пароль можно передать переменной BOBODEV_PASSWORD. Ничего на диск не сохраняется.

Нужен только Python 3.9+, ставить ничего не надо. Все права проверяет сервер: консоль работает
только у владельца и основателей, у остальных команды отвечают «нет прав».
"""
import argparse
import cmd
import getpass
import json
import os
import re
import shlex
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

URL = os.environ.get("BOBODEV_URL", "__SUPABASE_URL__").rstrip("/")
KEY = os.environ.get("BOBODEV_KEY", "__SUPABASE_KEY__")
FOREVER = "9999-12-31T00:00:00Z"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001 — старый Python или не терминал
    pass

COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
if COLOR and os.name == "nt":
    os.system("")  # включает ANSI-цвета в консоли Windows


def paint(text, code):
    return "\033[%sm%s\033[0m" % (code, text) if COLOR else text


def ok(text):
    print(paint("✔ " + text, "32"))


def warn(text):
    print(paint("! " + text, "33"))


def bad(text):
    print(paint("✘ " + text, "31"))


class ApiError(Exception):
    pass


class Api:
    """Минимальный клиент Supabase (вход по паролю + REST/RPC)."""

    def __init__(self):
        self.token = None
        self.expires = 0.0
        self.username = ""
        self.password = ""
        self.uid = ""

    def _request(self, method, path, body=None, auth=True):
        if auth and self.token and time.time() > self.expires:
            self.login(self.username, self.password)  # токен живёт час — входим заново
        headers = {"apikey": KEY, "Content-Type": "application/json"}
        headers["Authorization"] = "Bearer " + (self.token if auth and self.token else KEY)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(URL + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8", "replace")
            try:
                info = json.loads(raw)
                text = info.get("message") or info.get("msg") or info.get("error_description") or raw
            except ValueError:
                text = raw
            if "not allowed" in text or err.code in (401, 403):
                text = ("действие запрещено сервером (%s): консоль только для владельца и основателей, "
                        "а себя, владельца и основателей трогать нельзя" % text)
            raise ApiError(text) from None
        except urllib.error.URLError as err:
            raise ApiError("нет связи с сервером: %s" % err.reason) from None
        return json.loads(raw) if raw else None

    def login(self, username, password):
        name = username.strip().lstrip("@")
        email = self._request("POST", "/rest/v1/rpc/login_email", {"p_username": name}, auth=False)
        if not email:
            raise ApiError("нет такого пользователя")
        try:
            res = self._request(
                "POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password}, auth=False
            )
        except ApiError:
            raise ApiError("неверный пароль") from None
        self.token = res["access_token"]
        self.expires = time.time() + int(res.get("expires_in", 3600)) - 60
        self.username, self.password, self.uid = name, password, res["user"]["id"]

    def rpc(self, fn, args=None):
        return self._request("POST", "/rest/v1/rpc/" + fn, args or {})

    def select(self, table, **params):
        return self._request("GET", "/rest/v1/%s?%s" % (table, urllib.parse.urlencode(params)))


# ---------- форматирование ----------
def parse_ts(value):
    m = re.match(r"(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d:\d\d)(?:\.\d+)?(Z|[+-]\d\d(?::?\d\d)?)?", value or "")
    if not m:
        return None
    dt = datetime.strptime(m.group(1) + " " + m.group(2), "%Y-%m-%d %H:%M:%S")
    tz = m.group(3)
    if tz and tz != "Z":
        sign = -1 if tz[0] == "-" else 1
        digits = tz[1:].replace(":", "")
        dt -= sign * timedelta(hours=int(digits[:2]), minutes=int(digits[2:4] or 0))
    return dt.replace(tzinfo=timezone.utc)


def fmt_ts(value):
    dt = parse_ts(value)
    if not dt:
        return "—"
    if dt.year >= 9000:
        return "навсегда"
    return dt.astimezone().strftime("%d.%m.%Y %H:%M")


def parse_duration(text):
    """30m / 2h / 7d / forever → (ISO-время или None для «навсегда»)."""
    t = text.strip().lower()
    if t in ("forever", "навсегда", "inf"):
        return None
    m = re.fullmatch(r"(\d+)\s*([mhdмчд])", t)
    if not m:
        raise ApiError("не понял срок «%s» — примеры: 30m, 2h, 7d, forever" % text)
    unit = {"m": "minutes", "м": "minutes", "h": "hours", "ч": "hours", "d": "days", "д": "days"}[m.group(2)]
    until = datetime.now(timezone.utc) + timedelta(**{unit: int(m.group(1))})
    return until.strftime("%Y-%m-%dT%H:%M:%SZ")


def split_flags(args, flags):
    """Достаёт --for X и булевы флаги; остальное — текст."""
    rest, found, i = [], {}, 0
    while i < len(args):
        a = args[i]
        if a == "--for" and i + 1 < len(args):
            found["for"] = args[i + 1]
            i += 2
            continue
        if a.startswith("--") and a[2:] in flags:
            found[a[2:]] = True
        else:
            rest.append(a)
        i += 1
    return rest, found


def table(rows):
    width = max((len(k) for k, _ in rows), default=0)
    for key, value in rows:
        print("  %s  %s" % (paint(key.ljust(width), "36"), value))


HELP = """
Команды (текст в <> — подставьте своё):
  status                         сводка: пользователи, режимы, фоновые задачи, база
  maintenance on [--for 30m] [текст]   техобслуживание: всем, кроме админов, экран «Идут работы»
  maintenance off                выключить техобслуживание
  shield on|off                  щит: лимит сообщений, автоблок IP при всплеске регистраций
  signups open|invite|closed     регистрация: открыта / по приглашениям / закрыта
  invite new [uses] [days]       новый код приглашения (по умолчанию 1 раз, 7 дней)
  invite list | invite revoke <код>
  user <@имя>                    профиль, устройства (IP, браузер), наказания
  ban <@имя> [--for 7d] [--no-ip] [--no-device] [причина]   бан с причиной и сроком
  unban <@имя>                   снять бан (и блокировки его IP/устройств)
  spam <@имя> [--for 1d] [причина]   спамблок;  unspam <@имя> — снять
  logs [n]                       последние записи журнала действий
  broadcast <текст>              рассылка всем от Bobotools (спросит подтверждение)
  cloudflare                     как защитить сайт от сетевого DDoS
  ping | whoami | exit
Срок: 30m, 2h, 7d или forever.
"""

CLOUDFLARE = """
Щит внутри Bobogram режет спам и ботов (лимиты, закрытая регистрация, автоблок IP), но настоящий
сетевой DDoS отбивает то, что стоит перед сайтом:
  1. Сайт на GitHub Pages уже отдаётся через CDN GitHub — статику не положить.
  2. Для bobogram.org: домен в Cloudflare (оранжевое облако) → Security → «Under Attack Mode»
     включайте на время атаки; «Bot Fight Mode» и правило Rate Limiting на /rest/v1 и /auth/v1.
  3. API живёт на supabase.co: у Supabase своя защита от перегрузки; для своей защиты нужен
     кастомный домен Supabase (платная опция) за Cloudflare.
  4. Во время атаки: `shield on`, `signups invite` (или closed), при необходимости `maintenance on`.
"""


class Console(cmd.Cmd):
    prompt = paint("bobodev> ", "35")

    def __init__(self, api):
        super().__init__()
        self.api = api

    # --- служебное ---
    def emptyline(self):
        pass

    def default(self, line):
        bad("неизвестная команда «%s». Напишите help" % line.split()[0])

    def onecmd(self, line):
        try:
            return super().onecmd(line)
        except ApiError as err:
            bad(str(err))
        except KeyboardInterrupt:
            print()
        return False

    def do_help(self, arg):
        print(HELP)

    def do_exit(self, arg):
        return True

    do_quit = do_exit
    do_EOF = do_exit

    def _args(self, arg):
        try:
            return shlex.split(arg)
        except ValueError as err:
            raise ApiError("не получилось разобрать строку: %s" % err) from None

    def _find_user(self, name):
        name = name.strip().lstrip("@")
        if not name:
            raise ApiError("укажите @имя")
        pattern = name.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        rows = self.api.select("profiles", select="*", username="ilike." + pattern, limit="5")
        for row in rows:
            if row["username"].lower() == name.lower():
                return row
        raise ApiError("пользователь @%s не найден" % name)

    # --- команды ---
    def do_ping(self, arg):
        t = time.time()
        self.api.rpc("get_service_status")
        print("  %d мс" % ((time.time() - t) * 1000))

    def do_whoami(self, arg):
        print("  @%s (%s)" % (self.api.username, self.api.uid))

    def do_status(self, arg):
        s = self.api.rpc("dev_status")
        m = s.get("maintenance") or {}
        signups = {"open": "открыта", "invite": "по приглашениям", "closed": "закрыта"}.get(s.get("signups"), "?")
        print(paint("Сервис", "1"))
        table(
            [
                ("техобслуживание", paint("ВКЛЮЧЕНО", "31") + (" — " + m["message"] if m.get("message") else "")
                 if m.get("on") else "выключено"),
                ("щит", paint("включён", "32") if s.get("shield") else "выключен"),
                ("регистрация", signups),
                ("приглашений активно", s.get("invites_active", 0)),
                ("блокировок IP/устройств", s.get("device_bans", 0)),
                ("размер базы", "%s МБ" % s.get("db_mb", "?")),
            ]
        )
        print(paint("Люди и активность", "1"))
        table(
            [
                ("пользователей", s.get("users")),
                ("новых за сутки / неделю", "%s / %s" % (s.get("users_day"), s.get("users_week"))),
                ("в сети за час", s.get("online_hour")),
                ("сообщений за сутки", s.get("messages_day")),
                ("в бане / спамблоке", "%s / %s" % (s.get("banned"), s.get("spamblocked"))),
                ("открытых жалоб", s.get("reports_open")),
            ]
        )
        jobs = s.get("cron") or []
        if jobs:
            print(paint("Фоновые задачи", "1"))
            for j in jobs:
                good = j.get("last_status") in ("succeeded", None)
                mark = paint("●", "32" if good and j.get("active") else "31")
                print("  %s %s  последний запуск: %s  %s" % (
                    mark, j["job"].ljust(24), fmt_ts(j.get("last_run")), j.get("last_status") or "ещё не было"))

    def do_maintenance(self, arg):
        args = self._args(arg)
        if not args or args[0] not in ("on", "off"):
            raise ApiError("maintenance on [--for 30m] [текст]  |  maintenance off")
        if args[0] == "off":
            self.api.rpc("dev_set_maintenance", {"p_on": False})
            return ok("техобслуживание выключено")
        rest, flags = split_flags(args[1:], ())
        until = parse_duration(flags["for"]) if "for" in flags else None
        self.api.rpc("dev_set_maintenance", {"p_on": True, "p_message": " ".join(rest) or None, "p_until": until})
        ok("техобслуживание включено: обычные пользователи видят экран «Идут работы», админы работают как обычно")

    def do_shield(self, arg):
        args = self._args(arg)
        if args not in (["on"], ["off"]):
            raise ApiError("shield on|off")
        self.api.rpc("dev_set_shield", {"p_on": args[0] == "on"})
        ok("щит включён: ≤20 сообщений за 30 с, автоблок IP при 5 регистрациях за 10 минут, не больше 30 "
           "регистраций за 10 минут" if args[0] == "on" else "щит выключен")

    def do_signups(self, arg):
        args = self._args(arg)
        if len(args) != 1 or args[0] not in ("open", "invite", "closed"):
            raise ApiError("signups open|invite|closed")
        self.api.rpc("dev_set_signups", {"p_mode": args[0]})
        ok("регистрация: " + {"open": "открыта", "invite": "только по приглашениям", "closed": "закрыта"}[args[0]])

    def do_invite(self, arg):
        args = self._args(arg)
        if args[:1] == ["new"]:
            uses = int(args[1]) if len(args) > 1 and args[1].isdigit() else 1
            days = int(args[2]) if len(args) > 2 and args[2].isdigit() else 7
            code = self.api.rpc("dev_invite_create", {"p_uses": uses, "p_days": days})
            return ok("код приглашения: %s  (использований: %d, действует %d дн.)" % (paint(code, "1"), uses, days))
        if args[:1] == ["list"]:
            rows = self.api.rpc("dev_invite_list")
            if not rows:
                return print("  активных приглашений нет")
            for r in rows:
                print("  %s  осталось %s  до %s" % (r["code"], r["uses_left"], fmt_ts(r["expires_at"])))
            return None
        if args[:1] == ["revoke"] and len(args) == 2:
            self.api.rpc("dev_invite_revoke", {"p_code": args[1]})
            return ok("приглашение отозвано")
        raise ApiError("invite new [uses] [days]  |  invite list  |  invite revoke <код>")

    def do_user(self, arg):
        p = self._find_user(arg)
        flags = [f for f, on in (("админ", p["role"] == "admin"), ("основатель", p.get("founder")),
                                  ("со-владелец", p.get("co_owner")), ("бот", p.get("is_bot")),
                                  ("подтверждён", p.get("verified"))) if on]
        print(paint("@%s  %s" % (p["username"], p["display_name"]), "1"))
        rows = [
            ("id", p["id"]),
            ("регистрация", fmt_ts(p["created_at"])),
            ("был(а) в сети", fmt_ts(p.get("last_seen"))),
            ("статус", ", ".join(flags) or "обычный"),
            ("бан", paint("ЗАБАНЕН", "31") if p["banned"] else "нет"),
            ("спамблок", "до " + fmt_ts(p["spam_until"]) if p.get("spam_until") and
             (parse_ts(p["spam_until"]) or datetime.min.replace(tzinfo=timezone.utc)) > datetime.now(timezone.utc)
             else "нет"),
        ]
        pun = self.api.select("punishments", select="*", user_id="eq." + p["id"])
        if pun:
            if pun[0].get("ban_reason") or pun[0].get("ban_until"):
                rows.append(("причина бана", "%s  (до %s)" % (pun[0].get("ban_reason") or "—", fmt_ts(pun[0].get("ban_until")))))
            if pun[0].get("spam_reason"):
                rows.append(("причина спамблока", pun[0]["spam_reason"]))
        table(rows)
        try:
            devices = self.api.rpc("admin_user_devices", {"p_user": p["id"]})
        except ApiError as err:
            return warn("устройства не показать: %s" % err)
        print(paint("Устройства (%d)" % len(devices), "1"))
        for d in devices:
            info = d.get("info") or {}
            marks = (" [IP в бане]" if d.get("ip_banned") else "") + (" [устройство в бане]" if d.get("device_banned") else "")
            print("  %s  %s  %s%s" % ((d.get("ip") or "—").ljust(18), fmt_ts(d["last_seen"]), (d.get("user_agent") or "")[:60], marks))
            print("      v%s · pwa=%s · push=%s · экран %s" % (info.get("app", "?"), info.get("pwa"), info.get("push"), info.get("screen", "?")))
        return None

    def do_ban(self, arg):
        rest, flags = split_flags(self._args(arg), ("no-ip", "no-device"))
        if not rest:
            raise ApiError("ban <@имя> [--for 7d] [--no-ip] [--no-device] [причина]")
        p = self._find_user(rest[0])
        until = parse_duration(flags.get("for", "7d"))
        self.api.rpc("admin_ban_user", {
            "p_user": p["id"], "p_reason": " ".join(rest[1:]), "p_until": until,
            "p_ip": "no-ip" not in flags, "p_device": "no-device" not in flags})
        ok("@%s забанен(а) %s%s%s" % (p["username"], "до " + fmt_ts(until) if until else "навсегда",
           "" if "no-ip" in flags else ", IP заблокирован", "" if "no-device" in flags else ", устройства заблокированы"))

    def do_unban(self, arg):
        p = self._find_user(arg)
        self.api.rpc("set_banned", {"p_user": p["id"], "p_banned": False})
        ok("@%s разбанен(а), блокировки её/его IP и устройств сняты" % p["username"])

    def do_spam(self, arg):
        rest, flags = split_flags(self._args(arg), ())
        if not rest:
            raise ApiError("spam <@имя> [--for 1d] [причина]")
        p = self._find_user(rest[0])
        until = parse_duration(flags.get("for", "1d")) or FOREVER
        self.api.rpc("admin_set_spamblock", {"p_user": p["id"], "p_until": until, "p_reason": " ".join(rest[1:])})
        ok("@%s в спамблоке до %s" % (p["username"], fmt_ts(until)))

    def do_unspam(self, arg):
        p = self._find_user(arg)
        self.api.rpc("admin_set_spamblock", {"p_user": p["id"], "p_until": None})
        ok("спамблок с @%s снят" % p["username"])

    def do_logs(self, arg):
        n = int(arg) if arg.strip().isdigit() else 20
        rows = self.api.rpc("dev_logs", {"p_limit": n})
        if not rows:
            return print("  журнал пуст (лог-группа ещё не назначена командой /setlogs?)")
        for r in reversed(rows):
            print("  %s  %s" % (paint(fmt_ts(r["created_at"]), "90"), r["body"].replace("\n", "\n" + " " * 19)))
        return None

    def do_broadcast(self, arg):
        text = arg.strip()
        if not text:
            raise ApiError("broadcast <текст>")
        print("Будет отправлено ВСЕМ пользователям от Bobotools:\n  " + text)
        if input("Отправить? [y/N] ").strip().lower() not in ("y", "yes", "д", "да"):
            return print("  отменено")
        n = self.api.rpc("dev_broadcast", {"p_text": text})
        return ok("отправлено: %s" % n)

    def do_cloudflare(self, arg):
        print(CLOUDFLARE)


def main():
    ap = argparse.ArgumentParser(description="bobodev — консоль владельца Bobogram")
    ap.add_argument("-u", "--user", help="ваш @имя")
    ap.add_argument("-c", "--command", action="append", help="выполнить команду и выйти (можно несколько раз)")
    opts = ap.parse_args()
    if not URL.startswith("http") or not KEY or KEY.startswith("__"):
        sys.exit("Не заданы адрес и ключ сервера: скачайте консоль заново из админки "
                 "или задайте BOBODEV_URL и BOBODEV_KEY.")
    api = Api()
    try:
        name = opts.user or input("@имя: ")
        password = os.environ.get("BOBODEV_PASSWORD") or getpass.getpass("Пароль: ")
        api.login(name, password)
        api.rpc("dev_status")  # сразу проверим права
    except ApiError as err:
        sys.exit("✘ %s" % err)
    except (KeyboardInterrupt, EOFError):
        sys.exit(1)
    console = Console(api)
    if opts.command:
        for line in opts.command:
            console.onecmd(line)
        return
    ok("вход выполнен: @%s. help — список команд." % api.username)
    try:
        console.cmdloop()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
