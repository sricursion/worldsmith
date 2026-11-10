// Evaluates the sky preset table with a port of the Sky shader and flags obviously bad values.
// Run: node tests/engine/_sky/check-presets.mjs
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
const entry = fileURLToPath(new URL('../../../app/src/engine/sky.ts', import.meta.url));
const out = buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'error' });
const { SKY_PRESETS, skyLookFor, skyRadiance, hazeMix, sunFromHour, exposureFor } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
import { acesToSrgb, toHex, luma } from './shader-port.mjs';

const hours = [0, 6.5, 8, 12, 17.5, 19];
const bad = [];
const rows = [];

const dirAt = (elev, azDeg) => {
  const e = (elev * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
};

for (const [name, p] of Object.entries(SKY_PRESETS)) {
  if (name !== 'overcast' && p.turbidity > 10) bad.push(`${name}: turbidity ${p.turbidity} > 10`);
  for (const h of hours) {
    const sun = sunFromHour(h);
    const look = skyLookFor(name, h);
    const exp = exposureFor(name, h);
    if (exp < 0.25 || exp > 0.9) bad.push(`${name}@${h}: exposure ${exp.toFixed(2)} outside 0.25..0.9`);
    const az = sun.azimuthDeg + 90;
    const shown = (elev) => {
      const d = dirAt(elev, az);
      return acesToSrgb(hazeMix(look, skyRadiance(p, sun.direction, d), d[1]), exp);
    };
    const hor = shown(4);
    const zen = shown(80);
    const fog = acesToSrgb(look.fog.toArray(), exp);
    const gap = Math.max(...hor.map((v, i) => Math.abs(v - fog[i])));
    rows.push({ preset: name, hour: h, sunEl: sun.elevationDeg.toFixed(0), exp: exp.toFixed(2), zenith: toHex(zen), horizon: toHex(hor), fog: toHex(fog), fogGap: gap.toFixed(0) });
    if (sun.daylight > 0.5 && luma(fog) > luma([240, 240, 240])) bad.push(`${name}@${h}: fog ${toHex(fog)} lighter than #f0f0f0`);
    if (sun.daylight > 0.5 && luma(hor) > 245) bad.push(`${name}@${h}: horizon ${toHex(hor)} is washed out`);
    if (gap > 6) bad.push(`${name}@${h}: fog ${toHex(fog)} differs from horizon ${toHex(hor)} by ${gap.toFixed(0)}`);
  }
}
console.table(rows);
if (bad.length) { console.error('PROBLEMS\n' + bad.join('\n')); process.exit(1); }
console.log('preset table ok');
