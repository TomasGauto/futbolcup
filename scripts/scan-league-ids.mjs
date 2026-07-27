// Escaneo puntual de ids de TheSportsDB (lookupleague) con caché y backoff ante 1015.
// Uso: node scripts/scan-league-ids.mjs 4486 4510   (rango inclusive)
//      node scripts/scan-league-ids.mjs 4482,4483,4873 (lista)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const CACHE = path.join(ROOT, '.etl-cache', 'trophy-lookup.json');
const API = 'https://www.thesportsdb.com/api/v1/json/3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(path.dirname(CACHE), { recursive: true });
const cache = existsSync(CACHE) ? JSON.parse(await readFile(CACHE, 'utf8')) : {};

const args = process.argv.slice(2);
let ids = [];
if (args[0]?.includes(',')) ids = args[0].split(',').map(Number);
else if (args.length === 2) { for (let i = +args[0]; i <= +args[1]; i++) ids.push(i); }
else { console.error('uso: rango <a> <b> o lista a,b,c'); process.exit(1); }

async function lookup(id) {
  for (let a = 0; ; a++) {
    const res = await fetch(`${API}/lookupleague.php?id=${id}`);
    const text = await res.text();
    if (res.status === 429 || text.includes('error code: 1015') || text.trim().startsWith('<')) {
      if (a >= 5) return null;
      const w = Math.min(120000, 15000 * 2 ** a);
      console.log(`  rate-limit en ${id}, espero ${w / 1000}s...`);
      await sleep(w); continue;
    }
    try {
      const l = (JSON.parse(text).leagues || [])[0];
      if (!l) return { missing: true };
      return { strLeague: l.strLeague, strLeagueAlternate: l.strLeagueAlternate || '', strSport: l.strSport, strTrophy: l.strTrophy || null };
    } catch { return null; }
  }
}

for (const id of ids) {
  if (cache[id]) { console.log(`${id} (cache) ${cache[id].strLeague || '-'} trophy:${cache[id].strTrophy ? 'SI' : 'no'}`); continue; }
  const r = await lookup(id);
  if (r) cache[id] = r;
  console.log(`${id} ${r?.strLeague || (r?.missing ? '(no existe)' : '(error)')} [${r?.strSport || ''}] trophy:${r?.strTrophy ? 'SI' : 'no'}`);
  await writeFile(CACHE, JSON.stringify(cache, null, 1));
  await sleep(2200);
}
console.log('listo');
