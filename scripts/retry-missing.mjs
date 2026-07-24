// Reintento dirigido de los escudos que cayeron a fallback, con matching de país flexible.
// Verifica el nombre matcheado en pantalla para poder descartar homónimos a mano.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CRESTS = path.join(DATA, 'crests');
const CACHE = path.join(ROOT, '.etl-cache', 'crest-lookup.json');
const API = 'https://www.thesportsdb.com/api/v1/json/3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// países aceptables por liga (incluye vecinos: Gales para clubes ingleses, Mónaco para franceses)
const OK_COUNTRIES = {
  ENG1: ['England', 'Wales'],
  ESP1: ['Spain'],
  ITA1: ['Italy', 'San Marino'],
  GER1: ['Germany'],
  FRA1: ['France', 'Monaco'],
};

const clubs = JSON.parse(await readFile(path.join(DATA, 'clubs.json'), 'utf8'));
const cache = JSON.parse(await readFile(CACHE, 'utf8'));
const man = JSON.parse(await readFile(path.join(DATA, 'assets-manifest.json'), 'utf8'));
const generatedIds = man.crests.filter((c) => c.source === 'generated').map((c) => c.id);
const byId = Object.fromEntries(clubs.map((c) => [c.id, c]));
await mkdir(CRESTS, { recursive: true });

function norm(s) { return s.toLowerCase().replace(/[^a-z]/g, ''); }

async function search(q) {
  for (let a = 0; ; a++) {
    const res = await fetch(`${API}/searchteams.php?t=${encodeURIComponent(q)}`);
    const text = await res.text();
    if (res.status === 429 || text.includes('error code: 1015') || text.trim().startsWith('<')) {
      if (a >= 5) return [];
      const w = Math.min(120000, 15000 * 2 ** a);
      process.stdout.write(`  rate-limit, espero ${w / 1000}s...\n`);
      await sleep(w); continue;
    }
    try { return (JSON.parse(text).teams || []).filter((t) => t.strSport === 'Soccer'); }
    catch { return []; }
  }
}

let recovered = 0;
for (const id of generatedIds) {
  const club = byId[id];
  const ok = OK_COUNTRIES[club.leagueId] || [];
  const queries = [...new Set([club.name, club.rawName])].filter(Boolean);
  let pick = null;
  for (const q of queries) {
    const teams = await search(q);
    await sleep(1000);
    if (!teams.length) continue;
    const inCountry = teams.filter((t) => ok.includes(t.strCountry));
    // preferí coincidencia de nombre normalizado; luego país; luego nada
    pick = inCountry.find((t) => norm(t.strTeam) === norm(club.name))
        || inCountry.find((t) => norm(t.strTeam).includes(norm(club.rawName)) || norm(club.rawName).includes(norm(t.strTeam)))
        || inCountry[0] || null;
    if (pick) break;
  }
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
      recovered++;
      console.log(`OK  ${id.padEnd(22)} -> "${pick.strTeam}" [${pick.strCountry} · ${pick.strLeague}]`);
      await sleep(400);
    } catch (e) { console.log(`ERR ${id}: ${e.message}`); }
  } else {
    console.log(`--  ${id.padEnd(22)} sin coincidencia fiable (queda SVG)`);
  }
}
await writeFile(CACHE, JSON.stringify(cache, null, 0));
console.log(`\nRecuperados ${recovered} escudos reales de ${generatedIds.length} intentados.`);
