// ETL Dinastía FC — se corre OFFLINE una sola vez: descarga football-datasets,
// calcula Elo histórico, ratings ataque/defensa, estilo y palmarés, y emite
// /public/data/*.json. La app en runtime NO hace llamadas de red.
//
// Uso: npm run etl

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data');
const CACHE = join(ROOT, '.etl-cache');

// Adapter de origen de datos:
//   datasets-gh  → repo GitHub datasets/football-datasets (per-temporada, con stats) — big-5
//   fd-main      → football-data.co.uk /mmz4281/{cod}/{DIV}.csv (per-temporada, con stats)
//   fd-new       → football-data.co.uk /new/{PAÍS}.csv (archivo único, solo goles)
//   static-file  → CSV commiteado en scripts/data-manual/{sourceKey}.csv (formato fd-new)
type SourceKind = 'datasets-gh' | 'fd-main' | 'fd-new' | 'static-file';
type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF';

type SourceLeague = {
  id: string;
  name: string;
  country: string;
  slug: string; // carpeta/clave de caché
  source?: SourceKind; // default: datasets-gh
  sourceKey?: string; // div (N1/P1) para fd-main; país (BRA/ARG) para fd-new; archivo para static-file
  leagueFilter?: string; // fd-new/static-file: valor de la columna "League" que corresponde a 1ª división
  confederation?: Confederation; // default: UEFA
  teams: number;
  relegations: number;
  tvBase: number; // millones para el 1º de la liga
  slots: { elite: number; second: number; third: number };
  coeff: number;
};

// sources.config.json permite agregar ligas sin tocar este código.
const DEFAULT_SOURCES: SourceLeague[] = [
  { id: 'ENG1', name: 'Premier League', country: 'Inglaterra', slug: 'premier-league', source: 'datasets-gh', confederation: 'UEFA', teams: 20, relegations: 3, tvBase: 175, slots: { elite: 4, second: 2, third: 1 }, coeff: 95 },
  { id: 'ESP1', name: 'La Liga', country: 'España', slug: 'la-liga', source: 'datasets-gh', confederation: 'UEFA', teams: 20, relegations: 3, tvBase: 120, slots: { elite: 4, second: 2, third: 1 }, coeff: 88 },
  { id: 'ITA1', name: 'Serie A', country: 'Italia', slug: 'serie-a', source: 'datasets-gh', confederation: 'UEFA', teams: 20, relegations: 3, tvBase: 100, slots: { elite: 4, second: 2, third: 1 }, coeff: 85 },
  { id: 'GER1', name: 'Bundesliga', country: 'Alemania', slug: 'bundesliga', source: 'datasets-gh', confederation: 'UEFA', teams: 18, relegations: 2, tvBase: 105, slots: { elite: 4, second: 2, third: 1 }, coeff: 84 },
  { id: 'FRA1', name: 'Ligue 1', country: 'Francia', slug: 'ligue-1', source: 'datasets-gh', confederation: 'UEFA', teams: 18, relegations: 3, tvBase: 80, slots: { elite: 3, second: 2, third: 1 }, coeff: 70 },
];

function loadSources(): SourceLeague[] {
  const p = join(ROOT, 'scripts', 'sources.config.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  return DEFAULT_SOURCES;
}

// Alias editables: nombre crudo del CSV → nombre para mostrar.
const ALIASES: Record<string, string> = {
  'Man United': 'Manchester United', 'Man City': 'Manchester City', "Nott'm Forest": 'Nottingham Forest',
  'Sheffield United': 'Sheffield United', 'Sheffield Weds': 'Sheffield Wednesday', 'QPR': 'Queens Park Rangers',
  'Wolves': 'Wolverhampton', 'Spurs': 'Tottenham', 'Newcastle': 'Newcastle United', 'West Ham': 'West Ham United',
  'West Brom': 'West Bromwich', 'Leeds': 'Leeds United', 'Leicester': 'Leicester City', 'Norwich': 'Norwich City',
  'Ipswich': 'Ipswich Town', 'Luton': 'Luton Town', 'Coventry': 'Coventry City', 'Derby': 'Derby County',
  'Ath Madrid': 'Atlético de Madrid', 'Ath Bilbao': 'Athletic Club', 'Espanol': 'Espanyol', 'Sociedad': 'Real Sociedad',
  'Vallecano': 'Rayo Vallecano', 'Betis': 'Real Betis', 'Celta': 'Celta de Vigo', 'La Coruna': 'Deportivo La Coruña',
  'Alaves': 'Alavés', 'Cadiz': 'Cádiz', 'Almeria': 'Almería', 'Leganes': 'Leganés', 'Sp Gijon': 'Sporting Gijón',
  'Vald': 'Valladolid', 'Valladolid': 'Real Valladolid', 'Hercules': 'Hércules', 'Malaga': 'Málaga', 'Merida': 'Mérida',
  'Logrones': 'Logroñés', 'Santander': 'Racing Santander', 'Gimnastic': 'Gimnàstic', 'Cordoba': 'Córdoba',
  'M\'gladbach': 'Borussia Mönchengladbach', 'Dortmund': 'Borussia Dortmund', 'Leverkusen': 'Bayer Leverkusen',
  'Bayern Munich': 'Bayern Múnich', 'Ein Frankfurt': 'Eintracht Frankfurt', 'Hertha': 'Hertha Berlín',
  'Hamburg': 'Hamburgo', 'FC Koln': 'Colonia', 'Nurnberg': 'Núremberg', 'Hansa Rostock': 'Hansa Rostock',
  'Greuther Furth': 'Greuther Fürth', 'Fortuna Dusseldorf': 'Fortuna Düsseldorf', 'St Pauli': 'St. Pauli',
  'Munich 1860': '1860 Múnich', 'Kaiserslautern': 'Kaiserslautern', 'RB Leipzig': 'RB Leipzig',
  'Paris SG': 'Paris Saint-Germain', 'Marseille': 'Olympique de Marsella', 'Lyon': 'Olympique de Lyon',
  'St Etienne': 'Saint-Étienne', 'Etienne': 'Saint-Étienne', 'Clermont': 'Clermont Foot',
  'Milan': 'AC Milan', 'Inter': 'Inter de Milán', 'Juventus': 'Juventus', 'Roma': 'AS Roma', 'Lazio': 'Lazio',
  'Napoli': 'Napoli', 'Verona': 'Hellas Verona', 'Chievo': 'Chievo Verona', 'Spal': 'SPAL',
  // Holanda (Eredivisie)
  'PSV Eindhoven': 'PSV', 'Ajax': 'Ajax', 'Feyenoord': 'Feyenoord', 'Twente': 'FC Twente',
  'AZ Alkmaar': 'AZ', 'Vitesse': 'Vitesse', 'Utrecht': 'FC Utrecht', 'Heerenveen': 'Heerenveen',
  'Groningen': 'FC Groningen', 'For Sittard': 'Fortuna Sittard', 'Den Haag': 'ADO Den Haag',
  'Nijmegen': 'NEC Nijmegen', 'Roda': 'Roda JC', 'Waalwijk': 'RKC Waalwijk', 'Willem II': 'Willem II',
  'Sparta Rotterdam': 'Sparta Rotterdam', 'Heracles': 'Heracles Almelo', 'Zwolle': 'PEC Zwolle',
  'Cambuur': 'SC Cambuur', 'Go Ahead Eagles': 'Go Ahead Eagles', 'Emmen': 'FC Emmen', 'Volendam': 'FC Volendam',
  // Portugal (Primeira Liga)
  'Sp Lisbon': 'Sporting CP', 'Benfica': 'Benfica', 'Porto': 'FC Porto', 'Sp Braga': 'Sporting Braga',
  'Guimaraes': 'Vitória Guimarães', 'Boavista': 'Boavista', 'Maritimo': 'Marítimo', 'Vitoria': 'Vitória Setúbal',
  'Belenenses': 'Belenenses', 'Nacional': 'Nacional', 'Pacos Ferreira': 'Paços de Ferreira', 'Rio Ave': 'Rio Ave',
  'Gil Vicente': 'Gil Vicente', 'Estoril': 'Estoril', 'Moreirense': 'Moreirense', 'Famalicao': 'Famalicão',
  'Farense': 'Farense', 'Arouca': 'Arouca', 'Chaves': 'Chaves', 'Tondela': 'Tondela', 'Portimonense': 'Portimonense',
};

type RawMatch = {
  season: string; // '9394'
  home: string; away: string; hg: number; ag: number;
  hs: number; as_: number; hst: number; ast: number;
  hf: number; af: number; hc: number; ac: number; hy: number; ay: number; hr: number; ar: number;
};

function seasonCodes(): string[] {
  const codes: string[] = [];
  for (let y = 1993; y <= 2025; y++) {
    const a = String(y % 100).padStart(2, '0');
    const b = String((y + 1) % 100).padStart(2, '0');
    codes.push(a + b);
  }
  return codes;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

// URL per-temporada según el adapter (solo datasets-gh y fd-main son per-temporada).
function seasonUrl(src: SourceLeague, code: string): string | null {
  const kind = src.source ?? 'datasets-gh';
  if (kind === 'datasets-gh') {
    return `https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/${src.slug}/season-${code}.csv`;
  }
  if (kind === 'fd-main') {
    return `https://www.football-data.co.uk/mmz4281/${code}/${src.sourceKey}.csv`;
  }
  return null; // fd-new / static-file: no son per-temporada (ver loadNewLeagueMatches)
}

async function fetchSeason(src: SourceLeague, code: string): Promise<string | null> {
  const cacheFile = join(CACHE, `${src.slug}-${code}.csv`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  const url = seasonUrl(src, code);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cacheFile, text);
    return text;
  } catch {
    return null;
  }
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadLeagueMatches(src: SourceLeague, report: string[]): Promise<Map<string, RawMatch[]>> {
  const bySeason = new Map<string, RawMatch[]>();
  const codes = seasonCodes();
  const CONC = 8;
  for (let i = 0; i < codes.length; i += CONC) {
    const batch = codes.slice(i, i + CONC);
    const texts = await Promise.all(batch.map((c) => fetchSeason(src, c)));
    batch.forEach((code, j) => {
      const text = texts[j];
      if (!text) { report.push(`[${src.slug}] season-${code}: no disponible`); return; }
      const rows = parseCsv(text);
      const header = rows[0].map((h) => h.trim());
      const idx = (name: string) => header.indexOf(name);
      const iDiv = idx('Div'); // fd-main trae columna Div (P1/SP1/…); guardá contra contaminación por redirect
      const matches: RawMatch[] = [];
      for (const r of rows.slice(1)) {
        // rechazá filas de otra división/país (un 301 puede servir el CSV equivocado)
        if (src.sourceKey && iDiv >= 0 && (r[iDiv] ?? '').trim() !== src.sourceKey) continue;
        const home = r[idx('HomeTeam')]?.trim();
        const away = r[idx('AwayTeam')]?.trim();
        if (!home || !away) continue;
        matches.push({
          season: code, home, away,
          hg: num(r[idx('FTHG')]), ag: num(r[idx('FTAG')]),
          hs: num(r[idx('HS')]), as_: num(r[idx('AS')]), hst: num(r[idx('HST')]), ast: num(r[idx('AST')]),
          hf: num(r[idx('HF')]), af: num(r[idx('AF')]), hc: num(r[idx('HC')]), ac: num(r[idx('AC')]),
          hy: num(r[idx('HY')]), ay: num(r[idx('AY')]), hr: num(r[idx('HR')]), ar: num(r[idx('AR')]),
        });
      }
      if (matches.length < 100) report.push(`[${src.slug}] season-${code}: solo ${matches.length} partidos (posible incompleta)`);
      bySeason.set(code, matches);
    });
  }
  return bySeason;
}

// ------------------------------ Adapter "new leagues" (archivo único, solo goles) ------------------------------

// "2012/2013" | "2014" → código de 2 dígitos del año de inicio ('12','14') compatible con seasonOrder.
function newSeasonCode(seasonStr: string): string {
  return seasonStr.trim().slice(0, 4).slice(2);
}

async function fetchNewLeagueFile(src: SourceLeague): Promise<string | null> {
  if (src.source === 'static-file') { // CSV commiteado (Colombia), sin caché de red
    const p = join(ROOT, 'scripts', 'data-manual', `${src.sourceKey}.csv`);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  }
  const cacheFile = join(CACHE, `new-${src.sourceKey}.csv`);
  if (existsSync(cacheFile)) return readFileSync(cacheFile, 'utf8');
  const url = `https://www.football-data.co.uk/new/${src.sourceKey}.csv`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cacheFile, text);
    return text;
  } catch {
    return null;
  }
}

async function loadNewLeagueMatches(src: SourceLeague, report: string[]): Promise<Map<string, RawMatch[]>> {
  const text = await fetchNewLeagueFile(src);
  const bySeason = new Map<string, RawMatch[]>();
  if (!text) { report.push(`[${src.slug}] archivo new/${src.sourceKey}.csv no disponible`); return bySeason; }
  const rows = parseCsv(text);
  const header = rows[0].map((h) => h.trim().replace(/^﻿/, ''));
  const idx = (name: string) => header.indexOf(name);
  const iL = idx('League'), iS = idx('Season'), iH = idx('Home'), iA = idx('Away'), iHG = idx('HG'), iAG = idx('AG');
  const wanted = (src.leagueFilter ?? '').trim().toLowerCase();
  for (const r of rows.slice(1)) {
    if (iL >= 0 && wanted && (r[iL] ?? '').trim().toLowerCase() !== wanted) continue;
    const home = r[iH]?.trim(); const away = r[iA]?.trim();
    if (!home || !away) continue;
    if ((r[iHG] ?? '') === '' || (r[iAG] ?? '') === '') continue; // partido futuro / sin resultado
    const code = newSeasonCode(r[iS] ?? '');
    if (!code) continue;
    if (!bySeason.has(code)) bySeason.set(code, []);
    bySeason.get(code)!.push({
      season: code, home, away, hg: num(r[iHG]), ag: num(r[iAG]),
      hs: 0, as_: 0, hst: 0, ast: 0, hf: 0, af: 0, hc: 0, ac: 0, hy: 0, ay: 0, hr: 0, ar: 0,
    });
  }
  // descartar temporadas incompletas (en curso): que no se tome una temporada a medias como "actual"
  for (const [code, ms] of [...bySeason]) {
    if (ms.length < 60) { report.push(`[${src.slug}] temporada ${code}: ${ms.length} partidos → descartada (incompleta)`); bySeason.delete(code); }
  }
  return bySeason;
}

// ------------------------------ Elo ------------------------------

function computeHomeAdv(matches: RawMatch[]): number {
  let s = 0;
  for (const m of matches) s += m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0;
  const e = s / matches.length;
  const clamped = Math.min(0.72, Math.max(0.52, e));
  return Math.round(-400 * Math.log10(1 / clamped - 1)); // E=0.57 → ~49, E=0.62 → ~85
}

function runElo(bySeason: Map<string, RawMatch[]>, homeAdv: number) {
  const elo = new Map<string, number>();
  const lastSeen = new Map<string, string>();
  const get = (t: string) => elo.get(t) ?? 1500;
  const codes = [...bySeason.keys()].sort((a, b) => seasonOrder(a) - seasonOrder(b));
  for (const code of codes) {
    const seasonTeams = new Set<string>();
    for (const m of bySeason.get(code)!) {
      seasonTeams.add(m.home); seasonTeams.add(m.away);
      const eh = get(m.home); const ea = get(m.away);
      const expH = 1 / (1 + Math.pow(10, (ea - eh - homeAdv) / 400));
      const sH = m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0;
      const k = 20 * (1 + 0.5 * Math.abs(m.hg - m.ag));
      elo.set(m.home, eh + k * (sH - expH));
      elo.set(m.away, ea + k * ((1 - sH) - (1 - expH)));
      lastSeen.set(m.home, code); lastSeen.set(m.away, code);
    }
    // regresión a la media 15% al cierre de temporada
    const teams = [...seasonTeams];
    const mean = teams.reduce((a, t) => a + get(t), 0) / teams.length;
    for (const t of teams) elo.set(t, get(t) + 0.15 * (mean - get(t)));
  }
  return { elo, lastSeen };
}

function seasonOrder(code: string): number {
  const y = Number(code.slice(0, 2));
  return y >= 90 ? 1900 + y : 2000 + y;
}

// ------------------------------ Tablas históricas / palmarés ------------------------------

type TableRow = { team: string; pts: number; gf: number; ga: number; w: number; d: number; l: number };

function seasonTable(matches: RawMatch[]): TableRow[] {
  const rows = new Map<string, TableRow>();
  const get = (t: string) => {
    if (!rows.has(t)) rows.set(t, { team: t, pts: 0, gf: 0, ga: 0, w: 0, d: 0, l: 0 });
    return rows.get(t)!;
  };
  for (const m of matches) {
    const h = get(m.home); const a = get(m.away);
    h.gf += m.hg; h.ga += m.ag; a.gf += m.ag; a.ga += m.hg;
    if (m.hg > m.ag) { h.pts += 3; h.w++; a.l++; }
    else if (m.hg < m.ag) { a.pts += 3; a.w++; h.l++; }
    else { h.pts++; a.pts++; h.d++; a.d++; }
  }
  return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

// ------------------------------ Main ------------------------------

async function main() {
  const t0 = Date.now();
  const report: string[] = [];
  const sources = loadSources();
  mkdirSync(OUT, { recursive: true });

  const clubsOut: unknown[] = [];
  const leaguesOut: unknown[] = [];
  const historyOut: Record<string, { season: string; champion: string; runnerUp: string }[]> = {};

  for (const src of sources) {
    console.log(`Descargando ${src.name}...`);
    const kind = src.source ?? 'datasets-gh';
    const bySeason = (kind === 'fd-new' || kind === 'static-file')
      ? await loadNewLeagueMatches(src, report)
      : await loadLeagueMatches(src, report);
    const all = [...bySeason.values()].flat();
    if (all.length === 0) {
      report.push(`[${src.slug}] SIN DATOS — liga omitida`);
      continue;
    }
    const homeAdv = computeHomeAdv(all);
    const { elo, lastSeen } = runElo(bySeason, homeAdv);

    const codes = [...bySeason.keys()].sort((a, b) => seasonOrder(a) - seasonOrder(b));
    const lastCode = codes[codes.length - 1];

    // Palmarés + posiciones por club
    const titles = new Map<string, number>();
    const top4 = new Map<string, number>();
    const seasonsPlayed = new Map<string, number>();
    const posHistory = new Map<string, number[]>();
    historyOut[src.id] = [];
    for (const code of codes) {
      const table = seasonTable(bySeason.get(code)!);
      if (table.length === 0) continue;
      historyOut[src.id].push({
        season: `${seasonOrder(code)}/${String((seasonOrder(code) + 1) % 100).padStart(2, '0')}`,
        champion: ALIASES[table[0].team] ?? table[0].team,
        runnerUp: ALIASES[table[1]?.team] ?? table[1]?.team ?? '',
      });
      table.forEach((row, i) => {
        seasonsPlayed.set(row.team, (seasonsPlayed.get(row.team) ?? 0) + 1);
        if (i === 0) titles.set(row.team, (titles.get(row.team) ?? 0) + 1);
        if (i < 4) top4.set(row.team, (top4.get(row.team) ?? 0) + 1);
        const ph = posHistory.get(row.team) ?? [];
        ph.push(i + 1);
        posHistory.set(row.team, ph);
      });
    }

    // Perfil de estilo y ratings ataque/defensa: últimas 3 temporadas con decaimiento
    const last3 = codes.slice(-3);
    const decay = (i: number) => Math.exp(-0.5 * (last3.length - 1 - i));
    type Acc = { gf: number; ga: number; shots: number; sot: number; fouls: number; cards: number; corners: number; games: number; homePts: number; homeGames: number };
    const acc = new Map<string, Acc>();
    const getAcc = (t: string) => {
      if (!acc.has(t)) acc.set(t, { gf: 0, ga: 0, shots: 0, sot: 0, fouls: 0, cards: 0, corners: 0, games: 0, homePts: 0, homeGames: 0 });
      return acc.get(t)!;
    };
    let leagueGoals = 0; let leagueGames = 0;
    last3.forEach((code, i) => {
      const w = decay(i);
      for (const m of bySeason.get(code)!) {
        const h = getAcc(m.home); const a = getAcc(m.away);
        h.gf += w * m.hg; h.ga += w * m.ag; a.gf += w * m.ag; a.ga += w * m.hg;
        h.shots += w * m.hs; a.shots += w * m.as_;
        h.sot += w * m.hst; a.sot += w * m.ast;
        h.fouls += w * m.hf; a.fouls += w * m.af;
        h.cards += w * (m.hy + 2 * m.hr); a.cards += w * (m.ay + 2 * m.ar);
        h.corners += w * m.hc; a.corners += w * m.ac;
        h.games += w; a.games += w;
        h.homeGames += w; h.homePts += w * (m.hg > m.ag ? 3 : m.hg === m.ag ? 1 : 0);
        leagueGoals += w * (m.hg + m.ag); leagueGames += w;
      }
    });
    const avgGoalsPerTeam = leagueGoals / (2 * leagueGames); // goles por equipo por partido

    // Clubes de la última temporada = primera división 2026/27
    const currentTeams = new Set<string>();
    for (const m of bySeason.get(lastCode)!) { currentTeams.add(m.home); currentTeams.add(m.away); }

    // Pool histórico (para divisiones inferiores REALES): jugaron antes pero no están hoy
    const historicTeams = [...elo.keys()].filter((t) => !currentTeams.has(t));
    historicTeams.sort((a, b) => (elo.get(b) ?? 0) - (elo.get(a) ?? 0));

    const styleRange = { agg: [] as number[], dom: [] as number[] };
    for (const t of currentTeams) {
      const a = getAcc(t);
      if (a.games > 0) {
        styleRange.agg.push((a.fouls + 2 * a.cards) / a.games);
        styleRange.dom.push((a.shots + a.corners) / a.games);
      }
    }
    const pct = (arr: number[], v: number) => {
      const s = [...arr].sort((x, y) => x - y);
      const i = s.findIndex((x) => x >= v);
      return Math.round(100 * (i < 0 ? 1 : i / Math.max(1, s.length - 1)));
    };
    // Fuentes sin stats (fd-new/static): tiros/faltas/córners en 0 → estilo neutro en vez de 0.
    const hasStats = styleRange.agg.some((v) => v > 0) || styleRange.dom.some((v) => v > 0);

    const emitClub = (team: string, division: number) => {
      const a = getAcc(team);
      const games = a.games || 1;
      const gfRate = a.games > 0 ? a.gf / games : avgGoalsPerTeam * 0.85;
      const gaRate = a.games > 0 ? a.ga / games : avgGoalsPerTeam * 1.1;
      const eloV = Math.round(elo.get(team) ?? 1450);
      const ph = posHistory.get(team) ?? [];
      const last5 = ph.slice(-5);
      const t = titles.get(team) ?? 0;
      const t4 = top4.get(team) ?? 0;
      const sp = seasonsPlayed.get(team) ?? 0;
      const prestige = Math.max(5, Math.min(99, Math.round(
        8 + t * 6 + t4 * 1.2 + sp * 0.35 + (eloV - 1500) / 12,
      )));
      clubsOut.push({
        id: `${src.id}-${team.replace(/[^a-zA-Z0-9]/g, '')}`,
        rawName: team,
        name: ALIASES[team] ?? team,
        country: src.country,
        leagueId: src.id,
        division,
        elo: eloV,
        attack: Number(Math.log(Math.max(0.3, gfRate) / avgGoalsPerTeam).toFixed(3)),
        defense: Number(Math.log(Math.max(0.3, gaRate) / avgGoalsPerTeam).toFixed(3)),
        style: {
          aggression: !hasStats ? 50 : a.games > 0 ? pct(styleRange.agg, (a.fouls + 2 * a.cards) / games) : 50,
          dominance: !hasStats ? 45 : a.games > 0 ? pct(styleRange.dom, (a.shots + a.corners) / games) : 40,
          homeAdv: a.homeGames > 0 ? Number((a.homePts / a.homeGames / 3).toFixed(3)) : 0.5,
        },
        prestige,
        titles: t,
        top4: t4,
        seasonsInTop: sp,
        avgPosLast5: last5.length ? Number((last5.reduce((x, y) => x + y, 0) / last5.length).toFixed(1)) : null,
        bestSeason: ph.length ? Math.min(...ph) : null,
        lastSeen: lastSeen.get(team) ?? lastCode,
      });
    };

    // Cap de 1ª división a src.teams (por Elo): mantiene el molde de liga europea y la performance.
    // El excedente de la temporada actual baja a divisiones inferiores junto a los históricos.
    const currentByElo = [...currentTeams].sort((a, b) => (elo.get(b) ?? 0) - (elo.get(a) ?? 0));
    const div1Teams = currentByElo.slice(0, src.teams);
    const overflow = currentByElo.slice(src.teams);
    for (const t of div1Teams) emitClub(t, 1);
    // Hasta 36 clubes reales para 2ª y 3ª división (excedente actual + históricos)
    [...overflow, ...historicTeams].slice(0, 36).forEach((t, i) => emitClub(t, i < 18 ? 2 : 3));

    leaguesOut.push({
      id: src.id, name: src.name, country: src.country, teams: src.teams,
      relegations: src.relegations, tvBase: src.tvBase, homeAdvElo: homeAdv,
      continentalSlots: src.slots, coeff: src.coeff,
      confederation: src.confederation ?? 'UEFA',
      avgGoalsPerTeam: Number(avgGoalsPerTeam.toFixed(3)),
    });
    console.log(`  ${src.name}: ${currentTeams.size} clubes actuales, ${Math.min(36, historicTeams.length)} históricos, VL=${homeAdv} Elo`);
  }

  writeFileSync(join(OUT, 'clubs.json'), JSON.stringify(clubsOut));
  writeFileSync(join(OUT, 'leagues.json'), JSON.stringify(leaguesOut));
  writeFileSync(join(OUT, 'history.json'), JSON.stringify(historyOut));
  writeFileSync(join(OUT, 'aliases.json'), JSON.stringify(ALIASES, null, 2));
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    clubs: clubsOut.length,
    leagues: leaguesOut.length,
    elapsedMs: Date.now() - t0,
  }, null, 2));
  writeFileSync(join(OUT, 'etl-report.txt'), report.length ? report.join('\n') : 'Sin incidencias.');
  console.log(`\nETL OK: ${clubsOut.length} clubes, ${leaguesOut.length} ligas en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (report.length) console.log(`Reporte de calidad: ${report.length} avisos → public/data/etl-report.txt`);
}

main().catch((e) => { console.error('ETL FALLÓ:', e); process.exit(1); });
