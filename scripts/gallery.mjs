// Genera una galería HTML estática (manifiesto inlineado) para revisar escudos + trofeos.
//   node scripts/gallery.mjs  ->  public/data/gallery.html
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const DATA = path.join(ROOT, 'public', 'data');
const LEAGUE = { ENG1: 'Premier League', ESP1: 'La Liga', ITA1: 'Serie A', GER1: 'Bundesliga', FRA1: 'Ligue 1' };

const m = JSON.parse(await readFile(path.join(DATA, 'assets-manifest.json'), 'utf8'));
const crests = m.crests || [];
const trophies = m.trophies || [];

const byLeague = {};
for (const c of crests) (byLeague[c.leagueId] ??= []).push(c);

const trophyCards = trophies.map((t) => `
  <figure class="card ${t.source === 'generated' ? 'generated' : ''}"><img src="${t.file}" alt="${t.title}"/><figcaption>${t.title}<span class="d">${t.kind || ''}${t.source === 'generated' ? ' · svg' : ''}</span></figcaption></figure>`).join('');

const sections = Object.keys(LEAGUE).map((lid) => {
  const list = (byLeague[lid] || []).sort((a, b) => a.division - b.division || a.name.localeCompare(b.name));
  const real = list.filter((c) => c.source === 'real').length;
  const cards = list.map((c) => `
    <figure class="card ${c.source}"><img loading="lazy" src="${c.file}" alt="${c.name}"/>
    <figcaption>${c.name}<span class="d">D${c.division}${c.source === 'generated' ? ' · svg' : ''}</span></figcaption></figure>`).join('');
  return `<section><h2>${LEAGUE[lid]} <small>${list.length} clubes · ${real} reales</small></h2><div class="grid">${cards}</div></section>`;
}).join('');

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Assets · Dinastía FC</title><style>
:root{color-scheme:dark}body{margin:0;background:#0b0f17;color:#e6e9ef;font:15px/1.4 system-ui,sans-serif}
header{padding:24px 20px;border-bottom:1px solid #1e2637}h1{margin:0;font-size:20px}
h2{margin:28px 20px 8px;font-size:16px;font-weight:600}h2 small{color:#8b93a7;font-weight:400;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:12px;padding:8px 20px 12px}
.card{margin:0;background:#131a27;border:1px solid #1e2637;border-radius:10px;padding:10px 6px;text-align:center;transition:.15s}
.card:hover{border-color:#3b4a66;transform:translateY(-2px)}
.card img{width:52px;height:52px;object-fit:contain}
figcaption{font-size:11px;margin-top:6px;color:#c6cdda;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d{display:block;color:#748099;font-size:10px}.card.generated{outline:1px dashed #33405c}
.legend{padding:0 20px;color:#8b93a7;font-size:12px}
</style></head><body>
<header><h1>Dinastía FC — Escudos & Trofeos</h1>
<p class="legend">${crests.length} escudos · ${crests.filter(c=>c.source==='real').length} reales, ${crests.filter(c=>c.source==='generated').length} SVG generados · ${trophies.length} trofeos. Borde punteado = SVG generado.</p></header>
<section><h2>Trofeos por liga</h2><div class="grid">${trophyCards}</div></section>
${sections}
</body></html>`;

await writeFile(path.join(DATA, 'gallery.html'), html);
console.log('Galería: public/data/gallery.html');
