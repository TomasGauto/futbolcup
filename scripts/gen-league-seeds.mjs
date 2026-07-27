// Genera resultados SINTÉTICOS deterministas para ligas sin fuente de datos
// gratuita confiable (Perú, Uruguay, Chile, Arabia Saudita), en el formato
// "fd-new" que consume el ETL (static-file). Los CLUBES y sus niveles relativos
// son reales y curados a mano; los marcadores son procedimentales (filosofía del
// proyecto: lo que falta se genera según las características del club).
// Reproducible: misma seed → mismos CSVs. Re-corré `node scripts/gen-league-seeds.mjs`.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const OUT_DIR = path.join(ROOT, 'scripts', 'data-manual');
const SEASONS = ['2023', '2024', '2025'];

// strength 50-90: define el orden de fuerza que el ETL convertirá en Elo.
const LEAGUES = [
  {
    key: 'PER', country: 'Perú', league: 'Liga 1', seed: 20250101,
    clubs: [
      ['Universitario', 78], ['Alianza Lima', 77], ['Sporting Cristal', 76], ['Melgar', 70],
      ['Cusco FC', 67], ['Cienciano', 66], ['Sport Huancayo', 64], ['Deportivo Garcilaso', 63],
      ['ADT', 61], ['Atlético Grau', 61], ['César Vallejo', 60], ['Sport Boys', 58],
      ['Alianza Atlético', 58], ['UTC Cajamarca', 57], ['Juan Pablo II', 55], ['Los Chankas', 55],
      ['Ayacucho FC', 54], ['Comerciantes Unidos', 53],
    ],
  },
  {
    key: 'URU', country: 'Uruguay', league: 'Primera División', seed: 20250202,
    clubs: [
      ['Peñarol', 80], ['Nacional', 79], ['Defensor Sporting', 69], ['Liverpool de Montevideo', 68],
      ['Danubio', 66], ['River Plate Montevideo', 64], ['Montevideo Wanderers', 63], ['Boston River', 62],
      ['Cerro Largo', 61], ['Racing de Montevideo', 60], ['Montevideo City Torque', 59], ['Cerro', 58],
      ['Fénix', 57], ['Progreso', 56], ['Juventud de Las Piedras', 55], ['Plaza Colonia', 54],
    ],
  },
  {
    key: 'CHI', country: 'Chile', league: 'Primera División', seed: 20250303,
    clubs: [
      ['Colo-Colo', 79], ['Universidad de Chile', 78], ['Universidad Católica', 74], ['Coquimbo Unido', 68],
      ['Cobresal', 66], ['Palestino', 65], ['Huachipato', 64], ['Everton de Viña', 62],
      ['Unión Española', 61], ['Audax Italiano', 61], ["O'Higgins", 60], ['Ñublense', 59],
      ['Unión La Calera', 57], ['Deportes Iquique', 56], ['Cobreloa', 55], ['Deportes La Serena', 54],
    ],
  },
  {
    key: 'SAU', country: 'Arabia Saudita', league: 'Saudi Pro League', seed: 20250404,
    clubs: [
      ['Al-Hilal', 84], ['Al-Nassr', 81], ['Al-Ittihad', 80], ['Al-Ahli', 78],
      ['Al-Qadsiah', 70], ['Al-Shabab', 68], ['Al-Ettifaq', 67], ['Al-Taawoun', 66],
      ['Al-Fateh', 63], ['Damac', 62], ['Al-Fayha', 61], ['Al-Khaleej', 61],
      ['Al-Riyadh', 60], ['Al-Wehda', 59], ['Al-Raed', 58], ['Al-Okhdood', 56],
      ['Al-Hazem', 55], ['Al-Orobah', 54],
    ],
  },
];

// PRNG determinista (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(lambda, rand) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

for (const cfg of LEAGUES) {
  const rand = rng(cfg.seed);
  const rows = [['Country', 'League', 'Season', 'Home', 'Away', 'HG', 'AG']];
  let total = 0;
  for (const season of SEASONS) {
    // deriva leve por temporada: nadie es igual de fuerte tres años seguidos
    const strength = new Map(cfg.clubs.map(([name, s]) => [name, s + (rand() - 0.5) * 4]));
    for (const [home] of cfg.clubs) {
      for (const [away] of cfg.clubs) {
        if (home === away) continue;
        const diff = (strength.get(home) - strength.get(away)) * 0.045;
        const lh = Math.max(0.35, Math.min(3.4, 1.42 + diff + 0.18)); // +localía
        const la = Math.max(0.30, Math.min(3.0, 1.10 - diff));
        rows.push([cfg.country, cfg.league, season, home, away, String(poisson(lh, rand)), String(poisson(la, rand))]);
        total++;
      }
    }
  }
  const csv = rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `${cfg.key}.csv`), csv + '\n');
  console.log(`${cfg.key}.csv: ${cfg.clubs.length} clubes, ${total} partidos, ${SEASONS.length} temporadas`);
}
console.log('listo');
