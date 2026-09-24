#!/usr/bin/env bash
# Установка TURN-сервера (coturn) для звонков Bobogram на Ubuntu/Debian VPS.
#
# Запуск на сервере (под root):
#   curl -fsSL https://raw.githubusercontent.com/bobopsya/bobogram/main/scripts/turn-setup.sh | bash -s СЕКРЕТ
#
# СЕКРЕТ — та же строка, что в секрете GitHub TURN_SECRET (16+ символов: латиница, цифры, _ и -).
set -euo pipefail

SECRET="${1:-}"
if [[ ! "$SECRET" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
  echo "Укажите секрет: ... | bash -s СЕКРЕТ   (16+ символов: латиница, цифры, _ и -)" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Запустите под root (или через sudo bash)." >&2
  exit 1
fi

echo "==> Устанавливаю coturn…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq coturn curl iptables >/dev/null

PUBLIC_IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
PRIVATE_IP="$(hostname -I | awk '{print $1}')"
echo "==> Внешний IP: $PUBLIC_IP"

# Порт 443 (TCP) проходит через любые мобильные сети. Если он свободен (нет веб-сервера),
# перенаправляем его на 3478 правилом iptables при каждом запуске coturn.
USE_443=1
if ss -ltn '( sport = :443 )' | grep -q LISTEN; then
  echo "==> Порт 443 занят другим сервисом — TURN будет только на 3478."
  USE_443=0
fi

EXTERNAL="external-ip=$PUBLIC_IP"
if [[ -n "$PRIVATE_IP" && "$PRIVATE_IP" != "$PUBLIC_IP" ]]; then
  EXTERNAL="external-ip=$PUBLIC_IP/$PRIVATE_IP"
fi

cat > /etc/turnserver.conf <<EOF
# Bobogram TURN (создано scripts/turn-setup.sh)
listening-port=3478
$EXTERNAL
min-port=49152
max-port=65535
realm=bobogram
fingerprint
use-auth-secret
static-auth-secret=$SECRET
stale-nonce=600
user-quota=12
total-quota=1200
no-cli
no-tls
no-dtls
no-multicast-peers
no-software-attribute
# Не пускать релей во внутренние сети сервера
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=syslog
simple-log
EOF

# Разрешить запуск как службы (Debian/Ubuntu выключают по умолчанию).
if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi
mkdir -p /etc/systemd/system/coturn.service.d
REDIRECT_RULE="PREROUTING -p tcp --dport 443 -j REDIRECT --to-ports 3478"
{
  echo "[Service]"
  if [[ $USE_443 == 1 ]]; then
    echo "ExecStartPre=+/bin/sh -c 'iptables -t nat -C $REDIRECT_RULE 2>/dev/null || iptables -t nat -A $REDIRECT_RULE'"
  fi
} > /etc/systemd/system/coturn.service.d/override.conf
if [[ $USE_443 == 1 ]]; then
  iptables -t nat -C $REDIRECT_RULE 2>/dev/null || iptables -t nat -A $REDIRECT_RULE || true
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  echo "==> Открываю порты в ufw…"
  ufw allow 3478/udp >/dev/null
  ufw allow 3478/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 49152:65535/udp >/dev/null
fi

systemctl daemon-reload
systemctl enable coturn >/dev/null 2>&1
systemctl restart coturn
sleep 2

if systemctl is-active --quiet coturn && ss -lun | grep -q ':3478'; then
  echo
  echo "✅ TURN-сервер работает: $PUBLIC_IP:3478 (UDP/TCP)$([[ $USE_443 == 1 ]] && echo ", 443 (TCP)")"
  echo "   Добавьте в GitHub секрет TURN_SECRET с тем же значением и перезапустите деплой."
  echo
  echo "⚠️  Смените пароль root, если он где-то публиковался:  passwd"
else
  echo "❌ coturn не запустился. Журнал:" >&2
  journalctl -u coturn -n 30 --no-pager >&2 || true
  exit 1
fi
