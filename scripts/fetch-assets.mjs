// Kenney's direct download flow: encode "assets/<slug>" as UTF-8 hex, request
// /download-link/<id> with the browser User-Agent and the asset-page Referer,
// then immediately GET the returned URL with the same headers. The Referer is
// required; the response filename carries the kit version for the manifest.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, copyFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';

const root = process.cwd();
const rawRoot = path.join(root, 'assets/raw');
const outRoot = path.join(root, 'assets/third_party');
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' };
const kenney = ['fantasy-town-kit','castle-kit','modular-space-kit','space-kit','city-kit-suburban','city-kit-commercial','city-kit-roads','pirate-kit','survival-kit','nature-kit'];
const kaykit = [['KayKit-Medieval-Hexagon-Pack-1.0','kaykit-medieval-hexagon'],['KayKit-City-Builder-Bits-1.0','kaykit-city-builder-bits'],['KayKit-Space-Base-Bits-1.0','kaykit-space-base-bits'],['KayKit-Restaurant-Bits-1.0','kaykit-restaurant-bits'],['KayKit-Furniture-Bits-1.0','kaykit-furniture-bits']];
const iso = () => new Date().toISOString();
const hash = b => createHash('sha256').update(b).digest('hex');
const rel = (base, file) => path.relative(base, file).split(path.sep).join('/');
async function files(dir) { const out=[]; for (const e of await readdir(dir,{withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) out.push(...await files(p)); else out.push(p); } return out; }
function licenseEntry(names) { return names.find(n => /(^|\/)(license\.txt|license)$/i.test(n)); }
function checkLicense(pack, bytes) { const text = new TextDecoder().decode(bytes); if (!/creative commons zero|cc0/i.test(text)) throw new Error(`${pack}: LICENSE text is not CC0`); return bytes; }
async function manifest(pack, sourceUrl, sourceFile, licenseBytes) {
  checkLicense(pack, licenseBytes);
  const dir=path.join(outRoot,pack); await mkdir(dir,{recursive:true});
  const previous=await readFile(path.join(dir,'manifest.json'),'utf8').then(JSON.parse,()=>({}));
  const lic=path.join(dir,'LICENSE.txt'); await writeFile(lic,licenseBytes);
  const entries=[];
  for(const f of await files(dir)) { if(path.basename(f)==='manifest.json'||path.basename(f)==='.fetched') continue; const b=await readFile(f); entries.push({path:rel(dir,f),sha256:hash(b),bytes:b.length}); }
  entries.sort((a,b)=>a.path.localeCompare(b.path));
  const next={pack,sourceUrl,sourceFile,license:'CC0-1.0',fetchedAt:iso(),files:entries}; if(previous.optimized) next.optimized=previous.optimized;
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify(next,null,2)+'\n');
}
function safeName(n) { return n.replaceAll('\\','/').split('/').filter(x=>x&&x!=='.'&&x!=='..').join('/'); }
async function cacheZip(pack, url, extraHeaders={}) {
  await mkdir(rawRoot,{recursive:true}); const zp=path.join(rawRoot,`${pack}.zip`);
  if(await stat(zp).then(()=>true,()=>false)) { try { unzipSync(new Uint8Array(await readFile(zp))); return {zip:zp,sourceFile:path.basename(zp)}; } catch { /* invalid cache: replace it */ } }
  const res=await fetch(url,{headers:{...headers,...extraHeaders}}); if(!res.ok) throw new Error(`${pack}: download returned HTTP ${res.status}`);
  const bytes=new Uint8Array(await res.arrayBuffer()); try { unzipSync(bytes); } catch { throw new Error(`${pack}: response is not a valid zip`); }
  const disp=res.headers.get('content-disposition')||''; const m=disp.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  await writeFile(zp,bytes); return {zip:zp,sourceFile:m?.[1] ? decodeURIComponent(m[1].replaceAll('"','')) : path.basename(zp)};
}
async function unpackRaw(pack, zip) {
  const dir=path.join(rawRoot,pack); await mkdir(dir,{recursive:true});
  const archive=unzipSync(new Uint8Array(await readFile(zip)));
  for(const [rawName,bytes] of Object.entries(archive)){const name=safeName(rawName);if(!name)continue;const target=path.join(dir,...name.split('/'));if(rawName.endsWith('/')){await mkdir(target,{recursive:true});continue;}await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
}
async function copySelected(pack, zip, sourceUrl, sourceFile, family) {
  await unpackRaw(pack,zip);
  const archive=unzipSync(new Uint8Array(await readFile(zip))); const names=Object.keys(archive).map(safeName).filter(n=>n&&!n.endsWith('/'));
  const licenseName=licenseEntry(names); if(!licenseName) throw new Error(`${pack}: archive has no LICENSE file`);
  const licenseBytes=checkLicense(pack,archive[Object.keys(archive).find(k=>safeName(k)===licenseName)]);
  let base='';
  if(family==='kenney') { base=names.some(n=>/Models\/GLB format\//i.test(n))?'Models/GLB format/':'Models/GLTF format/'; }
  else { base=names.some(n=>/(^|\/)glb\//i.test(n))?'glb/':'gltf/'; }
  const selected=names.filter(n=>n.toLowerCase().includes(base.toLowerCase()) && (family==='kenney' ? /\.(glb|gltf|bin|png|jpe?g|webp)$/i.test(n) : /\.(glb|gltf|bin|png|jpe?g|webp)$/i.test(n)));
  if(!selected.some(n=>/\.glb$/i.test(n))&&!selected.some(n=>/\.gltf$/i.test(n))) console.log(`SKIP ${pack}: archive has no GLB/GLTF models`);
  const dir=path.join(outRoot,pack); await mkdir(dir,{recursive:true});
  const previous=await readFile(path.join(dir,'manifest.json'),'utf8').then(JSON.parse,()=>({}));
  for(const n of selected) { const idx=Object.keys(archive).find(k=>safeName(k)===n); const relName=n.slice(n.toLowerCase().indexOf(base.toLowerCase())+base.length); if(!relName) continue; const target=path.join(dir,...relName.split('/')); const optimizedHash=previous.optimized?.[relName]; if(optimizedHash){const current=await readFile(target).catch(()=>null);if(current&&hash(current)===optimizedHash)continue;} await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,archive[idx]); }
  await manifest(pack,sourceUrl,sourceFile,licenseBytes);
}
for(const slug of kenney) {
  const pack=`kenney-${slug}`, page=`https://kenney.nl/assets/${slug}`, id=Buffer.from(`assets/${slug}`,'utf8').toString('hex');
  try { const cached=await stat(path.join(rawRoot,`${pack}.zip`)).then(()=>true,()=>false);
    let got;
    if(cached) { try { unzipSync(new Uint8Array(await readFile(path.join(rawRoot,`${pack}.zip`)))); got={zip:path.join(rawRoot,`${pack}.zip`),sourceFile:path.basename(path.join(rawRoot,`${pack}.zip`))}; } catch { got=null; } }
    if(!got) { const link=await fetch(`https://kenney.nl/download-link/${id}`,{headers:{...headers,Referer:page}}); if(!link.ok) throw new Error(`download-link HTTP ${link.status}`); const data=await link.json(); if(!data.url) throw new Error('download-link response has no url'); got=await cacheZip(pack,data.url,{Referer:page}); }
    await copySelected(pack,got.zip,page,got.sourceFile,'kenney'); console.log(`Fetched ${pack}`);
  } catch(e) { if(/LICENSE|CC0/.test(e.message)) throw e; console.log(`SKIP ${pack}: ${e.message}`); }
  await new Promise(r=>setTimeout(r,2000));
}
for(const [repo,pack] of kaykit) {
  const api=`https://api.github.com/repos/KayKit-Game-Assets/${repo}`;
  try {
    const meta=await fetch(api,{headers:{'User-Agent':'Worldsmith asset fetcher','Accept':'application/vnd.github+json'}});
    if(!meta.ok) { console.log(`SKIP ${pack}: repository ${repo} unavailable (HTTP ${meta.status})`); continue; }
    const info=await meta.json(), branch=info.default_branch;
    const got=await cacheZip(pack,`https://codeload.github.com/KayKit-Game-Assets/${repo}/zip/refs/heads/${branch}`,{'User-Agent':'Worldsmith asset fetcher'});
    await copySelected(pack,got.zip,info.html_url,got.sourceFile,'kaykit'); console.log(`Fetched ${pack}`);
  } catch(e) { if(/LICENSE|CC0/.test(e.message)) throw e; console.log(`SKIP ${pack}: ${e.message}`); }
}
const existing='kaykit-adventurers', dir=path.join(outRoot,existing);
const lic=await readFile(path.join(dir,'LICENSE.txt')).catch(()=>null); if(!lic) throw new Error(`${existing}: pack has no LICENSE file`);
await manifest(existing,'https://kaylousberg.itch.io/kaykit-adventurers','',checkLicense(existing,lic));
