#!/usr/bin/env bash
#
# Сброс пароля сотрудника — когда владелец забыл свой.
#
#   sudo /opt/cyber-fox/deploy/reset-password.sh              # показать, кто есть
#   sudo /opt/cyber-fox/deploy/reset-password.sh owner@club.kz # придумать новый
#   sudo /opt/cyber-fox/deploy/reset-password.sh owner@club.kz МойПароль123
#
# Пароль печатается на экран один раз. Отправить его почтой нельзя: почтового
# канала у системы нет, а заводить его ради одной операции в год — лишняя
# служба, которую потом сопровождать.
#
# Вместе с паролем поднимается tokenVersion: прежние токены перестают
# действовать. Иначе сброс пароля не выгонял бы того, кто уже сидит в кассе
# с открытой вкладкой, — а сбрасывают пароль обычно именно поэтому.

set -euo pipefail

DIR="/opt/cyber-fox"
EMAIL="${1:-}"
PASSWORD="${2:-}"

ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запустите от root: допишите sudo"
cd "$DIR" 2>/dev/null || fail "Нет каталога $DIR — Cyber-Fox здесь не установлен"

# Список сотрудников, когда почта не названа: угадывать её владельцу незачем,
# а ошибиться в ней легко — на экране входа она пишется один раз при
# регистрации и больше нигде не показывается.
if [ -z "$EMAIL" ]; then
  echo "Кому можно сбросить пароль:"
  echo
  docker compose exec -T server node -e '
    const { PrismaClient } = require("@prisma/client");
    const prisma = new PrismaClient();
    prisma.staff
      .findMany({ select: { email: true, fullName: true, role: true, isActive: true } })
      .then((rows) => {
        for (const r of rows) {
          const off = r.isActive ? "" : " (отключён)";
          console.log(`  ${r.email}  —  ${r.fullName}, ${r.role}${off}`);
        }
        if (!rows.length) console.log("  никого: клуб ещё не зарегистрирован");
      })
      .finally(() => prisma.$disconnect());
  ' || fail "Сервер не отвечает: cd $DIR && docker compose ps"
  echo
  echo "Повторите с почтой: sudo $0 почта@клуб.kz"
  exit 0
fi

# Пароль из букв и цифр: его диктуют вслух и набирают на клубной клавиатуре,
# где символы вроде ~ и | ищут дольше, чем играют.
if [ -z "$PASSWORD" ]; then
  PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)"
fi

[ "${#PASSWORD}" -ge 8 ] || fail "Пароль короче 8 символов — вход его не примет"

docker compose exec -T server node -e '
  const { PrismaClient } = require("@prisma/client");
  const bcrypt = require("bcryptjs");
  const prisma = new PrismaClient();
  const [email, password] = process.argv.slice(1);

  prisma.staff
    .updateMany({
      where: { email },
      data: {
        passwordHash: bcrypt.hashSync(password, 10),
        tokenVersion: { increment: 1 },
      },
    })
    .then((result) => {
      if (!result.count) {
        console.error("НЕТ_ТАКОЙ_ПОЧТЫ");
        process.exitCode = 1;
      }
    })
    .finally(() => prisma.$disconnect());
' "$EMAIL" "$PASSWORD" || fail "Почта $EMAIL не найдена — запустите без неё, чтобы увидеть список"

ok "Пароль для $EMAIL изменён"
echo
echo "  Новый пароль: $PASSWORD"
echo
echo "  Запишите его сейчас — больше он нигде не показывается."
echo "  Прежние входы этого сотрудника отменены: вкладки придётся открыть заново."
