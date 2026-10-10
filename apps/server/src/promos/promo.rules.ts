/**
 * Правила промокодов без базы: нормализация кода, генерация, проверка
 * пригодности и ограничение перебора с игровых ПК.
 */

/*
 * Буквы, которые на русской раскладке выглядят как латинские. Гость за клубной
 * клавиатурой набирает «ФОКС500» с переключённым языком реже, чем «FОХ500»,
 * где О и Х — кириллические: на вид код верный, а система его не узнаёт.
 */
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  У: "Y",
};

/** Код в том виде, в каком он хранится: заглавные латинские буквы и цифры. */
export function normalizePromoCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s\-_]+/g, "")
    .replace(/[АВЕКМНОРСТХУ]/g, (letter) => CYRILLIC_LOOKALIKES[letter] ?? letter);
}

export const PROMO_CODE_PATTERN = /^[A-Z0-9]{4,20}$/;

/*
 * Алфавит без похожих знаков: 0 и O, 1 и I, 5 и S гость с листовки перепутает,
 * и администратор потом объясняет, почему «код не работает».
 */
const GENERATED_ALPHABET = "ABCDEFGHJKLMNPQRTUVWXY2346789";

/** Случайный код для раздачи. `random` возвращает число от 0 до 1, как Math.random. */
export function generatePromoCode(length = 8, random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += GENERATED_ALPHABET[Math.floor(random() * GENERATED_ALPHABET.length)];
  }
  return code;
}

export interface PromoState {
  clubId: string | null;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
  disabledAt: Date | null;
}

/** Почему код сейчас нельзя применить в этом клубе; null — можно. */
export function promoBlocker(promo: PromoState, clubId: string, now: Date): string | null {
  if (promo.disabledAt) return "Промокод больше не действует";
  if (promo.expiresAt && promo.expiresAt.getTime() <= now.getTime()) {
    return "Срок действия промокода истёк";
  }
  if (promo.clubId !== null && promo.clubId !== clubId) {
    return "Промокод действует в другом клубе сети";
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
    return "Промокод уже разобрали";
  }
  return null;
}

/**
 * Счётчик неудачных попыток по ключу (машина, гость) в скользящем окне.
 *
 * Без него код из восьми знаков всё равно подбирается скриптом с игрового ПК:
 * экран агента — обычное веб-окно, и запросы к серверу из него не ограничены.
 */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  blocked(key: string, now: number): boolean {
    return this.recent(key, now).length >= this.maxFailures;
  }

  fail(key: string, now: number): void {
    const list = this.recent(key, now);
    list.push(now);
    this.failures.set(key, list);
  }

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }
}
