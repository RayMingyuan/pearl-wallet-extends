import assert from "node:assert/strict";
import test from "node:test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { QR_COLORS, QR_SIZE } from "../src/qr-brand.js";
import { LIVE_ADDRESS } from "./samples.js";

test("the packaged qr library encodes the full public address", async () => {
  const png = PNG.sync.read(await QRCode.toBuffer(LIVE_ADDRESS, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 256,
    color: { ...QR_COLORS },
  }));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded);
  assert.equal(decoded.data, LIVE_ADDRESS);
});

test("high-correction QR still decodes with a center logo pad occluded", async () => {
  const png = PNG.sync.read(await QRCode.toBuffer(LIVE_ADDRESS, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: QR_SIZE,
    color: { ...QR_COLORS },
  }));
  const box = 60;
  const left = Math.round((png.width - box) / 2);
  const top = Math.round((png.height - box) / 2);
  for (let y = top; y < top + box; y += 1) {
    for (let x = left; x < left + box; x += 1) {
      const i = (png.width * y + x) << 2;
      png.data[i] = 0xf6;
      png.data[i + 1] = 0xef;
      png.data[i + 2] = 0xe2;
      png.data[i + 3] = 255;
    }
  }
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.ok(decoded);
  assert.equal(decoded.data, LIVE_ADDRESS);
});
