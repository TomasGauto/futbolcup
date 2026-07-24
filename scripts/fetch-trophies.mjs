// Trofeos oficiales (TheSportsDB strTrophy) para las 12 ligas + copas UEFA, y SVG
// estilizado (sin emoji) para copas CONMEBOL/CONCACAF y copas nacionales.
// Mapea cada título del juego a una imagen para eliminar los emojis de las vitrinas.
//   node scripts/fetch-trophies.mjs
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const DATA = path.join(ROOT, 'public', 'data');
const TROPHIES = path.join(DATA, 'trophies');
const API = 'https://www.thesportsdb.com/api/v1/json/3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// leagueId -> [idLeague TheSportsDB, keyword de verificación]
const LEAGUE_TSDB = {
  ENG1: [4328, 'Premier'], ESP1: [4335, 'La Liga'], ITA1: [4332, 'Serie A'], GER1: [4331, 'Bundesliga'],
  FRA1: [4334, 'Ligue 1'], NED1: [4337, 'Eredivisie'], POR1: [4344, 'Primeira'], BRA1: [4351, 'Serie A'],
  ARG1: [4406, 'Primera'], USA1: [4346, 'Major League'], MEX1: [4350, 'Mexican'], COL1: [4497, 'Colombian'],
};
// copas continentales UEFA de CLUBES: título oficial -> [idLeague, keyword]
const UEFA_CUPS = {
  'UEFA Champions League': [4480, 'Champions'],
  'UEFA Europa League': [4481, 'Europa'],
  'UEFA Conference League': [5071, 'Conference'],
};
// paleta por liga (para SVG de copas nacionales, coloreadas por país)
const PALETTE = {
  ENG1: ['#37003c', '#e90052'], ESP1: ['#0b1f3a', '#e30613'], ITA1: ['#012169', '#00a0e0'],
  GER1: ['#111111', '#d20515'], FRA1: ['#091c3e', '#dbfa63'], NED1: ['#0a0a0a', '#ff6b00'],
  POR1: ['#0a5c36', '#d4213d'], BRA1: ['#0a7a3b', '#ffdf00'], ARG1: ['#0a3d7a', '#75aadb'],
  USA1: ['#0a1f44', '#c8102e'], MEX1: ['#006847', '#ce1126'], COL1: ['#0a3d91', '#fcd116'],
};
// copas continentales de CLUBES CONMEBOL/CONCACAF: título oficial -> acento (SVG estilizado)
const OTHER_CONT = {
  'Copa Libertadores': ['#0a2a1a', '#00a94f'],
  'Copa Sudamericana': ['#1a1030', '#ff7a00'],
  'Concacaf Champions Cup': ['#0a1f44', '#00b3e3'],
};
// copas continentales de SELECCIONES: título oficial -> acento (SVG estilizado)
const NATIONAL_CONT = {
  'Copa América': ['#0a1f3a', '#00a3e0'],
  'Eurocopa': ['#0a1630', '#2f6fd0'],
  'Copa Oro': ['#2a1f05', '#e8b23a'],
  'Copa Africana de Naciones': ['#0a2a14', '#00954a'],
  'Copa Asiática': ['#2a0a18', '#d81f4a'],
};

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// copa dorada estilizada con acento (para lo que no tiene imagen oficial)
function cupSvg(name, primary, accent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="200" height="240" role="img" aria-label="Trofeo ${esc(name)}">
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
  <text x="100" y="181" text-anchor="middle" font-family="Georgia,serif" font-size="10" font-weight="700" fill="#fff">${esc(name.toUpperCase().slice(0, 22))}</text>
  <path d="M76 60 Q80 92 100 116" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round"/>
</svg>`;
}

async function fetchTrophy(id, keyword) {
  for (let a = 0; ; a++) {
    const res = await fetch(`${API}/lookupleague.php?id=${id}`);
    const text = await res.text();
    if (res.status === 429 || text.includes('error code: 1015')) {
      if (a >= 5) return null;
      await sleep(Math.min(120000, 15000 * 2 ** a)); continue;
    }
    try {
      const l = (JSON.parse(text).leagues || [])[0];
      if (!l || !l.strTrophy) return null;
      if (keyword && !(l.strLeague || '').toLowerCase().includes(keyword.toLowerCase())) return null; // id equivocado
      return l.strTrophy;
    } catch { return null; }
  }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(TROPHIES, { recursive: true });
  const leagues = JSON.parse(await readFile(path.join(DATA, 'leagues.json'), 'utf8'));
  const nameById = Object.fromEntries(leagues.map((l) => [l.id, l.name]));
  const countryById = Object.fromEntries(leagues.map((l) => [l.id, l.country]));
  const trophies = [];
  let official = 0, styled = 0;

  // 1) Trofeos oficiales de las 12 ligas
  for (const [lid, [id, kw]] of Object.entries(LEAGUE_TSDB)) {
    const url = await fetchTrophy(id, kw);
    if (url) {
      const ext = (url.split('.').pop() || 'png').split(/[?#]/)[0].toLowerCase();
      const safe = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
      const file = `${lid}.${safe}`;
      await writeFile(path.join(TROPHIES, file), await download(url, file));
      trophies.push({ key: lid, kind: 'league', title: nameById[lid], leagueId: lid, file: `trophies/${file}`, source: 'real' });
      official++; console.log(`OK  liga ${lid} -> oficial`);
    } else { // fallback: mantené el SVG existente si lo hay
      const svg = `${lid}.svg`;
      if (existsSync(path.join(TROPHIES, svg))) trophies.push({ key: lid, kind: 'league', title: nameById[lid], leagueId: lid, file: `trophies/${svg}`, source: 'generated' });
      styled++; console.log(`--  liga ${lid} -> SVG (sin oficial)`);
    }
    await sleep(400);
  }

  // 2) Copas continentales UEFA: imagen oficial
  for (const [title, [id, kw]] of Object.entries(UEFA_CUPS)) {
    const url = await fetchTrophy(id, kw);
    const key = `cont-${title.replace(/[^a-zA-Z]/g, '')}`;
    if (url) {
      const ext = (url.split('.').pop() || 'png').split(/[?#]/)[0].toLowerCase();
      const safe = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
      const file = `${key}.${safe}`;
      await writeFile(path.join(TROPHIES, file), await download(url, file));
      trophies.push({ key, kind: 'continental', title, file: `trophies/${file}`, source: 'real' });
      official++; console.log(`OK  ${title} -> oficial`);
    } else {
      const file = `${key}.svg`;
      await writeFile(path.join(TROPHIES, file), cupSvg(title, '#1b1b3a', '#c9a227'));
      trophies.push({ key, kind: 'continental', title, file: `trophies/${file}`, source: 'generated' });
      styled++;
    }
    await sleep(400);
  }

  // 3) Copas continentales de clubes (CONMEBOL/CONCACAF) y de selecciones: SVG estilizado
  for (const [title, [p, a]] of [...Object.entries(OTHER_CONT), ...Object.entries(NATIONAL_CONT)]) {
    const key = `cont-${title.replace(/[^a-zA-Z]/g, '')}`;
    const file = `${key}.svg`;
    await writeFile(path.join(TROPHIES, file), cupSvg(title, p, a));
    trophies.push({ key, kind: 'continental', title, file: `trophies/${file}`, source: 'generated' });
    styled++;
  }

  // 4) Copas nacionales: SVG estilizado por país, título "Copa de {país}"
  for (const l of leagues.filter((x) => x.division === 1 || true)) {
    if (!PALETTE[l.id]) continue;
    const title = `Copa de ${l.country}`;
    const key = `copa-${l.id}`;
    const [p, a] = PALETTE[l.id];
    const file = `${key}.svg`;
    await writeFile(path.join(TROPHIES, file), cupSvg(title, p, a));
    trophies.push({ key, kind: 'national', title, leagueId: l.id, file: `trophies/${file}`, source: 'generated' });
    styled++;
  }

  // 5) Copa del Mundo (career mode): imagen oficial
  {
    const url = await fetchTrophy(4429, 'World Cup');
    if (url) {
      const ext = (url.split('.').pop() || 'png').split(/[?#]/)[0].toLowerCase();
      const safe = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png';
      const file = `cont-CopaDelMundo.${safe}`;
      await writeFile(path.join(TROPHIES, file), await download(url, file));
      trophies.push({ key: 'cont-mundial', kind: 'continental', title: 'Copa del Mundo', file: `trophies/${file}`, source: 'real' });
      official++; console.log('OK  Copa del Mundo -> oficial');
    } else {
      const file = 'cont-CopaDelMundo.svg';
      await writeFile(path.join(TROPHIES, file), cupSvg('Copa del Mundo', '#1a1a2e', '#d4af37'));
      trophies.push({ key: 'cont-mundial', kind: 'continental', title: 'Copa del Mundo', file: `trophies/${file}`, source: 'generated' });
      styled++;
    }
  }

  // manifiesto: fusioná conservando crests
  const manPath = path.join(DATA, 'assets-manifest.json');
  const man = existsSync(manPath) ? JSON.parse(await readFile(manPath, 'utf8')) : {};
  man.trophies = trophies;
  await writeFile(manPath, JSON.stringify(man, null, 2));
  console.log(`\nTrofeos: ${official} oficiales, ${styled} estilizados (SVG). Total ${trophies.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
