/**
 * Согласие гостя на приглашения.
 *
 * Текст хранится вместе с согласием в том виде, в каком его увидел гость:
 * если формулировку потом поменяют, у каждого гостя останется та, на которую он
 * соглашался. Обещание редкости и способ отписки — часть текста, а не мелкий
 * шрифт: на понятное и редкое соглашаются охотнее, и закон требует того же.
 */
export function consentText(bonusTiyn: number): string {
  const gift =
    bonusTiyn > 0 ? ` За подписку на счёт начисляется ${formatTenge(bonusTiyn)} один раз.` : "";
  return (
    "Хочу получать приглашения на турниры и события клубов Cyber-Fox " +
    "в WhatsApp или SMS, не чаще 2 раз в месяц. Отписаться можно в любой " +
    `момент, ответив СТОП.${gift}`
  );
}

/** Тиын → «500 ₸» без копеек: подарок всегда круглый. */
export function formatTenge(tiyn: number): string {
  return `${Math.round(tiyn / 100).toLocaleString("ru-RU")} ₸`;
}

/** Кому можно слать приглашения: согласился и не отписался. */
export function canInvite(guest: { marketingConsentAt: Date | null; marketingOptOutAt: Date | null }): boolean {
  if (!guest.marketingConsentAt) return false;
  return !guest.marketingOptOutAt || guest.marketingOptOutAt < guest.marketingConsentAt;
}
