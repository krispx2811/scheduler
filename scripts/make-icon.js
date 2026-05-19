// Generate a 512x512 brand icon: rounded-square coral→purple gradient
// with a 3x3 schedule-grid mark. Output: build/icon.png (electron-builder converts to .ico/.icns).
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const RADIUS = 96;
const png = new PNG({ width: SIZE, height: SIZE });

// Palette (matches app's coral/purple gradient)
const c1 = { r: 232, g: 136, b: 105 }; // coral
const c2 = { r: 180, g: 140, b: 208 }; // purple
const mark = { r: 255, g: 255, b: 255 };

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
function blend(a, b, t) { return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) }; }

// Rounded-corner alpha mask
function cornerAlpha(x, y) {
  let dx = 0, dy = 0;
  if (x < RADIUS) dx = RADIUS - x;
  else if (x >= SIZE - RADIUS) dx = x - (SIZE - RADIUS - 1);
  if (y < RADIUS) dy = RADIUS - y;
  else if (y >= SIZE - RADIUS) dy = y - (SIZE - RADIUS - 1);
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= RADIUS - 1) return 255;
  if (d >= RADIUS) return 0;
  return Math.round((RADIUS - d) * 255);
}

// 3x3 schedule grid — a stack of equally spaced rounded squares.
function inMark(x, y) {
  const cell = 80;
  const gap = 18;
  const dim = 3 * cell + 2 * gap;        // 240+36 = 276
  const startX = Math.round((SIZE - dim) / 2);
  const startY = Math.round((SIZE - dim) / 2);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = startX + col * (cell + gap);
      const cy = startY + row * (cell + gap);
      if (x >= cx && x < cx + cell && y >= cy && y < cy + cell) {
        // Rounded corners on each cell
        const r = 14;
        const lx = x - cx, ly = y - cy;
        const ix = lx < r ? r - lx : lx >= cell - r ? lx - (cell - r - 1) : 0;
        const iy = ly < r ? r - ly : ly >= cell - r ? ly - (cell - r - 1) : 0;
        if (Math.sqrt(ix * ix + iy * iy) > r) continue;
        return true;
      }
    }
  }
  return false;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (SIZE * y + x) << 2;
    const t = (x / SIZE) * 0.55 + (y / SIZE) * 0.45;
    let color = blend(c1, c2, t);
    if (inMark(x, y)) color = mark;
    png.data[idx + 0] = color.r;
    png.data[idx + 1] = color.g;
    png.data[idx + 2] = color.b;
    png.data[idx + 3] = cornerAlpha(x, y);
  }
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
png.pack().pipe(fs.createWriteStream(outPath)).on('finish', () => {
  console.log('[make-icon] wrote', outPath, `${SIZE}x${SIZE}`);
});
