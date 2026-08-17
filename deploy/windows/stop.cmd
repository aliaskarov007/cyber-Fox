@echo off
chcp 65001 > nul
rem Остановка Cyber-Fox. База и бэкапы остаются на месте — стирает их только
rem docker compose down -v, и делать это без нужды нельзя.

cd /d "%~dp0..\.."
docker compose -f docker-compose.yml -f deploy\lan.yml down
echo Остановлено. Данные сохранены.
pause
