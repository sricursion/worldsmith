// ACES filmic as three.js applies it, plus sRGB encoding, so the Node checks see what the screen shows.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function acesToSrgb(rgb, exposure) {
  const [r0, g0, b0] = rgb.map((v) => (v * exposure) / 0.6);
  const m = [
    0.59719 * r0 + 0.35458 * g0 + 0.04823 * b0,
    0.076 * r0 + 0.90834 * g0 + 0.01566 * b0,
    0.0284 * r0 + 0.13383 * g0 + 0.83777 * b0,
  ].map((v) => {
    const a = v * (v + 0.0245786) - 0.000090537;
    const d = v * (0.983729 * v + 0.432951) + 0.238081;
    return a / d;
  });
  const [r, g, b] = m;
  const o = [
    1.60475 * r - 0.53108 * g - 0.07367 * b,
    -0.10208 * r + 1.10813 * g - 0.00605 * b,
    -0.00327 * r - 0.07276 * g + 1.07602 * b,
  ];
  return o.map((v) => {
    const l = clamp(v, 0, 1);
    return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
  });
}

export const toHex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
export const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
