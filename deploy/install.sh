#!/usr/bin/env bash
#
# Установка Cyber-Fox на чистый облачный сервер Ubuntu одной командой.
#
#   curl -fsSL https://raw.githubusercontent.com/aliaskarov007/cyber-Fox/claude/computer-club-software-56dxgx/deploy/install.sh | sudo bash -s -- club.example.kz
#
# Что делает: ставит Docker, забирает код в /opt/cyber-fox, сам придумывает
# пароль базы и секрет входа, проверяет, что домен смотрит на этот сервер,
# запускает базу, сервер, кассу с HTTPS и ежедневный бэкап — и ждёт, пока
# касса откроется по домену.
#
# Повторный запуск безопасен: пароли в .env не меняются (иначе база не
# откроется, а все сотрудники вылетят из кассы), код обновляется.

set -euo pipefail

REPO="https://github.com/aliaskarov007/cyber-Fox.git"
BRANCH="${CYBERFOX_BRANCH:-claude/computer-club-software-56dxgx}"
DIR="/opt/cyber-fox"
DOMAIN="${1:-${CYBERFOX_DOMAIN:-}}"

say()  { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запустите от root: допишите sudo перед bash"

if [ -z "$DOMAIN" ]; then
  if [ -t 0 ]; then
    read -r -p "Домен кассы (например club.example.kz): " DOMAIN
  fi
  [ -n "$DOMAIN" ] || fail "Укажите домен: … | sudo bash -s -- club.example.kz"
fi
DOMAIN="$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##' | tr 'A-Z' 'a-z')"
echo "$DOMAIN" | grep -Eq '^[a-z0-9.-]+\.[a-z]{2,}$' || fail "«$DOMAIN» не похож на домен"

# --- 1. Программы ---------------------------------------------------------

say "Ставлю нужные программы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl dnsutils >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  say "Ставлю Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || fail "Docker Compose не установился — напишите в поддержку хостинга"
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# Сборка кассы и сервера на 4 ГБ памяти без подкачки иногда падает молча.
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  say "Добавляю 2 ГБ подкачки — чтобы сборка не упала от нехватки памяти"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Если на сервере включён брандмауэр, открываем веб и не трогаем остальное.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  ok "Брандмауэр: открыты порты 80 и 443"
fi

# --- 2. Код ---------------------------------------------------------------

if [ -d "$DIR/.git" ]; then
  say "Обновляю код в $DIR"
  git -C "$DIR" fetch -q origin "$BRANCH"
  git -C "$DIR" checkout -q "$BRANCH"
  git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  say "Забираю код в $DIR"
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

# --- 3. Настройки ---------------------------------------------------------

if [ ! -f .env ]; then
  say "Создаю настройки и пароли"
  cp deploy/env.example .env
  set_env() { sed -i "s#^$1=.*#$1=$2#" .env; }
  set_env CYBERFOX_DOMAIN "$DOMAIN"
  set_env ALLOWED_ORIGINS "https://$DOMAIN"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env JWT_SECRET "$(openssl rand -hex 32)"
  set_env TZ "Asia/Almaty"
  chmod 600 .env
  ok "Пароли записаны в $DIR/.env — сохраните этот файл, без него база не откроется"
else
  ok "Настройки уже есть — пароли не трогаю"
  sed -i "s#^CYBERFOX_DOMAIN=.*#CYBERFOX_DOMAIN=$DOMAIN#; s#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=https://$DOMAIN#" .env
fi

# --- 4. Домен -------------------------------------------------------------

say "Проверяю, что $DOMAIN смотрит на этот сервер"
SERVER_IP="$(curl -fsS4 --max-time 10 https://api.ipify.org || true)"
DOMAIN_IP="$(dig +short A "$DOMAIN" | tail -n1)"
if [ -n "$SERVER_IP" ] && [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
  printf '\033[1;31m'
  echo "  Домен $DOMAIN указывает на «${DOMAIN_IP:-никуда}», а адрес сервера — $SERVER_IP."
  echo "  В настройках домена создайте A-запись: $DOMAIN → $SERVER_IP"
  echo "  и запустите эту же команду снова через 10–30 минут."
  printf '\033[0m'
  echo "  Без этого HTTPS-сертификат не выпустится, и касса не откроется."
  exit 1
fi
ok "Домен указывает на $SERVER_IP"

# --- 5. Запуск ------------------------------------------------------------

say "Собираю и запускаю — первый раз это 5–10 минут"
docker compose up -d --build

say "Жду, пока касса откроется по https://$DOMAIN"
for i in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    printf '\n\033[1;32m'
    echo "  Cyber-Fox работает: https://$DOMAIN"
    printf '\033[0m'
    echo
    echo "  Дальше:"
    echo "  1. Откройте https://$DOMAIN и нажмите «Зарегистрировать клуб»."
    echo "  2. Обновление в будущем — эта же команда."
    echo "  3. Журнал сервера: cd $DIR && docker compose logs -f server"
    exit 0
  fi
  sleep 5
done

echo
docker compose ps
fail "Касса не ответила за 5 минут. Последние строки журнала: cd $DIR && docker compose logs --tail 50 server web"
