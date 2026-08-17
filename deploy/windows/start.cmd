@echo off
chcp 65001 > nul
rem Запуск Cyber-Fox на этом компьютере, в локальной сети клуба.
rem Кладётся рядом с docker-compose.yml или запускается двойным щелчком
rem из папки deploy\windows.

cd /d "%~dp0..\.."

if not exist ".env" (
    echo Нет файла .env — скопируйте deploy\env.example в .env и заполните пароли.
    pause
    exit /b 1
)

docker version > nul 2>&1
if errorlevel 1 (
    echo Docker не запущен. Откройте Docker Desktop, дождитесь «Engine running» и повторите.
    pause
    exit /b 1
)

echo Поднимаем Cyber-Fox…
docker compose -f docker-compose.yml -f deploy\lan.yml up -d
if errorlevel 1 (
    echo Не удалось запустить. Полный вывод: docker compose logs
    pause
    exit /b 1
)

echo.
echo Готово. Кассовый экран открывается по адресу:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo     http://%%b:8080
)
echo.
echo Этот же адрес вводится на игровых машинах при настройке агента.
pause
