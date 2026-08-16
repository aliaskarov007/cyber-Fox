# Сторож агента: поднимает Cyber-Fox Agent, если процесс исчез.
#
# Зачем. Электронное окно киоска перехватывает обычные способы выйти — Alt+F4,
# Alt+Tab, клавишу Windows, — но не диспетчер задач: тот снимает процесс мимо
# приложения. Сторож не мешает этому произойти, он делает это бессмысленным:
# через минуту блокировка возвращается.
#
# Запускать один раз при установке, от имени администратора:
#   powershell -ExecutionPolicy Bypass -File install-watchdog.ps1
#
# Снять:
#   Unregister-ScheduledTask -TaskName "Cyber-Fox Watchdog" -Confirm:$false

$ErrorActionPreference = "Stop"

$TaskName = "Cyber-Fox Watchdog"
$AgentPath = Join-Path ${env:ProgramFiles} "Cyber-Fox Agent\Cyber-Fox Agent.exe"

if (-not (Test-Path $AgentPath)) {
    throw "Агент не найден: $AgentPath. Сначала установите Cyber-Fox Agent."
}

# Задача запускается в сеансе вошедшего пользователя, иначе окно блокировки
# было бы не видно: служба рисует на нулевом рабочем столе.
$Command = @"
if (-not (Get-Process -Name 'Cyber-Fox Agent' -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath '$AgentPath'
}
"@

$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$Command`""

# Каждую минуту, бессрочно: проверка стоит доли секунды, а минута без
# блокировки — это минута бесплатной игры, не больше.
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration ([TimeSpan]::MaxValue)).Repetition

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

# Группа «Пользователи»: задача должна работать под тем, кто сейчас за
# машиной, а не под конкретной учётной записью.
$Principal = New-ScheduledTaskPrincipal -GroupId "S-1-5-32-545" -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName `
    -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal `
    -Description "Возвращает блокировку Cyber-Fox, если агента сняли через диспетчер задач." `
    -Force | Out-Null

Write-Host "Сторож установлен. Проверить: Get-ScheduledTask -TaskName '$TaskName'"
