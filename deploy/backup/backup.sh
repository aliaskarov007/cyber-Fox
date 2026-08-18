#!/bin/sh
# Ночной бэкап базы клуба.
#
# Три шага: снять дамп, зашифровать, увезти с машины. Первые два обязательны,
# третий включается, когда клуб настроил внешнее хранилище.
#
# Порядок именно такой: шифруем до отправки, поэтому на чужом хранилище лежит
# то, что без ключа не прочитать. В дампе — имена гостей, телефоны и остатки на
# счетах.

set -eu

# Ключ переносится к себе и закрывается от чужих: ssh отказывается работать с
# ключом, который читает кто угодно, а права примонтированного файла задаёт
# хозяйская машина — на Windows они всегда «читают все».
KEY=/tmp/offsite-key
if [ -s /keys/offsite ]; then
  cp /keys/offsite "$KEY"
  chmod 600 "$KEY"
fi

DB_HOST="${PGHOST:-db}"
DB_USER="${POSTGRES_USER:-cyberfox}"
DB_NAME="${POSTGRES_DB:-cyberfox}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

while true; do
  STAMP=$(date +%F-%H%M)
  DUMP="/tmp/cyberfox-$STAMP.sql"
  OUT="/backups/cyberfox-$STAMP.sql.gz"

  # Сначала в файл, потом сжимаем: в конвейере код возврата достаётся gzip, и
  # упавший pg_dump отчитался бы об успехе.
  if pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" > "$DUMP"; then
    gzip -c "$DUMP" > "$OUT"

    # Шифрование включается ключом получателя. Без него копия остаётся только
    # локальной: увозить незашифрованные данные гостей на чужой диск нельзя.
    if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
      age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT.age" "$OUT"
      rm -f "$OUT"
      OUT="$OUT.age"
    fi

    echo "бэкап готов: $STAMP ($(wc -c < "$OUT") байт)"

    if [ -n "${OFFSITE_HOST:-}" ]; then
      if [ ! -s "$KEY" ]; then
        echo "ОТПРАВКА ОТМЕНЕНА: нет ключа доступа к хранилищу"
      elif [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
        # Отправить незашифрованный дамп наружу хуже, чем не отправить вовсе.
        echo "ОТПРАВКА ОТМЕНЕНА: не задан BACKUP_AGE_RECIPIENT"
      elif rsync -e "ssh -p ${OFFSITE_PORT:-23} -i "$KEY" -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
            "$OUT" "${OFFSITE_USER}@${OFFSITE_HOST}:${OFFSITE_PATH:-./cyberfox/}"; then
        echo "копия уехала: ${OFFSITE_HOST}"
      else
        # Молчать нельзя: клуб думал бы, что копия есть, до дня аварии.
        echo "КОПИЯ НЕ УЕХАЛА: ${OFFSITE_HOST}"
      fi
    fi
  else
    # Обрезанный файл хуже отсутствия бэкапа: он выглядит рабочим.
    echo "БЭКАП НЕ СДЕЛАН: $STAMP"
  fi

  rm -f "$DUMP"
  find /backups -name "cyberfox-*.sql.gz*" -mtime "+$KEEP_DAYS" -delete
  sleep 86400
done
