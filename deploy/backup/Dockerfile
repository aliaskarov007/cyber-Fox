# Образ ночного бэкапа.
#
# Отдельный образ, а не команда в compose: копия должна уезжать с машины клуба
# зашифрованной, а для этого нужны и pg_dump, и ssh, и шифрование. Ставить их
# в контейнер при каждом запуске — значит зависеть от интернета в момент,
# когда он может быть недоступен.

FROM alpine:3.20

RUN apk add --no-cache postgresql16-client openssh-client rsync age tzdata

COPY deploy/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

ENTRYPOINT ["/usr/local/bin/backup.sh"]
