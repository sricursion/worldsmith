// Fetches the animated human characters used for the world's folk, from their Poly Pizza model pages.
// Every page is checked before its file is taken: the author must be Quaternius and the page's own
// licence line must read "Public Domain (CC0)" with no CC-BY wording anywhere on it. The raw downloads
// stay in .cache/assets-raw/ (gitignored). Only the optimised GLBs, a LICENSE.txt that records the
// licence evidence per model, and manifest.json are written under assets/third_party/.
//
// Usage: node scripts/fetch-humans.mjs [--force]
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PACK = 'quaternius-animated-humans';
const root = process.cwd();
const rawDir = path.join(root, '.cache', 'assets-raw', PACK);
const outDir = path.join(root, 'assets', 'third_party', PACK);
const cli = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');
const force = process.argv.includes('--force');
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' };

/** file stem -> Poly Pizza model id. Two rig families: the 62-joint "CharacterArmature" set (24 clips) and the
 * 31-joint "HumanArmature" set (11 clips with sit and clap). */
const MODELS = [
  ['casual', 'kZ3DmIoGip'], ['worker', 'Yg2bQZO6Hj'], ['businessman', 'JFrLIKqvCH'], ['farmer', '7pn3R6hPvE'],
  ['hoodie', 'gKLBoRsyKe'], ['beach', 'DojKLcO34E'], ['punk', 'BTALZymknF'], ['adventurer', '5EGWBMpuXq'],
  ['adventuress', 'ZwF0K7WBmu'], ['hooded', 'y9KWOVG21R'], ['formal-woman', 'nIItLV9nxS'], ['astronaut', '3hC2i0CTuO'],
  ['swat', 'Btfn3G5Xv4'], ['woman-jacket', 'AQsd9ngvKU'], ['woman-tank', 'XqzeZGB7iU'], ['woman-casual', 'jpKRgGDxhk'],
  ['man-casual', 'HMnuH5geEG'], ['man-suit', 'mQnGoME1ez'],
];
const AUTHOR = 'Quaternius';
const CC0_DEED = 'https://creativecommons.org/publicdomain/zero/1.0/';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const exists = (p) => stat(p).then(() => true, () => false);
const text = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#8203;/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd: root, shell: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`gltf-transform failed (${signal ?? code})`))));
  });
}

/** Reads one model page and refuses anything that is not plainly CC0 by Quaternius. */
async function inspectPage(stem, id) {
  const url = `https://poly.pizza/m/${id}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${stem}: ${url} returned HTTP ${res.status}`);
  const html = await res.text();
  const flat = text(html);
  const author = html.match(/href="\/u\/([^"]+)"/)?.[1];
  if (author !== AUTHOR) throw new Error(`${stem}: author is ${author ?? 'unknown'}, expected ${AUTHOR}`);
  if (/CC-BY|CC BY|Attribution/i.test(html)) throw new Error(`${stem}: page mentions an attribution licence, refusing`);
  const line = flat.match(/([A-Z][a-z]{2} \d{1,2}, \d{4}) • (?:[A-Za-z]+ ?\/? ?[A-Za-z]+ format • )?Public Domain \(CC0\)/);
  if (!line) throw new Error(`${stem}: no "Public Domain (CC0)" licence line on ${url}`);
  const title = html.match(/<title[^>]*>([^<]*?) - Free 3D Model/)?.[1]?.trim() ?? stem;
  const glb = html.match(/https:\/\/static\.poly\.pizza\/[0-9a-f-]+\.glb(?![.\w])/)?.[0];
  if (!glb) throw new Error(`${stem}: no GLB link on ${url}`);
  return { url, title, author, date: line[1], licenceLine: line[0], glb };
}

await mkdir(rawDir, { recursive: true });
await mkdir(outDir, { recursive: true });
const manifestPath = path.join(outDir, 'manifest.json');
const previous = await readFile(manifestPath, 'utf8').then(JSON.parse, () => ({}));
const optimized = {};
const evidence = [];

for (const [stem, id] of MODELS) {
  const info = await inspectPage(stem, id);
  const rawPath = path.join(rawDir, `${stem}.glb`);
  if (force || !(await exists(rawPath))) {
    const res = await fetch(info.glb, { headers });
    if (!res.ok) throw new Error(`${stem}: GLB download returned HTTP ${res.status}`);
    await writeFile(rawPath, Buffer.from(await res.arrayBuffer()));
  }
  const raw = await readFile(rawPath);
  if (raw.readUInt32LE(0) !== 0x46546c67) throw new Error(`${stem}: download is not a GLB`);
  const target = path.join(outDir, `${stem}.glb`);
  const unchanged = !force && previous.optimized?.[`${stem}.glb`] && (await readFile(target).then((b) => sha256(b) === previous.optimized[`${stem}.glb`], () => false));
  if (!unchanged) {
    const tmp = `${target}.opt.tmp.glb`;
    await rm(tmp, { force: true });
    await run(['optimize', rawPath, tmp, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512',
      '--flatten', 'false', '--join', 'false', '--palette', 'false', '--instance', 'false', '--simplify', 'false']);
    if (!(await exists(tmp))) throw new Error(`${stem}: optimizer produced no output`);
    await rename(tmp, target);
  }
  const out = await readFile(target);
  optimized[`${stem}.glb`] = sha256(out);
  evidence.push({ stem, id, ...info, rawBytes: raw.length, rawSha256: sha256(raw) });
  console.log(`${stem}.glb: ${raw.length} -> ${out.length} bytes (${info.title}, ${info.date})`);
}

const fetchedAt = new Date().toISOString();
const legal = await fetch(`${CC0_DEED}legalcode.txt`, { headers }).then((r) => (r.ok ? r.text() : ''), () => '');
const licence = [
  'Creative Commons Zero 1.0 Universal (CC0 1.0) Public Domain Dedication',
  CC0_DEED,
  '',
  `Author: ${AUTHOR} (https://quaternius.com/)`,
  `Retrieved: ${fetchedAt}`,
  '',
  'Each model below was published on its Poly Pizza page with the licence line quoted here. The line is the',
  'page\'s own statement; the deed above applies to every file in this folder.',
  '',
  ...evidence.map((e) => `${e.stem}.glb  "${e.title}"  ${e.url}\n    page licence line: "${e.licenceLine}"\n    original download sha256 ${e.rawSha256} (${e.rawBytes} bytes)`),
  '',
  legal ? '---\n\n' + legal.trim() + '\n' : `Full legal code: ${CC0_DEED}legalcode\n`,
].join('\n');
await writeFile(path.join(outDir, 'LICENSE.txt'), licence);

const files = [];
for (const name of [...Object.keys(optimized), 'LICENSE.txt']) {
  const b = await readFile(path.join(outDir, name));
  files.push({ path: name, sha256: sha256(b), bytes: b.length });
}
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = {
  pack: PACK,
  sourceUrl: 'https://poly.pizza/u/Quaternius',
  sourceFile: '',
  license: 'CC0-1.0',
  fetchedAt,
  files,
  optimized,
  sources: evidence.map((e) => ({ file: `${e.stem}.glb`, url: e.url, title: e.title, date: e.date })),
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${PACK}: ${files.length} files, ${files.reduce((n, f) => n + f.bytes, 0)} bytes`);
