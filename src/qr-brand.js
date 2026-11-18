import { err } from "./i18n.js";

/** Receive QR: high error correction, with the Pearl token mark centered. */
export const QR_SIZE = 220;
export const QR_COLORS = Object.freeze({ dark: "#0f1a2b", light: "#f6efe2" });
export const QR_LOGO_SRC = "icons/pearl.webp";

function logoUrl(src = QR_LOGO_SRC) {
  try {
    if (globalThis.chrome?.runtime?.getURL) return chrome.runtime.getURL(src);
  } catch { /* Outside the extension, use a relative path. */ }
  return src;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("代币图标加载失败"));
    img.src = src;
  });
}

function fillRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fill();
}

/** Draw the mark in the center of a finished QR. On failure, keep the plain code. */
export async function stampQrLogo(canvas, {
  src = QR_LOGO_SRC,
  logoSize = 48,
  pad = 6,
  radius = 10,
  fill = QR_COLORS.light,
} = {}) {
  if (!canvas?.getContext) return false;
  try {
    const img = await loadImage(logoUrl(src));
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const box = logoSize + pad * 2;
    const x = Math.round((canvas.width - box) / 2);
    const y = Math.round((canvas.height - box) / 2);
    ctx.fillStyle = fill;
    fillRoundRect(ctx, x, y, box, box, radius);
    ctx.drawImage(img, x + pad, y + pad, logoSize, logoSize);
    return true;
  } catch {
    return false;
  }
}

export async function drawBrandedQr(canvas, text, { qrcode, width = QR_SIZE } = {}) {
  if (typeof qrcode?.toCanvas !== "function") throw err("err.qr.missingToCanvas");
  await qrcode.toCanvas(canvas, text, {
    errorCorrectionLevel: "H",
    margin: 1,
    width,
    color: { ...QR_COLORS },
  });
  await stampQrLogo(canvas);
}
