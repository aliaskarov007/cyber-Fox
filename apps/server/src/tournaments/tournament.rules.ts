/**
 * Правила турниров — чистые функции без базы и сети.
 *
 * Здесь считаются деньги (взносы, фонд, призы) и решается, собралась ли
 * команда. Это ровно те места, где ошибка видна гостю и стоит клубу денег,
 * поэтому они живут отдельно от сервиса и проверяются на конкретных числах.
 */

/** Без похожих друг на друга знаков: 0/O и 1/I гость перепутает, переписывая код из чата. */
export const TEAM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Код вида TM-4F3A. random — источник случайности, чтобы правило проверялось без него. */
export function makeTeamCode(random: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += TEAM_CODE_ALPHABET[random(TEAM_CODE_ALPHABET.length)];
  return `TM-${code}`;
}

/**
 * Код команды в сообщении гостя.
 *
 * Ищем внутри текста: капитан перешлёт код с подписью от себя, а напарник
 * допишет «я в деле». Префикс TM отличает его от кода регистрации CF, который
 * разбирается тем же конвейером входящих сообщений.
 */
export function findTeamCode(text: string): string | null {
  const match = /(?:^|[^A-Z0-9])TM[-\s]?([2-9A-HJ-NP-Z]{4})(?![A-Z0-9])/i.exec(text);
  return match ? `TM-${match[1].toUpperCase()}` : null;
}

/**
 * Название команды, если капитан дописал его рядом с кодом.
 *
 * Берём только до первого знака препинания и не длиннее трёх слов: иначе
 * «TM-4F3A Лисята, мы в деле» назовёт команду всей фразой, а «я в деле» от
 * напарника — и вовсе бессмыслицей. Имя короткое и осмысленное либо никакого.
 */
export function teamNameFrom(text: string, code: string): string | null {
  const withoutCode = text.replace(new RegExp(code.replace("-", "[-\\s]?"), "i"), " ");
  const firstPart = withoutCode.split(/[,.!?;:\n]/)[0] ?? "";
  const cleaned = firstPart.replace(/\s+/g, " ").trim();

  if (cleaned.length < 2 || cleaned.length > 32) return null;
  if (cleaned.split(" ").length > 3) return null;
  return cleaned;
}

/**
 * Гость ищет команду: записался один на командный турнир.
 *
 * Отдельно от «приду / не смогу», потому что это третий осмысленный ответ на
 * приглашение, а не разновидность согласия: место в составе ему ещё только
 * предстоит найти.
 */
export function wantsTeam(text: string): boolean {
  const cleaned = text.trim().toLowerCase().replace(/ё/g, "е").replace(/[.!,\s]+$/u, "");
  return ["3", "ищу команду", "ищу", "один", "без команды"].includes(cleaned);
}

/** Призовой фонд: взносы за вычетом доли клуба плюс то, что клуб добавил сам. */
export function prizePool(params: {
  /** Сколько человек оплатило взнос. */
  paidEntries: number;
  entryFee: number;
  clubFeePercent: number;
  clubBonus: number;
}): number {
  const collected = params.paidEntries * params.entryFee;
  // Доля клуба округляется в его пользу вниз: остаток копеек уходит гостям.
  const clubShare = Math.floor((collected * params.clubFeePercent) / 100);
  return collected - clubShare + params.clubBonus;
}

/**
 * Разбивка фонда по местам.
 *
 * Проценты задаёт владелец, и они не обязаны давать ровно сто: остаток от
 * деления добавляется первому месту, иначе при фонде 10 000 ₸ и долях 50/30/20
 * в сумме вышло бы 9 999,99 ₸, и отчёт не сошёлся бы на копейку.
 */
export function prizeBreakdown(pool: number, split: number[]): number[] {
  if (pool <= 0 || split.length === 0) return [];

  const shares = split.map((percent) => Math.floor((pool * percent) / 100));
  const distributed = shares.reduce((sum, share) => sum + share, 0);
  const remainder = pool - distributed;

  // Остаток первому месту — но только если он есть и доли вообще не пустые.
  if (remainder !== 0 && shares.length > 0) shares[0] += remainder;
  return shares;
}

export type TeamState = "GATHERING" | "READY";

/** Команда укомплектована, когда все места заняты и каждый внёс свою долю. */
export function teamState(params: { teamSize: number; paidMembers: number }): TeamState {
  return params.paidMembers >= params.teamSize ? "READY" : "GATHERING";
}

/** Докуда команда держит место: отсчёт идёт от оплаты капитана. */
export function gatherDeadline(captainPaidAt: Date, windowMinutes: number): Date {
  return new Date(captainPaidAt.getTime() + windowMinutes * 60_000);
}

export const JoinRefusal = {
  REGISTRATION_CLOSED: "Запись на турнир закрыта",
  TEAM_FULL: "В этой команде уже нет места",
  TEAM_DISBANDED: "Эта команда больше не собирается",
  ALREADY_IN_TOURNAMENT: "Вы уже записаны на этот турнир",
  NO_SLOTS: "Все места разобраны",
} as const;
export type JoinRefusal = (typeof JoinRefusal)[keyof typeof JoinRefusal];

/**
 * Можно ли гостю войти в команду по коду.
 *
 * Проверки собраны здесь, а не по месту вызова: отказ приходит гостю в
 * WhatsApp, и он должен объяснять причину, а не просто молчать.
 */
export function canJoinTeam(params: {
  tournamentStatus: "REGISTRATION" | "CLOSED" | "CANCELED";
  teamStatus: "GATHERING" | "READY" | "DISBANDED";
  teamSize: number;
  membersInTeam: number;
  alreadyEntered: boolean;
}): { ok: boolean; reason: JoinRefusal | null } {
  if (params.alreadyEntered) {
    return { ok: false, reason: JoinRefusal.ALREADY_IN_TOURNAMENT };
  }
  if (params.tournamentStatus !== "REGISTRATION") {
    return { ok: false, reason: JoinRefusal.REGISTRATION_CLOSED };
  }
  if (params.teamStatus === "DISBANDED") {
    return { ok: false, reason: JoinRefusal.TEAM_DISBANDED };
  }
  if (params.membersInTeam >= params.teamSize) {
    return { ok: false, reason: JoinRefusal.TEAM_FULL };
  }
  return { ok: true, reason: null };
}

/**
 * Сколько мест турнира ещё свободно.
 *
 * Занятыми считаются и собранные команды, и те, что ещё собираются: место
 * держится за командой, пока не вышел срок. Иначе популярный турнир
 * распродавался бы дважды.
 */
export function slotsLeft(params: { slots: number; activeTeams: number }): number {
  return Math.max(0, params.slots - params.activeTeams);
}

// --- Тексты для гостя ---

/**
 * Приглашение на турнир.
 *
 * Отличается от обычного ивента тремя строками, которые решают, запишется
 * человек или нет: сколько стоит, сколько мест осталось и сколько в фонде.
 * Растущий фонд в тексте — не украшение: он и подталкивает записываться.
 */
export function tournamentInviteMessage(params: {
  title: string;
  description: string | null;
  when: string;
  place: string;
  guestName: string;
  teamSize: number;
  entryFee: number;
  slotsLeft: number;
  prizePool: number;
}): string {
  const firstName = params.guestName.trim().split(/\s+/)[0] ?? "";
  const money = (tiyn: number) => `${Math.round(tiyn / 100).toLocaleString("ru-KZ")} ₸`;
  const format = params.teamSize === 1 ? "" : ` ${params.teamSize}×${params.teamSize}`;

  return [
    firstName ? `${firstName}, зовём на турнир!` : "Зовём на турнир!",
    "",
    `🏆 ${params.title}${format}`,
    `📍 ${params.place}`,
    `🕒 ${params.when}`,
    `💰 Взнос ${money(params.entryFee)} с человека`,
    `🎁 Призовой фонд ${money(params.prizePool)}`,
    `🎟 Свободных мест: ${params.slotsLeft}`,
    ...(params.description ? ["", params.description.trim()] : []),
    "",
    params.teamSize === 1
      ? "1 — участвую, 2 — пропущу"
      : "1 — участвую (вы капитан), 2 — пропущу, 3 — ищу команду",
    "Чтобы не получать приглашения, ответьте СТОП.",
  ].join("\n");
}

/** Чего не хватает на счёте — со ссылкой гость разберётся сам. */
export function topUpPrompt(shortBy: number): string {
  const money = `${Math.round(shortBy / 100).toLocaleString("ru-KZ")} ₸`;
  return `Не хватает ${money}. Пополните счёт и ответьте ещё раз — место пока свободно.`;
}

/**
 * Сколько ждём имя от незнакомого номера.
 *
 * Получас — чтобы человек успел отвлечься и вернуться, но не настолько долго,
 * чтобы завтрашнее «Айдос» в той же переписке записало его в команду, про
 * которую он давно забыл.
 */
export const TOURNAMENT_SIGNUP_TTL_MS = 30 * 60 * 1000;

/**
 * Первое, что видит человек с улицы: куда он попал и сколько это стоит.
 *
 * Взнос называем сразу. Узнать цену после того, как оставил имя, — повод
 * почувствовать себя обманутым, а клубу это стоит не одного участника, а
 * репутации в чате, где про турнир и рассказали.
 */
export function askNameMessage(params: {
  title: string;
  teamName: string | null;
  entryFee: number;
}): string {
  const money = `${Math.round(params.entryFee / 100).toLocaleString("ru-KZ")} ₸`;
  const team = params.teamName ? `в команду «${params.teamName}»` : "в команду";
  // Клубы называют ивенты «Турнир CS2», и «на турнир «Турнир CS2»» заикается.
  const event = /^турнир/i.test(params.title.trim())
    ? `на «${params.title}»`
    : `на турнир «${params.title}»`;

  return [
    `Записываем вас ${team} ${event}.`,
    `Взнос ${money}.`,
    "",
    "Как вас записать? Пришлите имя — например, Айдос.",
  ].join("\n");
}

/** Ответ не похож на имя: просим ещё раз, не теряя места в команде. */
export function askNameAgainMessage(): string {
  return "Не разобрали имя. Пришлите, пожалуйста, как вас записать — одним-двумя словами.";
}

/**
 * Аккаунт заведён, но на взнос не хватило.
 *
 * Код называем прямо в сообщении: человек пришёл по ссылке от приятеля и не
 * обязан помнить, что это были за четыре знака в начале переписки.
 */
export function newGuestTopUpMessage(name: string, shortBy: number, teamCode: string): string {
  const money = `${Math.round(shortBy / 100).toLocaleString("ru-KZ")} ₸`;
  return [
    `${name}, аккаунт в клубе создан — номер подтверждён.`,
    "",
    `На взнос не хватает ${money}. Пополните счёт в клубе и пришлите ${teamCode} ещё раз —`,
    "место держится до конца сбора команды.",
  ].join("\n");
}

/** Что ответить капитану: код нужен не ему, а его напарникам. */
export function captainMessage(params: {
  code: string;
  teamSize: number;
  filled: number;
}): string {
  return [
    `Вы капитан. Взнос списан.`,
    "",
    `Код команды: ${params.code}`,
    "Отправьте его напарникам — пусть пришлют сюда же.",
    "",
    `Собрано: ${params.filled} из ${params.teamSize}`,
    "",
    `Назвать команду: пришлите «${params.code} Название».`,
  ].join("\n");
}
