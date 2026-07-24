// Último pase: queries manuales para clubes cuyo nombre corto no matchea el nombre completo de la API.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CRESTS = path.join(DATA, 'crests');
const CACHE = path.join(ROOT, '.etl-cache', 'crest-lookup.json');
const API = 'https://www.thesportsdb.com/api/v1/json/3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// id -> [query, país esperado] (los ambiguos como Leipzig/Wimbledon se omiten a propósito)
const QUERIES = {
  'ENG1-NottmForest': ['Nottingham Forest', 'England'],
  'ENG1-Oldham': ['Oldham Athletic', 'England'],
  'ESP1-Oviedo': ['Real Oviedo', 'Spain'],
  'ESP1-Murcia': ['Real Murcia', 'Spain'],
  'GER1-Ulm': ['SSV Ulm 1846', 'Germany'],
  'GER1-Braunschweig': ['Eintracht Braunschweig', 'Germany'],
  'GER1-Dusseldorf': ['Fortuna Dusseldorf', 'Germany'],
  'GER1-Dresden': ['Dynamo Dresden', 'Germany'],
  'FRA1-Lille': ['LOSC Lille', 'France'],
  'FRA1-Reims': ['Stade de Reims', 'France'],
};

const cache = JSON.parse(await readFile(CACHE, 'utf8'));

async function search(q) {
  for (let a = 0; ; a++) {
    const res = await fetch(`${API}/searchteams.php?t=${encodeURIComponent(q)}`);
    const text = await res.text();
    if (res.status === 429 || text.includes('error code: 1015') || text.trim().startsWith('<')) {
      if (a >= 5) return [];
      await sleep(Math.min(120000, 15000 * 2 ** a)); continue;
    }
    try { return (JSON.parse(text).teams || []).filter((t) => t.strSport === 'Soccer'); }
    catch { return []; }
  }
}

let ok = 0;
for (const [id, [q, country]] of Object.entries(QUERIES)) {
  const teams = await search(q);
  await sleep(1000);
  const pick = teams.find((t) => t.strCountry === country) || teams[0];
  if (pick && (pick.strBadge || pick.strTeamBadge)) {
    const url = pick.strBadge || pick.strTeamBadge;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (url.split('.').pop() || 'png').split(/[?#]/)[0].toLowerCase();
      const safe = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'png';
      await writeFile(path.join(CRESTS, `${id}.${safe}`), buf);
      cache[id] = { url, matched: pick.strTeam, league: pick.strLeague };
      ok++;
      console.log(`OK  ${id.padEnd(20)} -> "${pick.strTeam}" [${pick.strCountry} · ${pick.strLeague}]`);
      await sleep(400);
    } catch (e) { console.log(`ERR ${id}: ${e.message}`); }
  } else {
    console.log(`--  ${id.padEnd(20)} sin resultado para "${q}"`);
  }
}
await writeFile(CACHE, JSON.stringify(cache, null, 0));
console.log(`\nRecuperados ${ok}/${Object.keys(QUERIES).length}.`);
