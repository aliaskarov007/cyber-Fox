# Сторож агента и запуск блокировки Cyber-Fox.
#
# Ставит две задачи Windows:
#
#   1. «Cyber-Fox Agent» — запускает окно блокировки в сеансе вошедшего
#      игрока (при входе и по требованию сторожа). Работает под игроком,
#      иначе окно рисовалось бы на невидимом нулевом рабочем столе.
#
#   2. «Cyber-Fox Watchdog» — сторож под SYSTEM. Раз в 3 секунды проверяет,
#      жив ли агент, и если нет — поднимает задачу 1. Главное здесь — SYSTEM:
#      процесс сторожа принадлежит системе, и ограниченный игрок снять его не
#      может, диспетчер задач отвечает «Отказано в доступе». Снять агента
#      больше не помогает — через пару секунд блокировка возвращается.
#
# ВАЖНО: защита работает, только если игрок входит под ОГРАНИЧЕННОЙ учётной
# записью. Под администратором гость снимает и процессы SYSTEM — тогда ни
# сторож, ни запреты не держат.
#
# Ставится сам установщиком агента. Руками — один раз, от администратора:
#   powershell -ExecutionPolicy Bypass -File install-watchdog.ps1
#
# Снять:
#   Unregister-ScheduledTask -TaskName "Cyber-Fox Watchdog" -Confirm:$false
#   Unregister-ScheduledTask -TaskName "Cyber-Fox Agent" -Confirm:$false

param(
    # Установщик передаёт путь, куда поставил агента; руками — по умолчанию.
    [string]$AgentPath = (Join-Path ${env:ProgramFiles} "Cyber-Fox Agent\Cyber-Fox Agent.exe")
)

$ErrorActionPreference = "Stop"

$AgentTask = "Cyber-Fox Agent"
$WatchTask = "Cyber-Fox Watchdog"

if (-not (Test-Path $AgentPath)) {
    throw "Агент не найден: $AgentPath. Сначала установите Cyber-Fox Agent."
}

# --- Задача 1: запуск агента в сеансе игрока ---
#
# Группа «Пользователи» (S-1-5-32-545), а не конкретная учётка: задача должна
# работать под тем, кто сейчас за машиной. Запускается при входе; её же по
# требованию запускает сторож — тогда агент открывается в сеансе игрока, а не
# на нулевом рабочем столе, как было бы при запуске из SYSTEM.
$AgentAction = New-ScheduledTaskAction -Execute $AgentPath
$AgentTrigger = New-ScheduledTaskTrigger -AtLogOn
$AgentPrincipal = New-ScheduledTaskPrincipal -GroupId "S-1-5-32-545" -RunLevel Limited
$AgentSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $AgentTask `
    -Action $AgentAction -Trigger $AgentTrigger -Settings $AgentSettings -Principal $AgentPrincipal `
    -Description "Запускает блокировку Cyber-Fox в сеансе игрока." `
    -Force | Out-Null

# --- Задача 2: сторож под SYSTEM ---
#
# Проверка раз в 3 секунды: снятый агент возвращается раньше, чем гость успеет
# открыть игру. Агента сторож не запускает напрямую — из SYSTEM окно ушло бы на
# нулевой рабочий стол; он поднимает задачу 1, а та открывает агента у игрока.
#
# Сторож сам выходит, когда его задачу отключают: установщик обновления гасит
# задачу, и цикл не должен поднимать агента в середине копирования файлов.
#
# Одной строкой: перенос строки в аргументе задачи Windows не переживает.
$Command = "while (`$true) { try { if ((Get-ScheduledTask -TaskName '$WatchTask' -ErrorAction SilentlyContinue).State -eq 'Disabled') { break } } catch {}; if (-not (Get-Process -Name 'Cyber-Fox Agent' -ErrorAction SilentlyContinue)) { Start-ScheduledTask -TaskName '$AgentTask' -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 3 }"

$WatchAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command `"$Command`""

# Старт и при загрузке системы, и при входе пользователя: без входного триггера
# свежеустановленный сторож молчал бы до первой перезагрузки. Повтор раз в
# минуту: если сам сторож сняли, задача поднимет его снова; второй экземпляр
# поверх живого не идёт.
$WatchTrigger = New-ScheduledTaskTrigger -AtStartup
# Срок повтора — 9999 дней, а не [TimeSpan]::MaxValue: «бесконечность» Windows
# отвергает («value incorrectly formatted or out of range»), и задача не
# ставилась бы вовсе.
$WatchTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 9999)).Repetition
$WatchLogon = New-ScheduledTaskTrigger -AtLogOn

$WatchSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

# SYSTEM с наивысшими правами: именно это делает сторожа неснимаемым для игрока.
$WatchPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" `
    -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $WatchTask `
    -Action $WatchAction -Trigger @($WatchTrigger, $WatchLogon) -Settings $WatchSettings -Principal $WatchPrincipal `
    -Description "Возвращает блокировку Cyber-Fox, если агента сняли. Работает под SYSTEM — игрок снять не может." `
    -Force | Out-Null

# Запускаем сторож сразу: установщик уже с правами администратора, и машину не
# придётся перезагружать, чтобы защита включилась.
Start-ScheduledTask -TaskName $WatchTask

Write-Host "Готово: задача запуска агента и сторож (SYSTEM) установлены и запущены."
Write-Host "Проверить: Get-ScheduledTask -TaskName '$AgentTask','$WatchTask'"
