// 画像補正：台形（射影）補正・自動レベル補正・明るさ/コントラスト/彩度・シャープ・回転

export function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });

export function clone(src) {
  const c = canvasOf(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function scaleDown(src, maxSide) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (s === 1) return src;
  const c = canvasOf(Math.round(src.width * s), Math.round(src.height * s));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function blobToCanvas(blob, maxSide = 2400) {
  let source;
  try {
    source = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めません')); };
      img.src = url;
    });
  }
  const c = canvasOf(source.width, source.height);
  ctx2d(c).drawImage(source, 0, 0);
  return scaleDown(c, maxSide);
}

export function rotate(src, quarterTurns) {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (q === 0) return src;
  const swap = q % 2 === 1;
  const c = canvasOf(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = ctx2d(c);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((q * Math.PI) / 2);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export const toBlob = (canvas, type = 'image/jpeg', quality = 0.9) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// --- 射影変換 -----------------------------------------------------------

// from[i] -> to[i] となる 3x3 ホモグラフィ（h33=1）を求める
function solveHomography(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c];
    if (Math.abs(d) < 1e-10) throw new Error('四隅の位置が不正です');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** quad = [左上, 右上, 右下, 左下]（元画像の座標） */
export function warp(src, quad, maxSide = 1800) {
  const [tl, tr, br, bl] = quad;
  let w = Math.max(dist(tl, tr), dist(bl, br));
  let h = Math.max(dist(tl, bl), dist(tr, br));
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * s));
  h = Math.max(1, Math.round(h * s));

  const H = solveHomography([[0, 0], [w, 0], [w, h], [0, h]], [tl, tr, br, bl]);
  const SW = src.width;
  const SH = src.height;
  const S = ctx2d(src).getImageData(0, 0, SW, SH).data;
  const out = canvasOf(w, h);
  const octx = ctx2d(out);
  const od = octx.createImageData(w, h);
  const O = od.data;

  for (let y = 0; y < h; y++) {
    const Y = y + 0.5;
    for (let x = 0; x < w; x++) {
      const X = x + 0.5;
      const d = H[6] * X + H[7] * Y + 1;
      let u = (H[0] * X + H[1] * Y + H[2]) / d - 0.5;
      let v = (H[3] * X + H[4] * Y + H[5]) / d - 0.5;
      u = u < 0 ? 0 : u > SW - 1 ? SW - 1 : u;
      v = v < 0 ? 0 : v > SH - 1 ? SH - 1 : v;
      const x0 = u | 0, y0 = v | 0;
      const x1 = x0 + 1 < SW ? x0 + 1 : x0;
      const y1 = y0 + 1 < SH ? y0 + 1 : y0;
      const fx = u - x0, fy = v - y0;
      const i00 = (y0 * SW + x0) * 4, i10 = (y0 * SW + x1) * 4;
      const i01 = (y1 * SW + x0) * 4, i11 = (y1 * SW + x1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = S[i00 + k] + (S[i10 + k] - S[i00 + k]) * fx;
        const bot = S[i01 + k] + (S[i11 + k] - S[i01 + k]) * fx;
        O[o + k] = top + (bot - top) * fy;
      }
      O[o + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-6) return false;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

// --- 色補正 -------------------------------------------------------------

function percentile(hist, total, p) {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/** チャンネル別ストレッチ（ホワイトバランス）と輝度ストレッチを半々で混ぜる。色の強いラベルが転びすぎないように */
export function autoLevels(canvas) {
  const ctx = ctx2d(canvas);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const hists = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < d.length; i += 4) {
    hists[0][d[i]]++; hists[1][d[i + 1]]++; hists[2][d[i + 2]]++;
    hists[3][(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  }
  const total = d.length / 4;
  const lumLo = percentile(hists[3], total, 0.005);
  const lumHi = percentile(hists[3], total, 0.995);
  const luts = [0, 1, 2].map((c) => {
    const lo = (percentile(hists[c], total, 0.005) + lumLo) / 2;
    const hi = (percentile(hists[c], total, 0.995) + lumHi) / 2;
    const lut = new Uint8ClampedArray(256);
    const range = Math.max(16, hi - lo);
    for (let i = 0; i < 256; i++) lut[i] = ((i - lo) * 255) / range;
    return lut;
  });
  for (let i = 0; i < d.length; i += 4) {
    d[i] = luts[0][d[i]]; d[i + 1] = luts[1][d[i + 1]]; d[i + 2] = luts[2][d[i + 2]];
  }
  ctx.putImageData(img, 0, 0);
}

/** brightness: -100..100, contrast: -100..100, saturation: -100..100 */
export function adjust(canvas, brightness, contrast, saturation) {
  if (!brightness && !contrast && !saturation) return;
  const ctx = ctx2d(canvas);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const c = contrast * 2.55;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = f * (i + brightness - 128) + 128;
  const sat = 1 + saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    if (saturation) {
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      r = gray + (r - gray) * sat; g = gray + (g - gray) * sat; b = gray + (b - gray) * sat;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

/** 3x3 アンシャープ（中心強調カーネル） */
export function sharpen(canvas, amount = 0.6) {
  const ctx = ctx2d(canvas);
  const w = canvas.width, h = canvas.height;
  const src = ctx.getImageData(0, 0, w, h);
  const S = src.data;
  const out = ctx.createImageData(w, h);
  const O = out.data;
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const nb = S[(ym * w + x) * 4 + k] + S[(yp * w + x) * 4 + k] + S[(y * w + xm) * 4 + k] + S[(y * w + xp) * 4 + k];
        O[i + k] = S[i + k] + amount * (4 * S[i + k] - nb);
      }
      O[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}
