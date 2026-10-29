#!/usr/bin/env bash
#
# Завести платформенный вход — для того, кто продаёт систему, а не работает
# в зале. Видит все сети: тарифы, машины, гостей, последнюю активность.
#
#   sudo /opt/cyber-fox/deploy/platform-admin.sh me@cyberfoxclub.com
#   sudo /opt/cyber-fox/deploy/platform-admin.sh me@cyberfoxclub.com МойПароль123 "Имя"
#
# Повторный запуск с той же почтой меняет пароль и включает учётную запись
# обратно, если её отключали.
#
# Почему отдельным скриптом, а не prisma/platform-admin.ts: тот запускается
# через tsx, а tsx — devDependency, и образ пересобирает дерево зависимостей
# с --prod. В боевом контейнере его нет и не должно быть, поэтому здесь то же
# самое на обычном node.
#
# Этот вход НЕ открывает кассу клуба. Он показывает список сетей и их счётчики,
# войти под владельцем через него нельзя — иначе достаточно было бы завести
# себе платформенную учётку, чтобы хозяйничать в чужом зале. Забытый пароль
# сотрудника чинится через reset-password.sh.

set -euo pipefail

DIR="/opt/cyber-fox"
EMAIL="${1:-}"
PASSWORD="${2:-}"
NAME="${3:-Платформа}"

ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запустите от root: допишите sudo"
cd "$DIR" 2>/dev/null || fail "Нет каталога $DIR — Cyber-Fox здесь не установлен"
[ -n "$EMAIL" ] || fail "Нужна почта: sudo $0 me@example.com [пароль] [имя]"

if [ -z "$PASSWORD" ]; then
  PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)"
fi

# Длиннее, чем у сотрудника: этот вход открывает сразу все клубы.
[ "${#PASSWORD}" -ge 10 ] || fail "Пароль короче 10 символов — этот вход показывает все сети"

docker compose exec -T server node -e '
  const { PrismaClient } = require("@prisma/client");
  const bcrypt = require("bcryptjs");
  const prisma = new PrismaClient();
  const [email, password, fullName] = process.argv.slice(1);
  const passwordHash = bcrypt.hashSync(password, 10);

  prisma.platformAdmin
    .upsert({
      where: { email },
      update: { passwordHash, isActive: true },
      create: { email, passwordHash, fullName },
    })
    .finally(() => prisma.$disconnect());
' "$(echo "$EMAIL" | tr 'A-Z' 'a-z')" "$PASSWORD" "$NAME" || fail "Сервер не отвечает: cd $DIR && docker compose ps"

DOMAIN="$(grep -E '^CYBERFOX_DOMAIN=' .env 2>/dev/null | cut -d= -f2-)"

ok "Платформенный вход готов: $EMAIL"
echo
echo "  Пароль: $PASSWORD"
echo "  Адрес:  https://${DOMAIN:-ваш-домен}/platform"
echo
echo "  Запишите пароль сейчас — больше он нигде не показывается."
echo "  Этот вход показывает все сети, но в кассу клуба не пускает."
