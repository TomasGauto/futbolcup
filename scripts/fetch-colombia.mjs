// Normaliza la Primera A colombiana (openfootball/south-america, formato .txt)
// al formato "fd-new" que consume el ETL, y lo commitea en scripts/data-manual/COL.csv.
// Reproducible: re-corré `node scripts/fetch-colombia.mjs` para actualizar.
//
// Fuente: https://github.com/openfootball/south-america (dominio público / CC0).
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const OUT_DIR = path.join(ROOT, 'scripts', 'data-manual');
const SEASONS = ['2023', '2024', '2025'];
const BASE = 'https://raw.githubusercontent.com/openfootball/south-america/master/colombia';

// Línea de partido: "[hh:mm]  Equipo Local   v Equipo Visita   H-A [(h-a)]"
const MATCH = /^\s*(?:\d{1,2}:\d{2}\s+)?(.+?)\s+v\s+(.+?)\s+(\d+)-(\d+)(?:\s+\(\d+-\d+\))?\s*$/;

function parseTxt(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^[=#▪-]/.test(line.trim())) continue; // títulos, meta, matchday, separadores
    const m = MATCH.exec(line);
    if (!m) continue;
    const home = m[1].trim(); const away = m[2].trim();
    if (!home || !away) continue;
    out.push({ home, away, hg: Number(m[3]), ag: Number(m[4]) });
  }
  return out;
}

const rows = [['Country', 'League', 'Season', 'Home', 'Away', 'HG', 'AG']];
let total = 0;
for (const season of SEASONS) {
  const res = await fetch(`${BASE}/${season}_co1.txt`);
  if (!res.ok) { console.error(`  ${season}: HTTP ${res.status} — omitida`); continue; }
  const matches = parseTxt(await res.text());
  for (const g of matches) rows.push(['Colombia', 'Primera A', season, g.home, g.away, String(g.hg), String(g.ag)]);
  total += matches.length;
  console.log(`  ${season}: ${matches.length} partidos`);
}

const csv = rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'COL.csv'), csv + '\n');
console.log(`COL.csv: ${total} partidos, ${SEASONS.length} temporadas → scripts/data-manual/COL.csv`);
