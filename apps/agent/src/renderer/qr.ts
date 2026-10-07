/**
 * QR-код для экрана регистрации.
 *
 * Своя реализация вместо библиотеки: нужен ровно один случай — короткая
 * ссылка wa.me в байтовом режиме, — а лишняя зависимость в агенте, который
 * стоит на сорока машинах зала, это ещё одна вещь, которую надо обновлять.
 *
 * Уровень коррекции M (15 %): экран не мнётся и не пачкается, но камера
 * дешёвого телефона ловит блики. Версии 1–10 вмещают до 213 байт — ссылке
 * с кодом хватает с большим запасом.
 *
 * Алгоритм — стандарт ISO/IEC 18004 по мотивам открытой реализации Nayuki.
 */

/** Модули символа: true — тёмный. matrix[y][x]. */
export type QrMatrix = boolean[][];

// Для уровня M, версии 1–10: ECC-кодовых слов на блок и число блоков.
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Биты уровня M в служебной информации. */
const ECL_BITS = 0;

export function encodeQr(text: string): QrMatrix {
  const data = new TextEncoder().encode(text);

  let version = 1;
  for (; version <= 10; version += 1) {
    const capacityBits = dataCodewords(version) * 8;
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + data.length * 8 <= capacityBits) break;
  }
  if (version > 10) throw new Error("Слишком длинный текст для QR");

  // Байтовый режим: 0100, длина, сами байты.
  const bits: number[] = [];
  push(bits, 0b0100, 4);
  push(bits, data.length, version <= 9 ? 8 : 16);
  for (const byte of data) push(bits, byte, 8);

  // Терминатор, выравнивание до байта и заполнители 0xEC/0x11.
  const capacity = dataCodewords(version) * 8;
  push(bits, 0, Math.min(4, capacity - bits.length));
  push(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(bits, pad, 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  const all = interleave(version, codewords);

  const size = version * 4 + 17;
  const modules: QrMatrix = grid(size, false);
  const reserved: QrMatrix = grid(size, false);
  drawFunctionPatterns(version, modules, reserved);
  drawCodewords(all, modules, reserved);

  // Маска с наименьшим штрафом: так символ легче читается.
  let best: QrMatrix | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row) => row.slice());
    applyMask(mask, candidate, reserved);
    drawFormatBits(mask, candidate);
    const score = penalty(candidate);
    if (score < bestPenalty) {
      bestPenalty = score;
      best = candidate;
    }
  }
  return best as QrMatrix;
}

function push(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
}

function grid(size: number, value: boolean): QrMatrix {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(value));
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version - 1] * BLOCKS[version - 1];
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Разбивка на блоки, коды Рида — Соломона и перемежение. */
function interleave(version: number, data: number[]): number[] {
  const blocks = BLOCKS[version - 1];
  const eccLength = ECC_PER_BLOCK[version - 1];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (rawCodewords % blocks);
  const shortLength = Math.floor(rawCodewords / blocks);
  const divisor = rsDivisor(eccLength);

  const result: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i += 1) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const chunk = data.slice(k, k + length);
    k += length;
    const ecc = rsRemainder(chunk, divisor);
    // В коротких блоках место под лишний байт данных пустое — пропускается ниже.
    if (i < shortBlocks) chunk.push(-1);
    result.push(chunk.concat(ecc));
  }

  const out: number[] = [];
  for (let i = 0; i < result[0].length; i += 1) {
    for (const block of result) {
      if (block[i] !== -1) out.push(block[i]);
    }
  }
  return out;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function drawFunctionPatterns(version: number, modules: QrMatrix, reserved: QrMatrix): void {
  const size = modules.length;
  const set = (x: number, y: number, dark: boolean): void => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  // Полосы синхронизации.
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Поисковые узоры по трём углам вместе с белой каймой.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }

  // Выравнивающие узоры, кроме тех, что легли бы на поисковые.
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((py, i) => {
    positions.forEach((px, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });

  // Место под служебную информацию — заполнится после выбора маски.
  drawFormatBits(0, modules, reserved);

  // Номер версии, начиная с седьмой.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
}

function drawFormatBits(mask: number, modules: QrMatrix, reserved?: QrMatrix): void {
  const size = modules.length;
  const data = (ECL_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const set = (x: number, y: number, dark: boolean): void => {
    modules[y][x] = dark;
    if (reserved) reserved[y][x] = true;
  };
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;

  // Первая копия — у левого верхнего узора.
  for (let i = 0; i <= 5; i += 1) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i));

  // Вторая — разнесена по двум другим узорам.
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i));
  // Всегда тёмный модуль.
  set(8, size - 8, true);
}

function drawCodewords(codewords: number[], modules: QrMatrix, reserved: QrMatrix): void {
  const size = modules.length;
  let i = 0;
  // Змейка парами столбцов справа налево, мимо столбца синхронизации.
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!reserved[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i += 1;
        }
      }
    }
  }
}

function applyMask(mask: number, modules: QrMatrix, reserved: QrMatrix): void {
  const size = modules.length;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (reserved[y][x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}

/** Штраф маски по правилам стандарта: длинные серии, квадраты, ложные узоры, перекос цвета. */
function penalty(modules: QrMatrix): number {
  const size = modules.length;
  let score = 0;

  const lines: boolean[][] = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(modules[i]);
    lines.push(modules.map((row) => row[i]));
  }
  const finderLike = [true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    for (let i = 0; i + 7 <= size; i += 1) {
      if (!finderLike.every((v, k) => line[i + k] === v)) continue;
      const before = i >= 4 && [1, 2, 3, 4].every((k) => !line[i - k]);
      const after = i + 11 <= size && [7, 8, 9, 10].every((k) => !line[i + k]);
      if (before || after) score += 40;
    }
  }

  let dark = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) dark += 1;
      if (
        x + 1 < size &&
        y + 1 < size &&
        modules[y][x] === modules[y][x + 1] &&
        modules[y][x] === modules[y + 1][x] &&
        modules[y][x] === modules[y + 1][x + 1]
      ) {
        score += 3;
      }
    }
  }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/** SVG-путь из тёмных модулей, с белой каймой в четыре модуля. */
export function qrPath(matrix: QrMatrix): { path: string; size: number } {
  const quiet = 4;
  let path = "";
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
    });
  });
  return { path, size: matrix.length + quiet * 2 };
}
