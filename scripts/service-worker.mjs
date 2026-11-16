import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(f => f.isDirectory() ? files(dir + '/' + f.name) : [dir + '/' + f.name])
// Relative to this worker, so the cache never claims other apps on the same domain.
const assets = files('dist').filter(p => /\.(html|css|js|png|svg|webmanifest)$/.test(p) && !p.endsWith('/sw.js')).map(p => p.slice(5))
const hash = createHash('sha256').update(assets.map(p => p + createHash('sha256').update(readFileSync('dist/' + p)).digest('hex')).join('')).digest('hex').slice(0, 12)
writeFileSync('dist/sw.js', `const BASE=new URL('./',self.location.href).pathname,PREFIX='orbis-shell-'+encodeURIComponent(BASE)+'-',CACHE=PREFIX+'${hash}',ASSETS=${JSON.stringify(assets)}.map(p=>BASE+p);
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith(BASE))return;
if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.open(CACHE).then(c=>c.match(BASE+'index.html'))));return;}
if(ASSETS.includes(u.pathname)||u.pathname.startsWith(BASE+'memory/')||u.pathname.startsWith(BASE+'ort/'))e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;const r=await fetch(e.request);if(r.ok)await c.put(e.request,r.clone());return r;}));});`)
