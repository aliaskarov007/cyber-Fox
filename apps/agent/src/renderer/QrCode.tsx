import { encodeQr, qrSvgPath } from "../shared/qr.js";

export function Qr({ text, label = "QR-код" }: { text: string; label?: string }) {
  const { path, size } = qrSvgPath(encodeQr(text));
  return (
    // Белый фон обязателен: на тёмном экране камера тёмный QR не прочитает.
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
