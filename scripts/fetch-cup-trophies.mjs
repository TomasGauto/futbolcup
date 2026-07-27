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
