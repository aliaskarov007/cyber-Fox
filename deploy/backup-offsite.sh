#!/usr/bin/env bash
#
# Бэкап наружу: ключи и проверка.
#
#   sudo /opt/cyber-fox/deploy/backup-offsite.sh keys    # завести ключи
#   sudo /opt/cyber-fox/deploy/backup-offsite.sh test    # прогнать прямо сейчас
#
# Копия базы шифруется ДО отправки, поэтому на чужом хранилище лежит то, что
# без закрытого ключа не прочитать. В дампе — имена гостей, телефоны и остатки
# на счетах, и увозить это на чужой диск в открытом виде нельзя.
#
# Ключей два, и путают их постоянно:
#
#   age  — чем шифруется копия. Закрытая половина ХРАНИТСЯ ВНЕ КЛУБА, в
#          менеджере паролей. На сервере остаётся только открытая: ею шифруют,
#          расшифровать ею нельзя. Потеряете закрытую — копии превратятся
#          в мусор, и никто, включая нас, их не вскроет.
#
#   ssh  — чем сервер попадает в хранилище. Эта половина как раз остаётся на
#          сервере: без неё отправлять было бы нечем.

set -euo pipefail

DIR="/opt/cyber-fox"
MODE="${1:-}"
SSH_KEY="$DIR/deploy/backup/offsite-key"

say()  { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запустите от root: допишите sudo"
cd "$DIR" 2>/dev/null || fail "Нет каталога $DIR — Cyber-Fox здесь не установлен"

case "$MODE" in
  keys)
    say "Ключ доступа к хранилищу"
    if [ -s "$SSH_KEY" ]; then
      ok "Уже есть: $SSH_KEY"
    else
      ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "cyberfox-backup" >/dev/null
      ok "Создан: $SSH_KEY"
    fi
    chmod 600 "$SSH_KEY"

    echo
    echo "  Эту строку добавьте в хранилище как разрешённый ключ:"
    echo
    cat "$SSH_KEY.pub"

    say "Ключ шифрования копий"
    # Генерируем в контейнере: age стоит там, а не на сервере. Закрытая
    # половина нигде не сохраняется — печатается один раз и всё.
    PAIR="$(docker compose run --rm --no-deps --entrypoint age-keygen backup 2>/dev/null)"
    SECRET="$(echo "$PAIR" | grep -v '^#' | head -1)"
    PUBLIC="$(echo "$PAIR" | grep '^# public key:' | sed 's/^# public key: //')"
    [ -n "$SECRET" ] && [ -n "$PUBLIC" ] || fail "Не удалось создать ключ шифрования"

    printf '\n\033[1;31m  ЗАКРЫТЫЙ КЛЮЧ — ПОКАЗЫВАЕТСЯ ОДИН РАЗ\033[0m\n\n'
    echo "  $SECRET"
    echo
    echo "  Сохраните его в менеджер паролей ПРЯМО СЕЙЧАС, вне этого сервера."
    echo "  На диске он не остаётся. Без него копии не расшифровать никому."
    echo
    echo "  Открытую половину впишите в .env:"
    echo
    echo "  BACKUP_AGE_RECIPIENT=$PUBLIC"
    echo

    say "Что дописать в $DIR/.env"
    cat <<TXT
  BACKUP_AGE_RECIPIENT=$PUBLIC
  OFFSITE_HOST=<адрес хранилища>
  OFFSITE_USER=<пользователь>
  OFFSITE_PORT=<порт, у Hetzner Storage Box 23, обычно 22>
  OFFSITE_PATH=./cyberfox/
  OFFSITE_KEY=./deploy/backup/offsite-key

TXT
    echo "  Папку cyberfox в хранилище создайте заранее — rsync её не заводит."
    echo "  Потом: sudo $0 test"
    ;;

  test)
    grep -q '^OFFSITE_HOST=.\+' .env 2>/dev/null || fail "В .env не задан OFFSITE_HOST"
    grep -q '^BACKUP_AGE_RECIPIENT=.\+' .env 2>/dev/null || fail "В .env не задан BACKUP_AGE_RECIPIENT"
    grep -q '^OFFSITE_KEY=.\+' .env 2>/dev/null || fail "В .env не задан OFFSITE_KEY"

    say "Делаю копию и отправляю — не дожидаясь ночи"
    if docker compose run --rm -e BACKUP_ONCE=1 backup; then
      echo
      ok "Копия сделана и уехала"
      echo
      echo "  Проверьте, что файл виден в хранилище — на него и будет вся надежда."
      echo "  Дальше это происходит само, раз в сутки."
    else
      echo
      fail "Не прошло. Причина напечатана выше — чаще всего ключ не добавлен в хранилище или нет папки ${OFFSITE_PATH:-cyberfox}"
    fi
    ;;

  *)
    echo "Бэкап наружу. Сначала ключи, потом проверка:"
    echo
    echo "  sudo $0 keys    завести ключи и показать, что вписать"
    echo "  sudo $0 test    прогнать копию прямо сейчас"
    echo
    echo "Зачем: сейчас копии лежат на этом же сервере. Его потеря унесёт"
    echo "и базу, и копии — то есть балансы всех гостей."
    exit 1
    ;;
esac
