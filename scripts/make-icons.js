#!/usr/bin/env node
/** Build Pearla toolbar icons + in-app marks from brand-source.png. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "src", "icons");
const SOURCE = join(HERE, "..", "src", "brand-source.png");
const NAVY = [15, 26, 43];

function px(img, x, y) {
  const i = (img.width * y + x) << 2;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

function isBg(r, g, b, a, bg) {
  if (a < 8) return true;
  const dr = r - bg[0];
  const dg = g - bg[1];
  const db = b - bg[2];
  return dr * dr + dg * dg + db * db < 40 * 40;
}

function cropTransparent(img, x0, y0, x1, y1, bg) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = px(img, x0 + x, y0 + y);
      const i = (w * y + x) << 2;
      if (isBg(r, g, b, a, bg)) {
        out.data[i] = 0;
        out.data[i + 1] = 0;
        out.data[i + 2] = 0;
        out.data[i + 3] = 0;
      } else {
        out.data[i] = r;
        out.data[i + 1] = g;
        out.data[i + 2] = b;
        out.data[i + 3] = 255;
      }
    }
  }
  return out;
}

function padSquare(img, padRatio = 0.1) {
  const side = Math.max(img.width, img.height);
  const pad = Math.round(side * padRatio);
  const size = side + pad * 2;
  const out = new PNG({ width: size, height: size });
  out.data.fill(0);
  const ox = Math.floor((size - img.width) / 2);
  const oy = Math.floor((size - img.height) / 2);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const si = (img.width * y + x) << 2;
      const di = (size * (oy + y) + ox + x) << 2;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  return out;
}

function resizeBilinear(img, size) {
  const out = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gx = ((x + 0.5) * img.width) / size - 0.5;
      const gy = ((y + 0.5) * img.height) / size - 0.5;
      const x0 = Math.max(0, Math.floor(gx));
      const y0 = Math.max(0, Math.floor(gy));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const y1 = Math.min(img.height - 1, y0 + 1);
      const tx = gx - x0;
      const ty = gy - y0;
      const di = (size * y + x) << 2;
      for (let c = 0; c < 4; c += 1) {
        const i00 = img.data[((img.width * y0 + x0) << 2) + c];
        const i10 = img.data[((img.width * y0 + x1) << 2) + c];
        const i01 = img.data[((img.width * y1 + x0) << 2) + c];
        const i11 = img.data[((img.width * y1 + x1) << 2) + c];
        out.data[di + c] = Math.round(
          (i00 * (1 - tx) + i10 * tx) * (1 - ty) + (i01 * (1 - tx) + i11 * tx) * ty,
        );
      }
    }
  }
  return out;
}

function flattenNavy(img) {
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    if (a >= 1) continue;
    img.data[i] = Math.round(img.data[i] * a + NAVY[0] * (1 - a));
    img.data[i + 1] = Math.round(img.data[i + 1] * a + NAVY[1] * (1 - a));
    img.data[i + 2] = Math.round(img.data[i + 2] * a + NAVY[2] * (1 - a));
    img.data[i + 3] = 255;
  }
  return img;
}

/** Round the toolbar icon corners with transparent corners so Chrome does not show a hard square. */
function roundCorners(img, radiusRatio = 0.22) {
  const size = img.width;
  const radius = Math.max(1, Math.round(size * radiusRatio));
  const out = new PNG({ width: size, height: size });
  out.data.set(img.data);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (size * y + x) << 2;
      let dx = 0;
      let dy = 0;
      if (x < radius && y < radius) {
        dx = radius - x;
        dy = radius - y;
      } else if (x >= size - radius && y < radius) {
        dx = x - (size - radius - 1);
        dy = radius - y;
      } else if (x < radius && y >= size - radius) {
        dx = radius - x;
        dy = y - (size - radius - 1);
      } else if (x >= size - radius && y >= size - radius) {
        dx = x - (size - radius - 1);
        dy = y - (size - radius - 1);
      } else {
        continue;
      }
      const dist = Math.hypot(dx, dy);
      if (dist <= radius - 0.75) continue;
      if (dist >= radius + 0.75) {
        out.data[i + 3] = 0;
        continue;
      }
      // Antialias the edge.
      const cover = Math.max(0, Math.min(1, radius + 0.75 - dist));
      out.data[i + 3] = Math.round(out.data[i + 3] * cover);
    }
  }
  return out;
}

function isRingStroke(r, g, b) {
  // The gold ring and its dark outline: warm tones, not pearl white.
  const sum = r + g + b;
  if (sum > 660) return false;
  if (b > g + 12 && b > 140) return false;
  if (r < 45 || g < 35) return false;
  return r >= g - 12 && g >= b - 35 && r + 20 >= b;
}

function contentBounds(img) {
  let minX = img.width;
  let minY = img.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.data[((img.width * y + x) << 2) + 3] < 16) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Measure stroke thickness along the radius: the outer ring is thin, the palm and pearl are thick. */
function radialThickness(img, x, y, cx, cy) {
  const dx = x - cx;
  const dy = y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let count = 1;
  for (const dir of [-1, 1]) {
    for (let s = 1; s < 48; s += 1) {
      const nx = Math.round(x + ux * s * dir);
      const ny = Math.round(y + uy * s * dir);
      if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) break;
      if (img.data[((img.width * ny + nx) << 2) + 3] < 16) break;
      count += 1;
    }
  }
  return count;
}

/** Drop the thin gold ring around the brand mark and keep only the pearl and the hand. */
function stripOuterRing(img) {
  const { minX, minY, maxX, maxY } = contentBounds(img);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let maxR = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (img.data[((img.width * y + x) << 2) + 3] < 16) continue;
      const r = Math.hypot(x - cx, y - cy);
      if (r > maxR) maxR = r;
    }
  }
  const out = new PNG({ width: img.width, height: img.height });
  out.data.set(img.data);
  const hard = maxR * 0.86;
  const soft = maxR * 0.66;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (img.width * y + x) << 2;
      if (out.data[i + 3] < 16) continue;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist < soft) continue;
      const r = out.data[i];
      const g = out.data[i + 1];
      const b = out.data[i + 2];
      const thick = radialThickness(out, x, y, cx, cy);
      // Clear the outermost ring entirely. In the next ring, clear thin strokes and the gold outline, and keep the thick palm.
      const drop =
        dist >= hard ||
        (thick <= 14 && isRingStroke(r, g, b)) ||
        (thick <= 10 && dist >= soft);
      if (!drop) continue;
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
      out.data[i + 3] = 0;
    }
  }
  // Clear leftover specks.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 1; y < out.height - 1; y += 1) {
      for (let x = 1; x < out.width - 1; x += 1) {
        const i = (out.width * y + x) << 2;
        if (out.data[i + 3] < 16) continue;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist < soft * 0.98) continue;
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            if (out.data[((out.width * (y + dy) + (x + dx)) << 2) + 3] > 16) neighbors += 1;
          }
        }
        if (neighbors <= 2 || (neighbors <= 4 && isRingStroke(out.data[i], out.data[i + 1], out.data[i + 2]))) {
          out.data[i] = 0;
          out.data[i + 1] = 0;
          out.data[i + 2] = 0;
          out.data[i + 3] = 0;
        }
      }
    }
  }
  return out;
}

const src = PNG.sync.read(readFileSync(SOURCE));
const samples = [
  px(src, 2, 2),
  px(src, src.width - 3, 2),
  px(src, 2, src.height - 3),
  px(src, src.width - 3, src.height - 3),
];
const bg = samples
  .reduce((acc, cur) => [acc[0] + cur[0], acc[1] + cur[1], acc[2] + cur[2]], [0, 0, 0])
  .map((value) => Math.round(value / 4));

let minX = src.width;
let minY = src.height;
let maxX = 0;
let maxY = 0;
const colDensity = new Array(src.width).fill(0);
for (let y = 0; y < src.height; y += 1) {
  for (let x = 0; x < src.width; x += 1) {
    const [r, g, b, a] = px(src, x, y);
    if (isBg(r, g, b, a, bg)) continue;
    colDensity[x] += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}

let gapStart = -1;
for (let x = Math.floor(src.width * 0.25); x < src.width * 0.7; x += 1) {
  if (colDensity[x] >= src.height * 0.01) continue;
  let ok = true;
  for (let k = 0; k < 12; k += 1) {
    if (colDensity[x + k] >= src.height * 0.015) {
      ok = false;
      break;
    }
  }
  if (ok) {
    gapStart = x;
    break;
  }
}

const markRight = gapStart > 0 ? gapStart - 4 : Math.floor(src.width * 0.38);
let mMinX = markRight;
let mMinY = src.height;
let mMaxX = 0;
let mMaxY = 0;
for (let y = 0; y < src.height; y += 1) {
  for (let x = 0; x < markRight; x += 1) {
    const [r, g, b, a] = px(src, x, y);
    if (isBg(r, g, b, a, bg)) continue;
    if (x < mMinX) mMinX = x;
    if (x > mMaxX) mMaxX = x;
    if (y < mMinY) mMinY = y;
    if (y > mMaxY) mMaxY = y;
  }
}

mkdirSync(ROOT, { recursive: true });

const pad = 8;
const word = new PNG({ width: maxX - minX + 1 + pad * 2, height: maxY - minY + 1 + pad * 2 });
for (let y = 0; y < word.height; y += 1) {
  for (let x = 0; x < word.width; x += 1) {
    const sx = minX - pad + x;
    const sy = minY - pad + y;
    const di = (word.width * y + x) << 2;
    if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) {
      word.data[di + 3] = 0;
      continue;
    }
    const [r, g, b, a] = px(src, sx, sy);
    if (isBg(r, g, b, a, bg)) {
      word.data[di + 3] = 0;
    } else {
      word.data[di] = r;
      word.data[di + 1] = g;
      word.data[di + 2] = b;
      word.data[di + 3] = 255;
    }
  }
}
writeFileSync(join(ROOT, "logo-wordmark.png"), PNG.sync.write(word));

const markRaw = padSquare(cropTransparent(src, mMinX, mMinY, mMaxX, mMaxY, bg), 0.06);
const stripped = stripOuterRing(markRaw);
const sb = contentBounds(stripped);
const markTight = new PNG({ width: sb.maxX - sb.minX + 1, height: sb.maxY - sb.minY + 1 });
for (let y = 0; y < markTight.height; y += 1) {
  for (let x = 0; x < markTight.width; x += 1) {
    const si = (stripped.width * (sb.minY + y) + (sb.minX + x)) << 2;
    const di = (markTight.width * y + x) << 2;
    markTight.data[di] = stripped.data[si];
    markTight.data[di + 1] = stripped.data[si + 1];
    markTight.data[di + 2] = stripped.data[si + 2];
    markTight.data[di + 3] = stripped.data[si + 3];
  }
}
const mark = padSquare(markTight, 0.08);
writeFileSync(join(ROOT, "mark.png"), PNG.sync.write(mark));
// pearl.png is the wallet brand mark (welcome, settings, and lock). pearl.webp is the official Pearl token icon beside the balance. Do not overwrite it.
writeFileSync(join(ROOT, "pearl.png"), PNG.sync.write(resizeBilinear(mark, 128)));

for (const size of [16, 32, 48, 128]) {
  const icon = roundCorners(flattenNavy(resizeBilinear(mark, size)));
  writeFileSync(join(ROOT, `icon${size}.png`), PNG.sync.write(icon));
}

console.log("Pearla icons written to", ROOT);
