import { formatMoney } from "./agent-client.js";

/**
 * Предупреждение о конце пакета. Переход на поминутку автоматический, поэтому
 * гость должен заранее знать, во что обойдётся игра дальше и хватит ли денег —
 * а не узнать об этом, когда экран заблокируется.
 */
export function packageEndingText(left: number, price: number | null, affordable: number | null): string {
  const head = `Минут пакета осталось: ${left}. Дальше игра продолжится поминутно`;
  if (price === null) return `${head} — игра не прервётся.`;
  const rate = `${head} по ${formatMoney(price)}/мин`;
  if (affordable === null) return `${rate}.`;
  if (affordable <= 0) {
    return `${rate}, но на счёте не хватает даже на минуту — пополните счёт у администратора, иначе после пакета экран заблокируется.`;
  }
  return `${rate}: баланса хватит примерно на ${affordable} мин.`;
}

/** Сообщение в момент перехода с пакета на поминутку. */
export function switchedText(price: number | null, minutesLeft: number | null): string {
  if (price === null) return "Пакет закончился, включён поминутный тариф. Игра продолжается.";
  const tail = minutesLeft !== null ? ` Баланса хватит примерно на ${minutesLeft} мин.` : "";
  return `Пакет закончился — дальше поминутно по ${formatMoney(price)}/мин. Игра продолжается.${tail}`;
}
