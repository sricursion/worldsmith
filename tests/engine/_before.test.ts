import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Color } from 'three';
import { GRADES, applyGrade } from '../../app/src/engine/post';
import { shownLuminance } from '../../app/src/engine/atmosphere';
import { lightRigFor } from '../../app/src/engine/sky';
import type { GradeKind, SkyPreset, WeatherKind } from '../../app/src/world/spec';

const CASES: [string, SkyPreset, number, WeatherKind, number, GradeKind, number, string][] = [
  ['port', 'overcast', 5.75, 'rain', 0.75, 'teal_orange', 0.6, '#4a5256'],
  ['mushroom', 'night', 20.5, 'spores', 0.4, 'verdant', 0.7, '#2a4a3a'],
  ['monastery', 'night', 21.5, 'snow', 0.7, 'moonlit', 0.6, '#d3dde8'],
  ['needle', 'overcast', 19.5, 'rain', 0.6, 'neon_noir', 0.6, '#20262f'],
  ['west', 'dusk', 18.5, 'dust', 0.4, 'golden', 0.6, '#c4a074'],
];
const pc = (v: number): string => (100 * v).toFixed(1);
const hsv = (c: readonly number[]): [number, number] => {
  const [r, g, b] = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0];
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const d = hi - lo || 1e-9;
  const h = hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, hi > 0 ? (hi - lo) / hi : 0];
};

it('numbers', () => {
  const lines: string[] = [];
  for (const [name, preset, hour, weather, intensity, grade, haze, hex] of CASES) {
    const mood = { weather, intensity, grade, haze };
    const g = new Color(hex);
    const gl = 0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b;
    const rig = lightRigFor(preset, hour, { groundLuminance: gl });
    const a = shownLuminance({ preset, hour, mood });
    const far = shownLuminance({ preset, hour, mood, distance: Infinity });
    const own = shownLuminance({ preset, hour, mood, groundLuminance: gl, albedo: [g.r, g.g, g.b] });
    const ownFar = shownLuminance({ preset, hour, mood, groundLuminance: gl, albedo: [g.r, g.g, g.b], distance: Infinity });
    const greyOwn = shownLuminance({ preset, hour, mood, groundLuminance: gl });
    lines.push(`${name}: grey ${pc(a.encoded)} (far ${pc(far.encoded)}) exp ${a.exposure.toFixed(3)} | own ground lum ${gl.toFixed(3)} lift ${rig.lift.toFixed(2)} -> ${pc(own.encoded)} (far ${pc(ownFar.encoded)}) exp ${own.exposure.toFixed(3)} skyexp ${rig.exposure.toFixed(3)} | grey in that town ${pc(greyOwn.encoded)} | key ${rig.keyIntensity.toFixed(2)} hemi ${rig.hemiLevel.toFixed(2)} fill ${rig.fillCandela.toFixed(2)} tw ${rig.twilight.toFixed(2)} dark ${rig.dark.toFixed(2)}`);
  }
  for (const preset of ['dawn', 'day', 'dusk', 'night', 'overcast'] as const) {
    const row: string[] = [];
    for (let h = 0; h < 24; h += 1) row.push(pc(shownLuminance({ preset, hour: h, mood: { weather: 'clear', intensity: 0, grade: 'neutral', haze: 0.3 } }).encoded));
    lines.push(`${preset}: ${row.join(' ')}`);
    const fine: string[] = [];
    for (let h = 4.5; h <= 9; h += 0.25) fine.push(pc(shownLuminance({ preset, hour: h, mood: { weather: 'clear', intensity: 0, grade: 'neutral', haze: 0.3 } }).encoded));
    lines.push(`  4.5..9: ${fine.join(' ')}`);
  }
  const refs: [string, string, number][] = [['orange', '#ff8a2a', 1], ['magenta', '#ff2f8f', 1], ['yellow', '#ffd23a', 1], ['amber half', '#ffb347', 0.5], ['pink half', '#ff2f8f', 0.4]];
  for (const k of Object.keys(GRADES) as GradeKind[]) {
    const row: string[] = [];
    for (const [n, hex, s] of refs) {
      const c = new Color(hex).multiplyScalar(s);
      const out = applyGrade([c.r, c.g, c.b], GRADES[k]);
      const [h0, s0] = hsv([c.r, c.g, c.b]);
      const [h1, s1] = hsv(out);
      row.push(`${n} dh ${(h1 - h0).toFixed(1)} (${(100 * (h1 - h0) / h0).toFixed(0)}%) ds ${(100 * (s1 / s0 - 1)).toFixed(0)}%`);
    }
    lines.push(`${k}: ${row.join(' | ')}`);
  }
  writeFileSync(process.env['OUT'] ?? 'numbers.txt', lines.join(String.fromCharCode(10)));
});
