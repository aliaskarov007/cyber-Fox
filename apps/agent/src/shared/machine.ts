/**
 * Как машина называет себя серверу.
 *
 * В бездисковом зале все ПК грузятся с одного образа: имя, профиль и настройки
 * у них общие, а после перезагрузки записанное на диск исчезает. Устойчив
 * только MAC сетевой карты — на нём держится сама загрузка по сети, поэтому
 * он заведомо уникален и не меняется.
 */

export interface NetworkAdapter {
  /** Имя адаптера в системе: «Ethernet», «vEthernet (Default Switch)». */
  name: string;
  mac: string;
  internal: boolean;
  family: string;
}

/**
 * Адаптеры виртуальных машин и туннелей. Они есть на игровых ПК с Hyper-V,
 * VMware или VirtualBox и мешают тем, что их MAC у всех машин образа
 * одинаковый — приняв такой, мы свели бы весь зал в одну машину.
 */
const VIRTUAL_PREFIXES = [
  "00:15:5d", // Hyper-V
  "00:50:56", // VMware
  "00:0c:29", // VMware
  "00:05:69", // VMware
  "08:00:27", // VirtualBox
  "0a:00:27", // VirtualBox Host-Only
];

const BLANK = "00:00:00:00:00:00";

/**
 * Выбор адаптера, которым машина представляется.
 *
 * Порядок детерминированный: список адаптеров система отдаёт как придётся, а
 * машина обязана называть себя одинаково при каждой загрузке — иначе после
 * перезагрузки она заведётся в зале второй раз.
 */
export function pickMac(adapters: NetworkAdapter[]): string | null {
  const usable = adapters
    .filter((a) => !a.internal)
    .filter((a) => a.family === "IPv4")
    .map((a) => ({ ...a, mac: a.mac.trim().toLowerCase() }))
    .filter((a) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(a.mac))
    .filter((a) => a.mac !== BLANK)
    .filter((a) => !VIRTUAL_PREFIXES.some((prefix) => a.mac.startsWith(prefix)));

  if (usable.length === 0) return null;

  usable.sort((a, b) => a.mac.localeCompare(b.mac) || a.name.localeCompare(b.name));
  return usable[0].mac;
}
