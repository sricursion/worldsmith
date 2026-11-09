import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root=process.cwd(), base=path.join(root,'assets/third_party'), cli=path.join(root,'node_modules/.bin/gltf-transform.cmd');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
function run(args){return new Promise((resolve,reject)=>{const child=spawn(cli,args,{cwd:root,shell:true,stdio:'inherit'});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`gltf-transform failed (${signal||code})`)));});}
const packs=(await readdir(base,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();let grandBefore=0,grandAfter=0,grandCount=0;
for(const pack of packs){const dir=path.join(base,pack),mp=path.join(dir,'manifest.json');let m=await readFile(mp,'utf8').then(JSON.parse,()=>({pack,files:[]}));
  const license=await readFile(path.join(dir,'LICENSE.txt'),'utf8').catch(()=>null);if(!license)throw new Error(`${pack}: pack has no LICENSE file`);if(!/creative commons zero|cc0/i.test(license))throw new Error(`${pack}: LICENSE text is not CC0`);
  m.optimized??={};let count=0,beforeTotal=0,afterTotal=0;
  for(const file of (await walk(dir)).filter(f=>f.toLowerCase().endsWith('.glb')&&!f.toLowerCase().endsWith('.tmp.glb'))){const name=path.relative(dir,file).split(path.sep).join('/'),before=await readFile(file),beforeHash=hash(before);beforeTotal+=before.length;
    if(m.optimized[name]===beforeHash){afterTotal+=before.length;continue;}
    const tmp=`${file}.opt.tmp.glb`;await rm(tmp,{force:true});const args=['optimize',file,tmp,'--compress','meshopt','--texture-compress','webp','--texture-size','256'];if(pack==='kaykit-adventurers')args.push('--flatten','false','--join','false','--palette','false','--instance','false','--simplify','false');
    await run(args);const out=await readFile(tmp).catch(()=>null);if(!out)throw new Error(`${pack}/${name}: optimizer produced no output`);await rename(tmp,file);const after=await readFile(file),afterHash=hash(after);m.optimized[name]=afterHash;count++;afterTotal+=after.length;console.log(`${pack}/${name}: ${before.length} -> ${after.length} bytes`);
  }
  const entries=[];for(const f of await walk(dir)){const name=path.relative(dir,f).split(path.sep).join('/');if(name==='manifest.json'||name==='.fetched')continue;const b=await readFile(f);entries.push({path:name,sha256:hash(b),bytes:b.length});}entries.sort((a,b)=>a.path.localeCompare(b.path));m.pack=pack;m.license='CC0-1.0';m.files=entries;
  await writeFile(mp,JSON.stringify(m,null,2)+'\n');console.log(`${pack}: ${count} optimized, ${beforeTotal} -> ${afterTotal} bytes`);grandBefore+=beforeTotal;grandAfter+=afterTotal;grandCount+=count;
}
console.log(`TOTAL: ${grandCount} optimized, ${grandBefore} -> ${grandAfter} bytes`);
