/**
 * Генератор QR-кода без сторонних библиотек.
 *
 * Агенту нужен ровно один QR — ссылка wa.me с кодом регистрации, — и тянуть
 * ради него зависимость в образ каждой машины зала незачем. Здесь только то,
 * что для этого нужно: байтовый режим, уровень коррекции M (до 15% повреждений:
 * блики на мониторе, камера под углом), версии 1–10, то есть до 213 байт.
 *
 * Алгоритм — по стандарту ISO/IEC 18004; порядок шагов тот же, что в
 * эталонной реализации Nayuki, чтобы его было легко сверить.
 */

/** Таблицы уровня M для версий 1–10: [кодовых слов коррекции на блок, блоков]. */
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

/** Формат-биты уровня M — 00. */
const EC_FORMAT_BITS = 0;

/** Сколько модулей с данными в версии — без служебных узоров. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

function dataCodewords(version: number): number {
  return totalCodewords(version) - EC_PER_BLOCK[version - 1] * BLOCKS[version - 1];
}

/** Центры выравнивающих узоров. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

// --- Арифметика поля Галуа GF(256) с порождающим многочленом 0x11D ---

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

// --- Данные ---

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function pickVersion(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    // Заголовок: 4 бита режима и 8 бит длины (для версий до 9; у 10-й — 16).
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + byteLength * 8 <= dataCodewords(version) * 8) return version;
  }
  throw new Error("Слишком длинный текст для QR-кода");
}

function encodeData(bytes: number[], version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // байтовый режим
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length)); // терминатор
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);

  const result: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    result.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  return result;
}

/** Делит данные на блоки, добавляет коррекцию и перемежает, как требует стандарт. */
function withErrorCorrection(data: number[], version: number): number[] {
  const blockCount = BLOCKS[version - 1];
  const ecLength = EC_PER_BLOCK[version - 1];
  const total = totalCodewords(version);
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount);
  const divisor = rsDivisor(ecLength);

  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const length = shortLength - ecLength + (i < shortBlocks ? 0 : 1);
    const chunk = data.slice(k, k + length);
    k += length;
    const ecc = rsRemainder(chunk, divisor);
    // Короткие блоки добиваются пустым местом, чтобы колонки совпали.
    if (i < shortBlocks) chunk.push(-1);
    blocks.push([...chunk, ...ecc]);
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLength - ecLength || j >= shortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// --- Матрица ---

class Matrix {
  readonly size: number;
  readonly dark: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  set(x: number, y: number, isDark: boolean): void {
    this.dark[y][x] = isDark;
    this.reserved[y][x] = true;
  }

  drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }

    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const positions = alignmentPositions(this.version);
    const last = positions.length - 1;
    positions.forEach((x, i) =>
      positions.forEach((y, j) => {
        // Узоры, налезающие на поисковые квадраты, не рисуются.
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        this.drawAlignment(x, y);
      }),
    );

    this.drawFormat(0); // место резервируется, настоящие биты — после выбора маски
    this.drawVersion();
  }

  private drawFinder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.set(xx, yy, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormat(mask: number): void {
    const data = (EC_FORMAT_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;

    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true); // всегда тёмный модуль
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const isDark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, isDark);
      this.set(b, a, isDark);
    }
  }

  /** Раскладывает кодовые слова змейкой снизу вверх по парам колонок. */
  drawCodewords(codewords: number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // колонка синхронизации
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.reserved[y][x] && i < codewords.length * 8) {
            this.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
          // Остаточные биты остаются светлыми — так и положено.
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.reserved[y][x]) continue;
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
        if (invert) this.dark[y][x] = !this.dark[y][x];
      }
    }
  }

  /** Штраф по четырём правилам стандарта: чем меньше, тем легче читается код. */
  penalty(): number {
    let result = 0;
    const size = this.size;
    const lines: boolean[][] = [];
    for (let i = 0; i < size; i++) {
      lines.push(this.dark[i]);
      lines.push(this.dark.map((row) => row[i]));
    }

    for (const line of lines) {
      // Правило 1: пять и больше одинаковых модулей подряд.
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) {
          run++;
        } else {
          if (run >= 5) result += 3 + (run - 5);
          run = 1;
        }
      }
      // Правило 3: узор, похожий на поисковый квадрат.
      const text = line.map((d) => (d ? "1" : "0")).join("");
      const padded = `0000${text}0000`;
      for (const pattern of ["10111010000", "00001011101"]) {
        for (let at = padded.indexOf(pattern); at !== -1; at = padded.indexOf(pattern, at + 1)) {
          result += 40;
        }
      }
    }

    // Правило 2: квадраты 2×2 одного цвета.
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = this.dark[y][x];
        if (c === this.dark[y][x + 1] && c === this.dark[y + 1][x] && c === this.dark[y + 1][x + 1]) {
          result += 3;
        }
      }
    }

    // Правило 4: доля тёмных модулей далека от половины.
    const darkCount = this.dark.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const total = size * size;
    const k = Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1;
    result += Math.max(0, k) * 10;

    return result;
  }
}

/**
 * Матрица QR-кода: true — тёмный модуль. Поля вокруг (четыре модуля)
 * не включены — их добавляет тот, кто рисует.
 */
export function encodeQr(text: string): boolean[][] {
  const bytes = utf8(text);
  const version = pickVersion(bytes.length);
  const codewords = withErrorCorrection(encodeData(bytes, version), version);

  let best: Matrix | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = new Matrix(version);
    matrix.drawFunctionPatterns();
    matrix.drawCodewords(codewords);
    matrix.applyMask(mask);
    matrix.drawFormat(mask);
    const score = matrix.penalty();
    if (score < bestPenalty) {
      best = matrix;
      bestPenalty = score;
    }
  }
  return (best as Matrix).dark;
}

/** SVG-путь из тёмных модулей с полями в четыре модуля. */
export function qrSvgPath(matrix: boolean[][]): { path: string; size: number } {
  const quiet = 4;
  let path = "";
  matrix.forEach((row, y) =>
    row.forEach((isDark, x) => {
      if (isDark) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
    }),
  );
  return { path, size: matrix.length + quiet * 2 };
}
