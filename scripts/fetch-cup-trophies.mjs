// Reemplaza los SVG genéricos de copas (nacionales y continentales) por el PNG
// oficial de TheSportsDB (campo strTrophy, cacheado en .etl-cache/trophy-lookup.json
// por scripts/scan-league-ids.mjs). Verifica magic bytes PNG, borra el SVG viejo
// solo tras verificar el reemplazo y actualiza assets-manifest.json en el lugar.
//   node scripts/scan-league-ids.mjs 4482,4483,...   (llena la caché)
//   node scripts/fetch-cup-trophies.mjs
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const DATA = path.join(ROOT, 'public', 'data');
const TROPHIES = path.join(DATA, 'trophies');
const CACHE = path.join(ROOT, '.etl-cache', 'trophy-lookup.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// key del manifiesto -> idLeague de TheSportsDB (todas verificadas con strTrophy)
const TSDB_BY_KEY = {
  'copa-ENG1': 4482, // FA Cup
  'copa-ESP1': 4483, // Copa del Rey
  'copa-FRA1': 4484, // Coupe de France
  'copa-GER1': 4485, // DFB-Pokal
  'copa-ITA1': 4506, // Coppa Italia
  'copa-POR1': 4510, // Taca de Portugal
  'copa-NED1': 4902, // Dutch KNVB Cup
  'copa-BRA1': 4725, // Copa do Brasil
  'copa-ARG1': 4500, // Copa Argentina
  'copa-USA1': 5199, // US Open Cup
  'copa-COL1': 5183, // Copa Colombia
  // Copa MX no existe en TheSportsDB (torneo abolido en 2020); se usa el trofeo
  // oficial del Campeón de Campeones (FMF) como copa nacional mexicana del juego.
  'copa-MEX1': 5662,
  // Ligas nuevas (trofeo de campeón de liga)
  PER1: 4688, // Peruvian Primera Division (Liga 1)
  URU1: 4432, // Uruguayan Primera Division (Liga AUF)
  CHI1: 4627, // Chile Primera Division
  BEL1: 4338, // Belgian Pro League (Jupiler)
  RUS1: 4355, // Russian Football Premier League
  SAU1: 4668, // Saudi-Arabian Pro League
  // Copas nacionales de las ligas nuevas
  'copa-URU1': 5526, // Copa AUF Uruguay
  'copa-CHI1': 5378, // Copa Chile
  'copa-BEL1': 5831, // Belgian Cup (Croky Cup)
  'copa-RUS1': 5193, // Russia Cup
  'copa-SAU1': 5649, // Saudi King Cup
  // copa-PER1 no tiene fuente TSDB (Copa de la Liga 5908 sin strTrophy);
  // se descarga a mano desde Wikimedia Commons (File:Copa_Peru.svg render PNG).
  'cont-AFCChampionsLeague': 4719, // AFC Champions League Elite
  'cont-CopaLibertadores': 4501,
  'cont-CopaSudamericana': 4724,
  'cont-ConcacafChampionsCup': 4721,
  'cont-CopaAmrica': 4499,
  'cont-Eurocopa': 4502, // UEFA European Championships
  'cont-CopaOro': 4873, // CONCACAF Gold Cup
  'cont-CopaAfricanadeNaciones': 4496, // African Cup of Nations
  'cont-CopaAsitica': 4866, // AFC Asian Cup
};

const isPng = (buf) => buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

// --- entradas nuevas del manifiesto (ligas 2026: PER1/URU1/CHI1/BEL1/RUS1/SAU1 + AFC) ---
// kind/title se derivan de leagues.json para que el título matchee EXACTO el del juego
// (título de liga == lg.name; copa nacional == "Copa de <país>").
const NEW_KEYS = [
  { key: 'PER1', kind: 'league', leagueId: 'PER1' },
  { key: 'URU1', kind: 'league', leagueId: 'URU1' },
  { key: 'CHI1', kind: 'league', leagueId: 'CHI1' },
  { key: 'BEL1', kind: 'league', leagueId: 'BEL1' },
  { key: 'RUS1', kind: 'league', leagueId: 'RUS1' },
  { key: 'SAU1', kind: 'league', leagueId: 'SAU1' },
  { key: 'copa-PER1', kind: 'national', leagueId: 'PER1' },
  { key: 'copa-URU1', kind: 'national', leagueId: 'URU1' },
  { key: 'copa-CHI1', kind: 'national', leagueId: 'CHI1' },
  { key: 'copa-BEL1', kind: 'national', leagueId: 'BEL1' },
  { key: 'copa-RUS1', kind: 'national', leagueId: 'RUS1' },
  { key: 'copa-SAU1', kind: 'national', leagueId: 'SAU1' },
  { key: 'cont-AFCChampionsLeague', kind: 'continental', title: 'AFC Champions League' },
];
// paleta [primario, acento] para el SVG de fallback de las ligas nuevas
const NEW_PALETTE = {
  PER1: ['#7a0c1e', '#f2e6e8'], URU1: ['#0a2a5c', '#7ab8e6'], CHI1: ['#0a2d6b', '#d52b1e'],
  BEL1: ['#111111', '#f0c419'], RUS1: ['#0a2a5c', '#d52b1e'], SAU1: ['#0a5c36', '#e8d9a0'],
};

function escXml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// misma copa dorada estilizada que usa fetch-trophies.mjs (último recurso)
function cupSvg(name, primary, accent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="200" height="240" role="img" aria-label="Trofeo ${escXml(name)}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#e8b23a"/><stop offset="1" stop-color="#9a6b12"/></linearGradient>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${primary}"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="200" height="240" rx="16" fill="${primary}"/>
  <circle cx="100" cy="96" r="78" fill="rgba(255,255,255,.05)"/>
  <path d="M56 54 Q26 62 40 104 Q46 122 66 118" fill="none" stroke="url(#gold)" stroke-width="9" stroke-linecap="round"/>
  <path d="M144 54 Q174 62 160 104 Q154 122 134 118" fill="none" stroke="url(#gold)" stroke-width="9" stroke-linecap="round"/>
  <path d="M58 48 H142 V70 Q142 116 100 132 Q58 116 58 70 Z" fill="url(#gold)" stroke="#7a5310" stroke-width="2"/>
  <ellipse cx="100" cy="49" rx="42" ry="7" fill="#fff3c4" stroke="#7a5310" stroke-width="1.5"/>
  <rect x="92" y="132" width="16" height="20" fill="url(#gold)"/>
  <path d="M74 152 H126 L132 168 H68 Z" fill="url(#gold)" stroke="#7a5310" stroke-width="1.5"/>
  <rect x="62" y="168" width="76" height="18" rx="4" fill="url(#base)" stroke="#00000030" stroke-width="1"/>
  <text x="100" y="181" text-anchor="middle" font-family="Georgia,serif" font-size="10" font-weight="700" fill="#fff">${escXml(name.toUpperCase().slice(0, 22))}</text>
  <path d="M76 60 Q80 92 100 116" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

async function download(url) {
  for (let a = 0; ; a++) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status === 429 || (!res.ok && a < 4)) { await sleep(Math.min(120000, 15000 * 2 ** a)); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return buf;
  }
}

const cache = JSON.parse(await readFile(CACHE, 'utf8'));
const manPath = path.join(DATA, 'assets-manifest.json');
const man = JSON.parse(await readFile(manPath, 'utf8'));
let ok = 0, fail = 0;

// Pre-pase: creá las entradas nuevas si faltan. Si ya hay PNG en disco (descarga
// manual, p.ej. copa-PER1 desde Wikimedia) la entrada nace 'real'; si no, se
// escribe el SVG estilizado y la pasada TSDB de abajo lo reemplaza si puede.
{
  const leagues = JSON.parse(await readFile(path.join(DATA, 'leagues.json'), 'utf8'));
  const lgById = Object.fromEntries(leagues.map((l) => [l.id, l]));
  for (const spec of NEW_KEYS) {
    if (man.trophies.some((t) => t.key === spec.key)) continue;
    const lg = spec.leagueId ? lgById[spec.leagueId] : null;
    const title = spec.title ?? (spec.kind === 'league' ? lg.name : `Copa de ${lg.country}`);
    const entry = { key: spec.key, kind: spec.kind, title, ...(spec.leagueId ? { leagueId: spec.leagueId } : {}) };
    if (existsSync(path.join(TROPHIES, `${spec.key}.png`))) {
      entry.file = `trophies/${spec.key}.png`;
      entry.source = 'real';
    } else {
      const [p, a] = NEW_PALETTE[spec.leagueId] || ['#1b1b3a', '#c9a227'];
      await writeFile(path.join(TROPHIES, `${spec.key}.svg`), cupSvg(title, p, a));
      entry.file = `trophies/${spec.key}.svg`;
      entry.source = 'generated';
    }
    man.trophies.push(entry);
    console.log(`+   entrada nueva ${spec.key} ("${title}") -> ${entry.file}`);
  }
}

for (const [key, id] of Object.entries(TSDB_BY_KEY)) {
  const entry = man.trophies.find((t) => t.key === key);
  const url = cache[id]?.strTrophy;
  if (!entry || !url) { console.log(`--  ${key}: sin entrada o sin strTrophy en caché`); fail++; continue; }
  if (entry.source === 'real' && existsSync(path.join(TROPHIES, `${key}.png`))) { console.log(`=   ${key}: ya reemplazado, salto`); continue; }
  try {
    const buf = await download(url);
    if (!isPng(buf)) throw new Error('no es PNG (magic bytes)');
    const pngFile = `${key}.png`;
    await writeFile(path.join(TROPHIES, pngFile), buf);
    const svgPath = path.join(TROPHIES, `${key}.svg`);
    if (existsSync(svgPath)) await unlink(svgPath); // borrar solo tras verificar el PNG
    entry.file = `trophies/${pngFile}`;
    entry.source = 'real';
    ok++;
    console.log(`OK  ${key.padEnd(28)} <- ${cache[id].strLeague} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.log(`ERR ${key}: ${e.message} (queda el SVG)`);
    fail++;
  }
  await sleep(2000);
}

await writeFile(manPath, JSON.stringify(man, null, 2));
console.log(`\nReemplazados ${ok}, fallidos ${fail}. Manifiesto actualizado.`);
