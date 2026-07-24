import type { GameState, LegendEntry, Position } from './types';

// Pantalla final: puntaje 0–1000, título de la era, once ideal, comparación con la línea base.

export type LegacyReport = {
  score: number;
  eraTitle: string;
  titles: string[];
  avgPosition: number;
  bestSeason: { season: string; position: number } | null;
  worstSeason: { season: string; position: number } | null;
  prestigeDelta: number;
  valueDelta: number;
  finalCash: number;
  idealXI: LegendEntry[];
  topLegend: LegendEntry | null;
  baselineVerdict: string;
  seasonsInTopFlight: number;
  breakdown: string[]; // de dónde sale el puntaje, línea por línea
};

const XI_SHAPE: { pos: Position; n: number }[] = [
  { pos: 'GK', n: 1 }, { pos: 'CB', n: 2 }, { pos: 'LB', n: 1 }, { pos: 'RB', n: 1 },
  { pos: 'DM', n: 1 }, { pos: 'CM', n: 2 }, { pos: 'AM', n: 1 }, { pos: 'ST', n: 2 },
];

function buildIdealXI(legends: Record<string, LegendEntry>): LegendEntry[] {
  const all = Object.values(legends).sort((a, b) => (b.apps + b.goals * 3) - (a.apps + a.goals * 3));
  const xi: LegendEntry[] = [];
  const used = new Set<string>();
  for (const { pos, n } of XI_SHAPE) {
    const compat = (p: LegendEntry) => p.position === pos
      || (pos === 'CM' && ['DM', 'AM'].includes(p.position))
      || (pos === 'ST' && ['LW', 'RW', 'AM'].includes(p.position))
      || (pos === 'LB' && p.position === 'LW') || (pos === 'RB' && p.position === 'RW');
    let count = 0;
    for (const p of all) {
      if (count >= n) break;
      if (used.has(p.name)) continue;
      if (compat(p)) { xi.push(p); used.add(p.name); count++; }
    }
  }
  for (const p of all) {
    if (xi.length >= 11) break;
    if (!used.has(p.name)) { xi.push(p); used.add(p.name); }
  }
  return xi.slice(0, 11);
}

export function computeLegacy(state: GameState): LegacyReport {
  const me = state.clubs[state.clubId];
  const annals = state.annals;
  const titles = [...state.managerTitles];
  const div1Annals = annals.filter((a) => a.division === 1);
  const avgPosition = div1Annals.length
    ? Number((div1Annals.reduce((s, a) => s + a.position, 0) / div1Annals.length).toFixed(1))
    : 21;

  const sorted = [...annals].sort((a, b) => (a.division * 100 + a.position) - (b.division * 100 + b.position));
  const bestSeason = sorted[0] ? { season: sorted[0].season, position: sorted[0].position } : null;
  const worstSeason = sorted.length ? { season: sorted[sorted.length - 1].season, position: sorted[sorted.length - 1].position } : null;

  const prestigeDelta = me.prestige - state.baseline.prestige;
  const finalValue = me.squad.reduce((a, p) => a + p.value, 0);
  const valueDelta = Number((finalValue - state.baseline.squadValue).toFixed(1));

  // Puntaje 0–1000, con desglose legible
  const breakdown: string[] = ['Base: +200'];
  let score = 200;
  const add = (pts: number, label: string) => {
    if (Math.round(pts) === 0) return;
    score += pts;
    breakdown.push(`${label}: ${pts > 0 ? '+' : ''}${Math.round(pts)}`);
  };
  add(titles.length * 40, `Títulos (${titles.length} × 40)`);
  const contis = state.continentalChampions.filter((c) => c === me.name).length;
  add(contis * 60, `Copas continentales (${contis} × 60)`);
  add(Math.max(0, (state.baseline.expectedPos - avgPosition)) * 18, 'Rendiste por encima de tu techo esperado');
  add(prestigeDelta * 4, `Prestigio ${prestigeDelta >= 0 ? 'ganado' : 'perdido'} (${prestigeDelta} × 4)`);
  add(Math.min(120, Math.max(-120, valueDelta / 8)), 'Valor del plantel vs. 2026');
  add(me.finances.cash > 0 ? 40 : -60, me.finances.cash > 0 ? 'Caja positiva al final' : 'Dejaste el club en rojo');
  add(annals.filter((a) => a.division === 1).length * 3, 'Temporadas en Primera (×3)');
  if (state.fired) add(-120, 'Te echaron antes de los 30 años');
  score = Math.round(Math.max(0, Math.min(1000, score)));

  // Título de la era (los muy ganadores primero: 6 ligas son 6 ligas)
  let eraTitle: string;
  const leagueTitles = titles.filter((t) => !t.startsWith('Copa')).length;
  if (leagueTitles >= 6) eraTitle = 'La Dinastía Dorada';
  else if (state.fired && me.finances.cash < 0) eraTitle = 'El Milagro que No Fue';
  else if (leagueTitles >= 2) eraTitle = 'Los Años de Gloria';
  else if (annals.some((a) => a.division > 1) && me.division === 1 && prestigeDelta > 10) eraTitle = 'La Resurrección';
  else if (me.division > 1) eraTitle = 'Los Años del Descenso';
  else if (me.finances.cash > 150 && titles.length === 0) eraTitle = 'El Milagro Financiero';
  else if (avgPosition <= state.baseline.expectedPos - 2) eraTitle = 'La Era del Sobrecumplimiento';
  else eraTitle = 'Tres Décadas de Trabajo Silencioso';

  const idealXI = buildIdealXI(state.legends);
  const topLegend = idealXI[0] ?? null;

  const expected = state.baseline.expectedPos;
  const baselineVerdict = avgPosition < expected - 1.5
    ? `Sin vos, este club promediaba el puesto ${expected}. Con vos, ${avgPosition}. Cambiaste su historia.`
    : avgPosition > expected + 1.5
      ? `El club promediaba nivel de puesto ${expected} cuando llegaste. Terminaste promediando ${avgPosition}. El universo control te gana.`
      : `El club quedó más o menos donde su nivel indicaba (esperado ~${expected}°, real ${avgPosition}°). Empate técnico con el destino.`;

  return {
    score,
    eraTitle,
    titles,
    avgPosition,
    bestSeason,
    worstSeason,
    prestigeDelta,
    valueDelta,
    finalCash: me.finances.cash,
    idealXI,
    topLegend,
    baselineVerdict,
    seasonsInTopFlight: div1Annals.length,
    breakdown,
  };
}
