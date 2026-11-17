// Bundles dist/ into a single Worker module (assets inlined as base64).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const types = { '.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon' };
const files = {};
(function walk(d, p = '') { for (const f of readdirSync(d)) { const full = join(d, f);
  if (statSync(full).isDirectory()) walk(full, p + '/' + f);
  else files[p + '/' + f] = [types[extname(f)] || 'application/octet-stream', readFileSync(full).toString('base64')]; } })('dist');
writeFileSync('dist-worker.mjs', `const A=${JSON.stringify(files)};
const dec=b=>Uint8Array.from(atob(b),c=>c.charCodeAt(0));
export default{fetch(r){let p=new URL(r.url).pathname;if(p==='/')p='/index.html';const a=A[p]||A['/index.html'];
return new Response(dec(a[1]),{headers:{'content-type':a[0],'cache-control':p.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache'}})}};`);
