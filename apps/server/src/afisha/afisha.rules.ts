/**
 * Сколько ивент висит в афише после начала. Турнир идёт несколько часов, и
 * гость, пришедший к середине, должен видеть, что происходит в зале.
 */
export const SHOW_AFTER_START_HOURS = 4;

/** Больше пяти афиш по кругу никто не досмотрит: десять секунд на каждую. */
export const MAX_ON_SCREEN = 5;

/** С какого момента ивент ещё показывается. */
export function visibleSince(now: Date): Date {
  return new Date(now.getTime() - SHOW_AFTER_START_HOURS * 3_600_000);
}
