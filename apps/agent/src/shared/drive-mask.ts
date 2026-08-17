/**
 * Маска дисков для политики NoDrives.
 *
 * Windows прячет диски битовой маской: младший бит — A:, дальше по алфавиту.
 * Значение уезжает в реестр числом, и ошибка в один бит прячет не тот диск,
 * поэтому счёт живёт отдельно от кода, который пишет в реестр.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Маска из перечисленных букв. Неизвестные буквы игнорируются. */
export function driveMask(letters: string[]): number {
  let mask = 0;
  for (const raw of letters) {
    // Пустую строку indexOf находит в начале алфавита: без этой проверки
    // лишняя запятая в настройке трогала бы диск A:.
    const letter = raw.trim().toUpperCase().replace(":", "").slice(0, 1);
    if (letter === "") continue;

    const index = LETTERS.indexOf(letter);
    if (index >= 0) mask |= 1 << index;
  }
  return mask;
}

/** Все диски, кроме перечисленных: обычный случай — спрятать всё, кроме нужного. */
export function allDrivesExcept(letters: string[]): number {
  const all = (1 << 26) - 1;
  return all & ~driveMask(letters);
}
