// Regenera assets-manifest.json (parte crests) de forma determinista desde clubs.json + disco + caché.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CRESTS = path.join(DATA, 'crests');

const clubs = JSON.parse(await readFile(path.join(DATA, 'clubs.json'), 'utf8'));
const cache = JSON.parse(await readFile(path.join(ROOT, '.etl-cache', 'crest-lookup.json'), 'utf8'));
const files = await readdir(CRESTS);

// índice: id -> filename (match exacto por basename sin extensión) + fallback case-insensitive
const byBase = new Map();
const byBaseLower = new Map();
for (const f of files) {
  const b = f.replace(/\.[^.]+$/, '');
  byBase.set(b, f);
  byBaseLower.set(b.toLowerCase(), f);
}

// detectar ids duplicados case-insensitive (bug de datos: clubes que colisionan en FS case-insensitive)
const seen = new Map();
for (const c of clubs) seen.set(c.id.toLowerCase(), (seen.get(c.id.toLowerCase()) || 0) + 1);
const dupIds = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
if (dupIds.length) console.log('AVISO ids duplicados (case-insensitive), comparten escudo:', dupIds);

const crests = [];
const missing = [];
for (const c of clubs) {
  // exacto primero; si no, el archivo del club homónimo (mismo club, distinto casing)
  const f = byBase.get(c.id) || byBaseLower.get(c.id.toLowerCase());
  if (!f) { missing.push(c.id); continue; }
  const isSvg = f.endsWith('.svg');
  const hit = cache[c.id];
  crests.push({
    id: c.id, name: c.name, leagueId: c.leagueId, division: c.division,
    file: 'crests/' + f, source: isSvg ? 'generated' : 'real',
    ...(hit && hit.matched ? { matched: hit.matched } : {}),
  });
}

if (missing.length) { console.log('CLUBS SIN ARCHIVO:', missing); process.exit(1); }

const man = JSON.parse(await readFile(path.join(DATA, 'assets-manifest.json'), 'utf8'));
man.crests = crests;
await writeFile(path.join(DATA, 'assets-manifest.json'), JSON.stringify(man, null, 2));

const real = crests.filter((c) => c.source === 'real').length;
console.log(`Manifiesto OK: ${crests.length} entradas | ${real} reales | ${crests.length - real} generados`);
