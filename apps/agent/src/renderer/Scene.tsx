import { memo } from "react";

/**
 * Ночной лес за экраном блокировки — фирменная сцена Cyber-Fox.
 *
 * Одна картина на весь экран: окна входа и афиши лежат поверх неё как стекло.
 * Движется немногое и медленно — туман, светлячки, хвост и глаз лисы, — чтобы
 * сцена жила, но не отвлекала от входа. При «уменьшить движение» в Windows всё
 * замирает (styles.css).
 *
 * Деревья раскиданы генератором с постоянным зерном: картинка на всех ПК
 * одинаковая и не прыгает при перезапуске.
 */

const W = 1920;
const H = 1080;

/** Простой генератор с зерном: одинаковый лес при каждом запуске. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ель: ярусы с зубцами по краям и короткий ствол. */
function pine(x: number, base: number, h: number, w: number): string {
  const tiers = 7;
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 1; i <= tiers; i += 1) {
    const y = base - h + (h * i) / tiers;
    const half = (w / 2) * (i / tiers) ** 0.85;
    const inner = half * 0.55;
    const notch = (h / tiers) * 0.15;
    right.push([x + half, y], [x + inner, y - notch]);
    left.push([x - half, y], [x - inner, y - notch]);
  }
  const trunk = w * 0.06;
  const points: Array<[number, number]> = [
    [x, base - h],
    ...right.slice(0, -1),
    [x + trunk, base],
    [x + trunk, base + 40],
    [x - trunk, base + 40],
    [x - trunk, base],
    ...left.slice(0, -1).reverse(),
  ];
  return points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
}

interface Layer {
  count: number;
  base: number;
  hMin: number;
  hMax: number;
}

/** Слой леса. Слева гуще и выше, к окнам справа — ниже, чтобы не спорить с ними. */
function forestLayer(random: () => number, layer: Layer): string[] {
  const trees: string[] = [];
  for (let i = 0; i < layer.count; i += 1) {
    const x = -40 + (W + 80) * random() ** 1.7;
    const fade = Math.max(0.35, 1 - (x / W) * 0.75);
    const h = (layer.hMin + random() * (layer.hMax - layer.hMin)) * fade;
    trees.push(pine(x, layer.base + (random() - 0.5) * 20, h, h * 0.41));
  }
  return trees;
}

const random = seeded(20261007);
const FAR = forestLayer(random, { count: 46, base: 900, hMin: 260, hMax: 420 });
const MID = forestLayer(random, { count: 26, base: 960, hMin: 340, hMax: 560 });
// Ближние ели — только у левого края: лиса и окна должны быть открыты.
const NEAR = [
  pine(-30, 1060, 820, 312),
  pine(70, 1060, 700, 266),
  pine(150, 1060, 560, 213),
];
const FIREFLIES = Array.from({ length: 46 }, () => ({
  cx: Math.round(30 + 1870 * random() * random() ** 0.6),
  cy: Math.round(560 + random() * 490),
  r: [1.4, 1.8, 2.2, 2.8][Math.floor(random() * 4)],
  delay: -(random() * 14).toFixed(1),
  duration: (10 + random() * 8).toFixed(1),
}));

export const Scene = memo(function Scene() {
  return (
    <svg className="scene" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05090c" />
          <stop offset=".6" stopColor="#0a1416" />
          <stop offset="1" stopColor="#0d1a17" />
        </linearGradient>
        <radialGradient id="scene-halo" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ffb36b" stopOpacity=".55" />
          <stop offset=".4" stopColor="#e1521c" stopOpacity=".18" />
          <stop offset="1" stopColor="#e1521c" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="scene-mist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5fe3b0" stopOpacity="0" />
          <stop offset="1" stopColor="#5fe3b0" stopOpacity=".12" />
        </linearGradient>
        <linearGradient id="scene-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#04090a" stopOpacity="0" />
          <stop offset=".5" stopColor="#04090a" />
        </linearGradient>
        <filter id="scene-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width={W} height={H} fill="url(#scene-sky)" />
      <circle cx="430" cy="500" r="430" fill="url(#scene-halo)" />
      <circle cx="430" cy="500" r="92" fill="#ffe2c4" opacity=".92" />

      <g fill="#0f2826" stroke="#5fe3b0" strokeOpacity=".22" strokeWidth="1.2">
        {FAR.map((points, i) => (
          <polygon key={i} points={points} />
        ))}
      </g>
      <rect className="mist m1" x="-200" y="640" width={W + 400} height="360" fill="url(#scene-mist)" />
      <g fill="#0a1c1a" stroke="#5fe3b0" strokeOpacity=".14" strokeWidth="1">
        {MID.map((points, i) => (
          <polygon key={i} points={points} />
        ))}
      </g>
      <rect x="0" y="860" width={W} height="220" fill="url(#scene-ground)" />

      <g filter="url(#scene-glow)">
        <g transform="translate(380,872) scale(1.7)">
          <path
            d="M-150,10 C-120,-12 -60,-18 0,-14 C60,-18 130,-10 170,12 Z"
            fill="#071211"
            stroke="#5fe3b0"
            strokeOpacity=".25"
          />
          <path className="fx tail" d="M-6,-6 C-80,-2 -118,-56 -96,-118 C-84,-80 -58,-44 -14,-34 Z" />
          <path className="fx tailtip" d="M-96,-118 C-104,-100 -104,-84 -98,-70 C-92,-90 -90,-104 -96,-118 Z" />
          <path className="fx body" d="M-18,0 C-30,-48 -14,-100 22,-122 L52,-120 C60,-82 58,-34 48,0 Z" />
          <path className="fx chest" d="M36,-112 C52,-82 52,-40 46,0 L30,0 C38,-40 38,-78 30,-106 Z" />
          <path
            className="fx head"
            d="M18,-120 L24,-170 L44,-146 L58,-176 L68,-142 C80,-136 92,-130 104,-126 C92,-118 78,-112 64,-110 L40,-106 Z"
          />
          <path className="fx ear" d="M26,-160 L28,-136 L40,-146 Z M58,-164 L56,-140 L65,-144 Z" />
          <circle cx="70" cy="-132" r="3.4" className="fox-eye" />
          <circle cx="104" cy="-126" r="2.4" fill="#1a0d08" />
        </g>
      </g>

      <g fill="#040b0b">
        {NEAR.map((points, i) => (
          <polygon key={i} points={points} />
        ))}
      </g>
      <rect className="mist m2" x="-200" y="780" width={W + 400} height="300" fill="url(#scene-mist)" />

      <g className="fireflies" fill="#c8ffe9" filter="url(#scene-glow)">
        {FIREFLIES.map((f, i) => (
          <circle
            key={i}
            cx={f.cx}
            cy={f.cy}
            r={f.r}
            style={{ animationDelay: `${f.delay}s`, animationDuration: `${f.duration}s` }}
          />
        ))}
      </g>
    </svg>
  );
});
