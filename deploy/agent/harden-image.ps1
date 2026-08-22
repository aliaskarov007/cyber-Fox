# Подготовка образа зала: закрыть Windows от гостя навсегда, а не на сессию.
#
# Агент закрывает лишнее на время оплаченной игры и открывает обратно после.
# Между сессиями, при падении агента и до его запуска машина остаётся открытой —
# а гость сидит за ней всё это время. Поэтому то, что не должно работать никогда,
# ставится один раз в образ этим скриптом.
#
# Запускать от имени администратора на машине, загруженной с образа в режиме
# записи, после установки агента:
#   powershell -ExecutionPolicy Bypass -File harden-image.ps1
#
# Обратно: harden-image.ps1 -Undo

param([switch]$Undo)

$ErrorActionPreference = "Stop"

# Политики пишутся и в старую ветку, и в современную: какая сработает на
# конкретной сборке Windows, заранее не скажешь.
$SystemKeys = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
  "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System"
)
$ExplorerKeys = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer",
  "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer"
)

# Ставится на всю машину (HKLM), а не текущему пользователю: в бездисковом зале
# профиль стирается при перезагрузке вместе с кэшем записи.
$Policies = @(
  @{ Keys = $SystemKeys;   Name = "DisableTaskMgr";           Value = 1; Why = "диспетчер задач — им снимают агента" },
  @{ Keys = $SystemKeys;   Name = "DisableRegistryTools";     Value = 1; Why = "regedit — им снимают эти политики" },
  @{ Keys = $SystemKeys;   Name = "DisableLockWorkstation";   Value = 1; Why = "блокировка экрана: время идёт, играть нельзя" },
  @{ Keys = $SystemKeys;   Name = "HideFastUserSwitching";    Value = 1; Why = "смена пользователя уводит мимо агента" },
  @{ Keys = $ExplorerKeys; Name = "NoLogoff";                 Value = 1; Why = "выход из системы — другой сеанс без агента" },
  @{ Keys = $ExplorerKeys; Name = "NoRun";                    Value = 1; Why = "«Выполнить»" },
  @{ Keys = $ExplorerKeys; Name = "NoControlPanel";           Value = 1; Why = "панель управления" },
  @{ Keys = $ExplorerKeys; Name = "NoFolderOptions";          Value = 1; Why = "настройки папок" },
  @{ Keys = $ExplorerKeys; Name = "NoDesktop";                Value = 1; Why = "ярлыки на столе: гость должен видеть полки" }
)

foreach ($policy in $Policies) {
  foreach ($key in $policy.Keys) {
    if ($Undo) {
      if (Test-Path $key) {
        Remove-ItemProperty -Path $key -Name $policy.Name -ErrorAction SilentlyContinue
      }
    } else {
      if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
      New-ItemProperty -Path $key -Name $policy.Name -Value $policy.Value -PropertyType DWord -Force | Out-Null
    }
  }
  $action = if ($Undo) { "снято" } else { "закрыто" }
  Write-Host "$action`: $($policy.Name) — $($policy.Why)"
}

if ($Undo) {
  Write-Host ""
  Write-Host "Политики сняты. Машина снова открыта — в зал в таком виде не выдавать."
  exit 0
}

Write-Host ""
Write-Host "Готово. Дальше в образе стоит проверить:"
Write-Host "  1. Агент запускается сам после перезагрузки"
Write-Host "  2. Ctrl+Alt+Del не открывает диспетчер задач"
Write-Host "  3. Ctrl+Shift+Esc тоже не открывает"
Write-Host "  4. В меню питания нет «Выход» и «Сменить пользователя»"
Write-Host ""
Write-Host "И то, что этим скриптом не закрывается: пароль на BIOS и запрет"
Write-Host "загрузки с внешних носителей. Без них всё вышеперечисленное"
Write-Host "обходится загрузочной флешкой за две минуты."
