// Descarga escudos reales de clubes (TheSportsDB) + genera trofeos SVG por liga.
//   node scripts/assets.mjs            -> todo
//   node scripts/assets.mjs crests     -> solo escudos
//   node scripts/assets.mjs trophies   -> solo trofeos
//
// Salida:
//   public/data/crests/<clubId>.(png|svg)   escudo por club (real, o SVG de fallback)
//   public/data/trophies/<leagueId>.svg     trofeo estilizado por liga
//   public/data/assets-manifest.json        mapa club/liga -> archivo + fuente
//   .etl-cache/crest-lookup.json            caché de búsquedas (reintentos baratos)

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CRESTS = path.join(DATA, 'crests');
const TROPHIES = path.join(DATA, 'trophies');
const CACHE = path.join(ROOT, '.etl-cache', 'crest-lookup.json');
const API = 'https://www.thesportsdb.com/api/v1/json/3';

// país del dataset -> país en TheSportsDB (strings exactos verificados)
const COUNTRY = {
  Inglaterra: 'England', España: 'Spain', Italia: 'Italy', Alemania: 'Germany', Francia: 'France',
  Holanda: 'The Netherlands', Portugal: 'Portugal', Brasil: 'Brazil', Argentina: 'Argentina',
  'Estados Unidos': 'United States', México: 'Mexico', Colombia: 'Colombia',
  Perú: 'Peru', Uruguay: 'Uruguay', Chile: 'Chile', Bélgica: 'Belgium', Rusia: 'Russia',
  'Arabia Saudita': 'Saudi Arabia',
};
// paleta por liga: [primario, acento]
const PALETTE = {
  ENG1: ['#37003c', '#e90052'], // Premier
  ESP1: ['#0b1f3a', '#e30613'], // La Liga
  ITA1: ['#012169', '#00a0e0'], // Serie A
  GER1: ['#111111', '#d20515'], // Bundesliga
  FRA1: ['#091c3e', '#dbfa63'], // Ligue 1
  NED1: ['#0a0a0a', '#ff6b00'], // Eredivisie
  POR1: ['#0a5c36', '#d4213d'], // Primeira
  BRA1: ['#0a7a3b', '#ffdf00'], // Brasileirão
  ARG1: ['#0a3d7a', '#75aadb'], // Liga Profesional
  USA1: ['#0a1f44', '#c8102e'], // MLS
  MEX1: ['#006847', '#ce1126'], // Liga MX
  COL1: ['#0a3d91', '#fcd116'], // Primera A
  PER1: ['#7a0c1e', '#f2e6e8'], // Liga 1 (Perú)
  URU1: ['#0a2a5c', '#7ab8e6'], // Liga AUF Uruguaya
  CHI1: ['#0a2d6b', '#d52b1e'], // Primera de Chile
  BEL1: ['#111111', '#f0c419'], // Jupiler Pro League
  RUS1: ['#0a2a5c', '#d52b1e'], // Premier Liga Rusa
  SAU1: ['#0a5c36', '#e8d9a0'], // Liga Profesional Saudí
};
const LEAGUE_NAME = {
  ENG1: 'Premier League', ESP1: 'La Liga', ITA1: 'Serie A', GER1: 'Bundesliga', FRA1: 'Ligue 1',
  NED1: 'Eredivisie', POR1: 'Primeira Liga', BRA1: 'Brasileirão', ARG1: 'Liga Profesional',
  USA1: 'MLS', MEX1: 'Liga MX', COL1: 'Primera A',
  // keyword de matching contra strLeague de TheSportsDB (no nombre de display)
  PER1: 'Peruvian', URU1: 'Uruguayan', CHI1: 'Chilean', BEL1: 'Belgian', RUS1: 'Russian', SAU1: 'Saudi',
};

// Queries manuales por club: el nombre corto del dataset no matchea el nombre completo de la API.
// Se prueban ANTES que name/rawName. El filtro por país (COUNTRY) desambigua homónimos.
const ALIASES = {
  // Perú
  'PER1-Universitario': ['Universitario de Deportes'],
  'PER1-CsarVallejo': ['Universidad Cesar Vallejo', 'Cesar Vallejo'],
  'PER1-AlianzaAtltico': ['Alianza Atletico'],
  'PER1-AtlticoGrau': ['Atletico Grau'],
  'PER1-UTCCajamarca': ['UTC', 'Universidad Tecnica de Cajamarca'],
  'PER1-ADT': ['ADT', 'Asociacion Deportiva Tarma'],
  'PER1-Melgar': ['FBC Melgar', 'Melgar'],
  'PER1-CuscoFC': ['Cusco'],
  'PER1-AyacuchoFC': ['Ayacucho'],
  'PER1-JuanPabloII': ['Juan Pablo II College', 'Juan Pablo II'],
  // Uruguay
  'URU1-Pearol': ['Penarol', 'Peñarol'],
  'URU1-RiverPlateMontevideo': ['River Plate'],
  'URU1-LiverpooldeMontevideo': ['Liverpool Montevideo', 'Liverpool'],
  'URU1-RacingdeMontevideo': ['Racing Club de Montevideo', 'Racing Montevideo'],
  'URU1-Fnix': ['Fenix'],
  'URU1-Cerro': ['CA Cerro', 'Cerro'],
  'URU1-Progreso': ['CA Progreso', 'Progreso'],
  'URU1-JuventuddeLasPiedras': ['Juventud Las Piedras', 'Juventud'],
  // Chile
  'CHI1-ColoColo': ['Colo Colo', 'Colo-Colo'],
  'CHI1-EvertondeVia': ['Everton', 'Everton de Vina del Mar'],
  'CHI1-UniversidadCatlica': ['Universidad Catolica'],
  'CHI1-ublense': ['Nublense', 'Ñublense'],
  'CHI1-UninLaCalera': ['Union La Calera'],
  'CHI1-UninEspaola': ['Union Espanola'],
  'CHI1-OHiggins': ["O'Higgins", 'OHiggins'],
  'CHI1-DeportesLaSerena': ['Deportes La Serena', 'La Serena'],
  // Bélgica
  'BEL1-StGilloise': ['Union Saint-Gilloise', 'Royale Union Saint-Gilloise'],
  'BEL1-StTruiden': ['Sint-Truiden', 'Sint-Truidense VV'],
  'BEL1-Standard': ['Standard Liege'],
  'BEL1-Waregem': ['Zulte Waregem', 'Zulte-Waregem'],
  'BEL1-Bergen': ['RAEC Mons', 'Mons'],
  'BEL1-Germinal': ['Germinal Beerschot'],
  'BEL1-BeerschotVA': ['Beerschot', 'Beerschot VA'],
  'BEL1-Molenbeek': ['RWD Molenbeek', 'RWDM'],
  'BEL1-RWDMolenbeek': ['RWD Molenbeek', 'RWDM'],
  'BEL1-MouscronPeruwelz': ['Mouscron-Peruwelz', 'Royal Mouscron'],
  'BEL1-Mouscron': ['Excelsior Mouscron', 'Mouscron'],
  'BEL1-Louvieroise': ['RAA Louvieroise', 'La Louviere'],
  'BEL1-RAALLaLouviere': ['RAAL La Louviere', 'La Louviere'],
  'BEL1-Lierse': ['Lierse SK', 'Lierse Kempenzonen'],
  'BEL1-Harelbeke': ['KRC Harelbeke'],
  'BEL1-Aalst': ['Eendracht Aalst'],
  'BEL1-Geel': ['Verbroedering Geel'],
  'BEL1-HeusdenZolder': ['Heusden-Zolder'],
  'BEL1-Lommel': ['Lommel SK', 'Lommel United'],
  'BEL1-OudHeverleeLeuven': ['OH Leuven', 'Oud-Heverlee Leuven'],
  'BEL1-Dender': ['Dender EH', 'FCV Dender EH'],
  'BEL1-Tubize': ['AFC Tubize'],
  'BEL1-Seraing': ['RFC Seraing', 'Seraing United'],
  'BEL1-Beveren': ['SK Beveren', 'KSK Beveren'],
  'BEL1-WaaslandBeveren': ['Waasland-Beveren'],
  'BEL1-Lokeren': ['Sporting Lokeren', 'KSC Lokeren'],
  'BEL1-Roeselare': ['KSV Roeselare'],
  'BEL1-Kortrijk': ['KV Kortrijk'],
  'BEL1-Mechelen': ['KV Mechelen'],
  'BEL1-Oostende': ['KV Oostende'],
  'BEL1-Eupen': ['KAS Eupen', 'Eupen'],
  'BEL1-Charleroi': ['Sporting Charleroi', 'Charleroi'],
  'BEL1-Genk': ['KRC Genk', 'Genk'],
  'BEL1-Gent': ['KAA Gent', 'Gent'],
  'BEL1-Antwerp': ['Royal Antwerp'],
  'BEL1-Westerlo': ['KVC Westerlo', 'Westerlo'],
  // Rusia
  'RUS1-MSaransk': ['Mordovia Saransk'],
  'RUS1-RVolgograd': ['Rotor Volgograd'],
  'RUS1-VolgarAstrakhan': ['Volgar Astrakhan'],
  'RUS1-Vladikavkaz': ['Alania Vladikavkaz'],
  'RUS1-PariNN': ['Pari Nizhny Novgorod', 'Nizhny Novgorod'],
  'RUS1-KrylyaSovetov': ['Krylya Sovetov Samara', 'Krylia Sovetov'],
  'RUS1-Baltika': ['Baltika Kaliningrad'],
  'RUS1-Ufa': ['FC Ufa', 'Ufa'],
  'RUS1-Sochi': ['PFC Sochi', 'Sochi'],
  'RUS1-Khimki': ['FC Khimki', 'Khimki'],
  'RUS1-Tomsk': ['Tom Tomsk'],
  'RUS1-Tosno': ['FC Tosno', 'Tosno'],
  'RUS1-Tambov': ['FC Tambov', 'Tambov'],
  'RUS1-Yenisey': ['Yenisey Krasnoyarsk', 'Enisey Krasnoyarsk'],
  'RUS1-Kuban': ['Kuban Krasnodar'],
  'RUS1-Amkar': ['Amkar Perm'],
  'RUS1-Ural': ['Ural Yekaterinburg', 'Ural Ekaterinburg'],
  'RUS1-Orenburg': ['FC Orenburg', 'Orenburg'],
  'RUS1-FKAnziMakhackala': ['Anzhi Makhachkala', 'Anji Makhachkala'],
  'RUS1-VolgaNNovgorod': ['Volga Nizhny Novgorod'],
  'RUS1-AkronTogliatti': ['Akron Togliatti', 'Akron Tolyatti'],
  'RUS1-SKAKhabarovsk': ['SKA-Khabarovsk', 'SKA Khabarovsk'],
  // Arabia Saudita
  'SAU1-AlIttihad': ['Al-Ittihad Jeddah', 'Al-Ittihad'],
  'SAU1-AlAhli': ['Al-Ahli Saudi', 'Al-Ahli Jeddah', 'Al-Ahli'],
  'SAU1-AlHilal': ['Al-Hilal Saudi', 'Al-Hilal'],
  'SAU1-AlShabab': ['Al-Shabab Riyadh', 'Al-Shabab'],
  'SAU1-AlWehda': ['Al-Wehda Mecca', 'Al-Wehda'],
};

// Color dominante de camiseta/escudo para el tema de la carrera. Se guarda en
// el manifiesto junto al archivo del escudo para que el runtime no tenga que
// inferir colores ni cargar imágenes para muestrearlas.
const CLUB_COLOR_RULES = [
  [/arsenal|liverpool|manchester united|everton|red bull/, '#d71920', '#10151d'],
  [/manchester city|brighton|chelsea|tottenham|inter de milan|inter milan/, '#6cabdd', '#10264a'],
  [/real madrid|juventus|corinthians|santos|real sociedad/, '#c7d0dc', '#111827'],
  [/barcelona/, '#a50044', '#004d98'],
  [/atletico de madrid|bayern|benfica|flamengo|independiente|america de cali/, '#d00027', '#10151d'],
  [/borussia dortmund|boca juniors|club america|tigres uanl/, '#f5c400', '#111827'],
  [/ac milan|milan|roma|river plate|chivas|guadalajara|fluminense/, '#b91c35', '#10151d'],
  [/paris saint|psg|new york city|monterrey|sao paulo/, '#123b75', '#ef3340'],
  [/olympique de marsella|marseille|celta|racing club|racing santander/, '#6bb6e8', '#0d2a55'],
  [/ajax|feyenoord|sporting braga|sporting cp/, '#e30613', '#111827'],
  [/fc porto|porto|schalke|rangers/, '#0057b8', '#ffffff'],
  [/palmeiras|sporting/, '#006b3c', '#ffffff'],
  [/gremio|seattle sounders|san lorenzo|newells/, '#1d4f91', '#111827'],
  [/real betis|st pauli|green|celtic/, '#009b62', '#111827'],
  [/lens|lille|santa fe|millonarios/, '#e30613', '#143d8d'],
];

function clubThemeColors(club) {
  const name = String(club?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const hit = CLUB_COLOR_RULES.find(([test]) => test.test(name));
  if (hit) return { primary: hit[1], secondary: hit[2] };
  const [primary, secondary] = PALETTE[club?.leagueId] || ['#334155', '#94a3b8'];
  return { primary, secondary };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REQ_DELAY = 2200; // ms entre búsquedas (Cloudflare tira 1015 con ritmos más agresivos)

function initials(name) {
  const stop = new Set(['fc', 'cf', 'ac', 'as', 'sc', 'ss', 'us', 'if', 'de', 'el', 'la', 'le', 'club', 'calcio', 'united', 'city', 'real']);
  const words = name.replace(/[.\-']/g, ' ').split(/\s+/).filter(Boolean);
  const sig = words.filter((w) => !stop.has(w.toLowerCase()));
  const pool = sig.length ? sig : words;
  if (pool.length === 1) return pool[0].slice(0, 3).toUpperCase();
  return pool.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}

// escudo de fallback: escudo con degradé de liga + iniciales
function crestSvg(club) {
  const [p, a] = PALETTE[club.leagueId] || ['#1f2937', '#9ca3af'];
  const txt = initials(club.name);
  const fs = txt.length >= 3 ? 40 : 52;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="128" height="148" role="img" aria-label="${esc(club.name)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${p}"/></linearGradient></defs>
  <path d="M64 4 118 22 118 78 Q118 122 64 144 Q10 122 10 78 L10 22 Z" fill="url(#g)" stroke="#ffffff" stroke-width="4"/>
  <path d="M64 4 118 22 118 78 Q118 122 64 144 Q10 122 10 78 L10 22 Z" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
  <text x="64" y="82" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="${fs}" fill="#ffffff" style="letter-spacing:1px">${esc(txt)}</text>
</svg>`;
}

// trofeo estilizado por liga
function trophySvg(leagueId) {
  const [p, a] = PALETTE[leagueId] || ['#1f2937', '#9ca3af'];
  const name = LEAGUE_NAME[leagueId] || leagueId;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="200" height="240" role="img" aria-label="Trofeo ${esc(name)}">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#e8b23a"/><stop offset="1" stop-color="#9a6b12"/>
    </linearGradient>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${p}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="200" height="240" rx="16" fill="${p}"/>
  <circle cx="100" cy="96" r="78" fill="rgba(255,255,255,.05)"/>
  <!-- asas -->
  <path d="M56 54 Q26 62 40 104 Q46 122 66 118" fill="none" stroke="url(#gold)" stroke-width="9" stroke-linecap="round"/>
  <path d="M144 54 Q174 62 160 104 Q154 122 134 118" fill="none" stroke="url(#gold)" stroke-width="9" stroke-linecap="round"/>
  <!-- copa -->
  <path d="M58 48 H142 V70 Q142 116 100 132 Q58 116 58 70 Z" fill="url(#gold)" stroke="#7a5310" stroke-width="2"/>
  <ellipse cx="100" cy="49" rx="42" ry="7" fill="#fff3c4" stroke="#7a5310" stroke-width="1.5"/>
  <!-- cuello y pie -->
  <rect x="92" y="132" width="16" height="20" fill="url(#gold)"/>
  <path d="M74 152 H126 L132 168 H68 Z" fill="url(#gold)" stroke="#7a5310" stroke-width="1.5"/>
  <rect x="62" y="168" width="76" height="18" rx="4" fill="url(#base)" stroke="#00000030" stroke-width="1"/>
  <text x="100" y="182" text-anchor="middle" font-family="Georgia,serif" font-size="11" font-weight="700" fill="#fff">${esc(name.toUpperCase())}</text>
  <!-- brillo -->
  <path d="M76 60 Q80 92 100 116" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function loadCache() {
  try { return JSON.parse(await readFile(CACHE, 'utf8')); } catch { return {}; }
}

class RateLimited extends Error {}

// una sola llamada de búsqueda; lanza RateLimited si Cloudflare bloquea (1015/429/no-JSON)
async function searchOnce(q) {
  const res = await fetch(`${API}/searchteams.php?t=${encodeURIComponent(q)}`);
  const text = await res.text();
  if (res.status === 429 || res.status === 403 || text.includes('error code: 1015') || text.trim().startsWith('<')) {
    throw new RateLimited('rate limit');
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new RateLimited('non-json'); }
  return (json.teams || []).filter((t) => t.strSport === 'Soccer');
}

// Devuelve: {url,matched,league} si hay badge | false si se buscó y no existe | lanza RateLimited.
// Cachea SOLO resultados definitivos (objeto o false); nunca cachea rate-limits.
async function lookupBadge(club, cache) {
  const cached = cache[club.id];
  if (cached !== undefined && cached !== null) return cached; // null viejo => reintentar
  const wantCountry = COUNTRY[club.country];
  const queries = [...new Set([...(ALIASES[club.id] || []), club.name, club.rawName])].filter(Boolean);
  let anySearched = false;
  for (const q of queries) {
    const teams = await searchOnce(q); // puede lanzar RateLimited -> lo maneja el caller
    anySearched = true;
    await sleep(REQ_DELAY);
    if (!teams.length) continue;
    const inCountry = teams.filter((t) => t.strCountry === wantCountry);
    const topLeague = inCountry.find((t) => (t.strLeague || '').toLowerCase().includes(LEAGUE_NAME[club.leagueId].toLowerCase()));
    const pick = topLeague || inCountry[0] || null;
    if (pick) {
      const badge = pick.strBadge || pick.strTeamBadge || null;
      const result = badge ? { url: badge, matched: pick.strTeam, league: pick.strLeague } : false;
      cache[club.id] = result;
      return result;
    }
  }
  if (anySearched) { cache[club.id] = false; return false; } // buscado, homónimo/ausente -> fallback
  throw new RateLimited('no query resolved');
}

async function downloadCrests() {
  await mkdir(CRESTS, { recursive: true });
  const clubs = JSON.parse(await readFile(path.join(DATA, 'clubs.json'), 'utf8'));
  const cache = await loadCache();
  // incremental: saltear clubes que ya tienen un archivo de escudo en disco
  const existing = new Set((await readdir(CRESTS)).map((f) => f.replace(/\.[^.]+$/, '')));
  const manifest = [];
  let real = 0, fallback = 0, i = 0, skipped = 0;
  for (const club of clubs) {
    i++;
    if (existing.has(club.id)) { skipped++; continue; } // ya descargado en corridas previas

    // lookup con backoff exponencial ante rate-limit de Cloudflare
    let found = null;
    for (let attempt = 0; ; attempt++) {
      try { found = await lookupBadge(club, cache); break; }
      catch (e) {
        if (!(e instanceof RateLimited) || attempt >= 6) { found = false; break; }
        const wait = Math.min(120000, 15000 * 2 ** attempt); // 15s,30s,60s,120s...
        process.stdout.write(`\r rate-limit en ${club.id}: espero ${wait / 1000}s (intento ${attempt + 1})   `);
        await writeFile(CACHE, JSON.stringify(cache, null, 0));
        await sleep(wait);
      }
    }
    if (i % 5 === 0) await writeFile(CACHE, JSON.stringify(cache, null, 0)); // persistí caché periódicamente
    if (found && found.url) {
      try {
        const res = await fetch(found.url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        const ext = (found.url.split('.').pop() || 'png').split(/[?#]/)[0].toLowerCase();
        const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? ext : 'png';
        const file = `${club.id}.${safeExt}`;
        await writeFile(path.join(CRESTS, file), buf);
        manifest.push({ id: club.id, name: club.name, leagueId: club.leagueId, division: club.division, file: `crests/${file}`, source: 'real', matched: found.matched, ...clubThemeColors(club) });
        real++;
        process.stdout.write(`\r[${i}/${clubs.length}] real:${real} svg:${fallback}   `);
        await sleep(250);
        continue;
      } catch { /* cae al fallback */ }
    }
    const file = `${club.id}.svg`;
    await writeFile(path.join(CRESTS, file), crestSvg(club));
    manifest.push({ id: club.id, name: club.name, leagueId: club.leagueId, division: club.division, file: `crests/${file}`, source: 'generated', ...clubThemeColors(club) });
    fallback++;
    process.stdout.write(`\r[${i}/${clubs.length}] real:${real} svg:${fallback}   `);
  }
  await writeFile(CACHE, JSON.stringify(cache, null, 0));
  console.log(`\nEscudos: ${real} reales nuevos, ${fallback} generados (SVG), ${skipped} ya existentes, total ${clubs.length}.`);
  return manifest;
}

async function buildTrophies() {
  await mkdir(TROPHIES, { recursive: true });
  const leagues = JSON.parse(await readFile(path.join(DATA, 'leagues.json'), 'utf8'));
  const out = [];
  for (const lg of leagues) {
    const file = `${lg.id}.svg`;
    await writeFile(path.join(TROPHIES, file), trophySvg(lg.id));
    out.push({ leagueId: lg.id, name: lg.name, file: `trophies/${file}`, source: 'generated' });
  }
  console.log(`Trofeos: ${out.length} SVG generados.`);
  return out;
}

async function main() {
  const mode = process.argv[2] || 'all';
  if (mode === 'colors') {
    const manPath = path.join(DATA, 'assets-manifest.json');
    const clubs = JSON.parse(await readFile(path.join(DATA, 'clubs.json'), 'utf8'));
    const byId = new Map(clubs.map((club) => [club.id, club]));
    const manifest = JSON.parse(await readFile(manPath, 'utf8'));
    manifest.crests = (manifest.crests || []).map((crest) => ({
      ...crest,
      ...clubThemeColors(byId.get(crest.id) || crest),
    }));
    manifest.generatedAt = new Date().toISOString();
    await writeFile(manPath, JSON.stringify(manifest, null, 2));
    console.log(`Colores de clubes agregados al manifiesto: ${manifest.crests.length}.`);
    return;
  }
  const manifest = {};
  if (mode === 'all' || mode === 'crests') manifest.crests = await downloadCrests();
  if (mode === 'all' || mode === 'trophies') manifest.trophies = await buildTrophies();
  // fusioná con manifiesto previo si sólo corriste una parte
  const manPath = path.join(DATA, 'assets-manifest.json');
  let prev = {};
  if (existsSync(manPath)) { try { prev = JSON.parse(await readFile(manPath, 'utf8')); } catch {} }
  const merged = { ...prev, ...manifest, generatedAt: new Date().toISOString() };
  await writeFile(manPath, JSON.stringify(merged, null, 2));
  console.log(`Manifiesto: public/data/assets-manifest.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
