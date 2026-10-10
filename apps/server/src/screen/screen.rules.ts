/**
 * Карусель экрана блокировки — правила без базы.
 *
 * На экране чередуются ближайшие турниры из «Ивентов» и рекламные слайды.
 * Турниры идут первыми и по дате: гость за ПК — лучший участник следующего
 * турнира. Реклама вставляется между ними, чтобы экран не превратился в
 * рекламный щит, где турнир теряется.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** На сколько дней вперёд показывать турниры. */
export const EVENTS_AHEAD_DAYS = 30;
/** Больше пяти турниров на экране никто не дочитает. */
export const MAX_EVENTS = 5;
/** Один показ слайда на машине — не чаще раза в минуту, иначе счётчик раздувается. */
export const IMPRESSION_THROTTLE_MS = 60_000;

export type ScreenSlideView =
  | {
      kind: "event";
      id: string;
      title: string;
      text: string | null;
      startsAt: string;
      /** Зал ивента, если он не тот, где стоит машина. */
      clubName: string | null;
    }
  | {
      kind: "ad";
      id: string;
      title: string;
      text: string | null;
      imageUrl: string | null;
      partner: string | null;
    };

export interface EventLike {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  canceledAt: Date | null;
  clubId: string;
  clubName: string;
}

export interface AdLike {
  id: string;
  title: string;
  text: string | null;
  imageUrl: string | null;
  partner: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
}

/** Идёт ли слайд сейчас. */
export function isAdLive(ad: Pick<AdLike, "isActive" | "startsAt" | "endsAt">, now: Date): boolean {
  if (!ad.isActive) return false;
  if (ad.startsAt && ad.startsAt.getTime() > now.getTime()) return false;
  if (ad.endsAt && ad.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Турнир попадает на экран: не отменён, ещё не начался и не дальше месяца. */
export function isEventUpcoming(event: Pick<EventLike, "startsAt" | "canceledAt">, now: Date): boolean {
  if (event.canceledAt) return false;
  const t = event.startsAt.getTime();
  return t > now.getTime() && t <= now.getTime() + EVENTS_AHEAD_DAYS * DAY_MS;
}

/** Порядок карусели: турнир, реклама, турнир, реклама… остаток — в конец. */
export function buildCarousel(
  events: EventLike[],
  ads: AdLike[],
  clubId: string,
  now: Date,
): ScreenSlideView[] {
  const eventSlides: ScreenSlideView[] = events
    .filter((e) => isEventUpcoming(e, now))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, MAX_EVENTS)
    .map((e) => ({
      kind: "event",
      id: e.id,
      title: e.title,
      text: e.description,
      startsAt: e.startsAt.toISOString(),
      clubName: e.clubId === clubId ? null : e.clubName,
    }));

  const adSlides: ScreenSlideView[] = ads
    .filter((a) => isAdLive(a, now))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => ({
      kind: "ad",
      id: a.id,
      title: a.title,
      text: a.text,
      imageUrl: a.imageUrl,
      partner: a.partner,
    }));

  const result: ScreenSlideView[] = [];
  const longest = Math.max(eventSlides.length, adSlides.length);
  for (let i = 0; i < longest; i += 1) {
    if (eventSlides[i]) result.push(eventSlides[i]!);
    if (adSlides[i]) result.push(adSlides[i]!);
  }
  return result;
}

/** Что мешает сохранить слайд; null — можно. */
export function slideBlocker(input: {
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
}): string | null {
  if (input.title.trim().length < 2) return "Добавьте заголовок";
  if (input.startsAt && input.endsAt && input.endsAt.getTime() <= input.startsAt.getTime()) {
    return "Окончание показа раньше начала";
  }
  return null;
}

/**
 * Счётчик показов с защитой от накрутки: одна машина засчитывает слайд не
 * чаще раза в минуту. Карусель крутится по кругу, и без этого пустой зал ночью
 * «показал» бы рекламу тысячи раз.
 */
export class ImpressionThrottle {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs = IMPRESSION_THROTTLE_MS) {}

  /** true — показ засчитывается. */
  allow(computerId: string, slideId: string, now = Date.now()): boolean {
    const key = `${computerId}:${slideId}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.seen.set(key, now);
    if (this.seen.size > 50_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) {
      if (now - at >= this.windowMs) this.seen.delete(key);
    }
  }
}
