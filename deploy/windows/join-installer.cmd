@echo off
chcp 65001 > nul
rem Склейка установщика агента из частей.
rem Положите CyberFoxAgentSetup.part00, .part01, .part02 в одну папку с этим
rem файлом и запустите его двойным щелчком.

cd /d "%~dp0"

if not exist "CyberFoxAgentSetup.part00" (
    echo Не нашёл CyberFoxAgentSetup.part00 рядом с этим файлом.
    pause
    exit /b 1
)

copy /b CyberFoxAgentSetup.part00+CyberFoxAgentSetup.part01+CyberFoxAgentSetup.part02 "Cyber-Fox Agent Setup.exe" > nul
if errorlevel 1 (
    echo Склеить не удалось.
    pause
    exit /b 1
)

echo Готово: "Cyber-Fox Agent Setup.exe"
echo.
echo Проверьте контрольную сумму — она должна совпасть с указанной в переписке:
certutil -hashfile "Cyber-Fox Agent Setup.exe" SHA256 | findstr /v "hash CertUtil"
pause
