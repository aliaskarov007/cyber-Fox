/**
 * Протокол провайдера Kaspi.kz (онлайн): Kaspi присылает GET-запросы
 * command=check (есть ли такой гость) и command=pay (зачислить), ответ — JSON.
 *
 * Здесь только разбор и сборка ответа, без базы: всё, где легко ошибиться
 * в формате, проверяется тестами.
 */

/** Коды result из протокола Kaspi. */
export const KaspiResult = {
  OK: 0,
  NOT_FOUND: 1,
  CANCELED: 2,
  ALREADY_PAID: 3,
  IN_PROGRESS: 4,
  OTHER: 5,
} as const;
export type KaspiResultCode = (typeof KaspiResult)[keyof typeof KaspiResult];

/**
 * Адреса Kaspi из протокола. Третий в документе записан как 197.187.244.108 —
 * похоже на опечатку соседнего 194.187.244.108, поэтому разрешены оба.
 * Переопределяется переменной KASPI_ALLOWED_IPS.
 */
export const KASPI_DEFAULT_IPS = [
  "194.187.247.152",
  "194.187.245.108",
  "197.187.244.108",
  "194.187.244.108",
];

/** Регулярное выражение для поля account, которое сообщаем Kaspi: номер телефона гостя. */
export const KASPI_ACCOUNT_REGEX = "^(\\+?7|8)?7\\d{9}$";

export function parseAllowedIps(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length > 0 ? list : KASPI_DEFAULT_IPS;
}

/** Адрес из Express может прийти как ::ffff:194.187.247.152. */
export function isAllowedIp(ip: string | undefined, allowed: string[]): boolean {
  if (!ip) return false;
  const clean = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return allowed.includes(clean);
}

/** Номер телефона гостя в том виде, как он хранится: 7XXXXXXXXXX. Не казахстанский мобильный — null. */
export function accountToPhone(account: string | undefined): string | null {
  const digits = (account ?? "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("7")) return `7${digits}`;
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8")) && digits[1] === "7") {
    return `7${digits.slice(1)}`;
  }
  return null;
}

/** «500.00» → 50000 тиын. Ноль, минус и мусор — null. */
export function parseSum(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,9}(\.\d{1,2})?$/.test(raw.trim())) return null;
  const [whole, frac = ""] = raw.trim().split(".");
  const tiyn = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return tiyn > 0 ? tiyn : null;
}

/** 50000 тиын → «500.00». */
export function formatSum(tiyn: number): string {
  return `${Math.floor(tiyn / 100)}.${String(tiyn % 100).padStart(2, "0")}`;
}

/** txn_id — целое до 18 знаков. Храним строкой: в Number 18 знаков не помещаются. */
export function parseTxnId(raw: string | undefined): string | null {
  return raw && /^\d{1,18}$/.test(raw) ? raw : null;
}

/** txn_date ГГГГММДДЧЧММСС по времени Казахстана (UTC+5). Неверная — null. */
export function parseTxnDate(raw: string | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(raw ?? "");
  if (!m) return null;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** БИН или ИИН — ровно 12 цифр. Пробелы при вводе убираем; пустое — «не задан». */
export function parseBin(raw: string): string | null | undefined {
  const digits = raw.replace(/\s/g, "");
  if (digits === "") return null;
  return /^\d{12}$/.test(digits) ? digits : undefined;
}

/** «Нурбол Әлиасқаров» → «Нурбол Ә.»: плательщик узнаёт себя, а чужой номер не раскрывает фамилию. */
export function maskGuestName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Гость";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[1]![0]}.`;
}

export interface KaspiReply {
  txn_id: string;
  /** БИН/ИИН получателя — Kaspi просит его в каждом ответе. */
  bin?: string;
  prv_txn_id?: string;
  result: KaspiResultCode;
  sum?: string;
  comment: string;
  fields?: Record<string, { "@name": string; "#text": string }>;
}

/** Добавить БИН получателя в ответ (сразу после txn_id). */
export function withBin(reply: KaspiReply, bin: string | null | undefined): KaspiReply {
  if (!bin) return reply;
  const { txn_id, ...rest } = reply;
  return { txn_id, bin, ...rest };
}

/** Ответ в JSON-формате протокола. */
export function buildReply(params: {
  txnId: string;
  result: KaspiResultCode;
  comment?: string;
  prvTxnId?: bigint | string;
  sum?: number;
  fields?: Array<[name: string, value: string]>;
}): KaspiReply {
  const reply: KaspiReply = {
    txn_id: params.txnId,
    result: params.result,
    comment: params.comment ?? "",
  };
  if (params.prvTxnId !== undefined) reply.prv_txn_id = String(params.prvTxnId);
  if (params.sum !== undefined) reply.sum = formatSum(params.sum);
  if (params.fields && params.fields.length > 0) {
    reply.fields = Object.fromEntries(
      params.fields.map(([name, value], i) => [`field${i + 1}`, { "@name": name, "#text": value }]),
    );
  }
  return reply;
}
