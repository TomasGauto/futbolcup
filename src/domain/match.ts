import { Rng } from './rng';
import type { Club, MatchResult, Player } from './types';
import { TACTIC_MATRIX } from './constants';

// ------------------------------ Fuerza del once ------------------------------

const ATTACK_WEIGHT: Record<string, number> = {
  GK: 0.02, CB: 0.06, LB: 0.1, RB: 0.1, DM: 0.15, CM: 0.25, AM: 0.4, LW: 0.42, RW: 0.42, ST: 0.45,
};
const DEFENSE_WEIGHT: Record<string, number> = {
  GK: 0.45, CB: 0.45, LB: 0.35, RB: 0.35, DM: 0.35, CM: 0.22, AM: 0.08, LW: 0.06, RW: 0.06, ST: 0.03,
};

export function pickXI(club: Club): Player[] {
  const fit = club.squad.filter((p) => !p.injury && p.fitness > 30);
  const gk = fit.filter((p) => p.position === 'GK').sort((a, b) => b.overall - a.overall)[0];
  
  const defs = fit.filter((p) => ['CB', 'LB', 'RB'].includes(p.position)).sort((a, b) => b.overall - a.overall);
  const mids = fit.filter((p) => ['DM', 'CM', 'AM'].includes(p.position)).sort((a, b) => b.overall - a.overall);
  const fwds = fit.filter((p) => ['LW', 'RW', 'ST'].includes(p.position)).sort((a, b) => b.overall - a.overall);
  
  const field: Player[] = [];
  // Asegurar una base mínima: 3 defensores, 3 medios, 1 delantero
  field.push(...defs.splice(0, Math.min(3, defs.length)));
  field.push(...mids.splice(0, Math.min(3, mids.length)));
  field.push(...fwds.splice(0, Math.min(1, fwds.length)));
  
  // Completar el resto (hasta 10, o 11 si no hay arquero) con los mejores disponibles
  const targetFieldCount = gk ? 10 : 11;
  const remaining = [...defs, ...mids, ...fwds].sort((a, b) => b.overall - a.overall);
  field.push(...remaining.splice(0, Math.max(0, targetFieldCount - field.length)));

  return gk ? [gk, ...field] : field;
}

export type TeamStrength = { attack: number; defense: number; avgOverall: number; xi: Player[] };

export function teamStrength(club: Club, formBoost = 0): TeamStrength {
  const xi = pickXI(club);
  if (xi.length < 8) {
    // plantel diezmado: castigo fuerte
    return { attack: 55, defense: 55, avgOverall: 55, xi };
  }
  let aw = 0; let dw = 0; let aSum = 0; let dSum = 0; let oSum = 0;
  for (const p of xi) {
    const wA = ATTACK_WEIGHT[p.position] ?? 0.2;
    const wD = DEFENSE_WEIGHT[p.position] ?? 0.2;
    const eff = p.overall * (1 + 0.02 * p.form / 10) * (0.9 + 0.2 * p.morale / 100) * (0.85 + 0.15 * p.fitness / 100);
    aSum += eff * wA; aw += wA;
    dSum += eff * wD; dw += wD;
    oSum += p.overall;
  }
  const chem = Math.min(1.03, 0.97 + xi.reduce((s, p) => s + Math.min(6, p.yearsAtClub), 0) / (11 * 6) * 0.06);
  return {
    attack: (aSum / aw) * chem * (1 + formBoost),
    defense: (dSum / dw) * chem * (1 + formBoost * 0.6),
    avgOverall: oSum / xi.length,
    xi,
  };
}

// ------------------------------ Dixon-Coles ------------------------------

const RHO = -0.05;
const MAX_G = 8;

function tau(x: number, y: number, lh: number, la: number): number {
  if (x === 0 && y === 0) return 1 - lh * la * RHO;
  if (x === 0 && y === 1) return 1 + lh * RHO;
  if (x === 1 && y === 0) return 1 + la * RHO;
  if (x === 1 && y === 1) return 1 - RHO;
  return 1;
}

function poissonPmf(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

export function sampleScore(rng: Rng, lambdaHome: number, lambdaAway: number): { hg: number; ag: number } {
  const lh = Math.min(4.5, Math.max(0.15, lambdaHome));
  const la = Math.min(4.5, Math.max(0.12, lambdaAway));
  const ph: number[] = []; const pa: number[] = [];
  for (let k = 0; k <= MAX_G; k++) { ph.push(poissonPmf(k, lh)); pa.push(poissonPmf(k, la)); }
  let total = 0;
  const cells: number[] = [];
  for (let x = 0; x <= MAX_G; x++) {
    for (let y = 0; y <= MAX_G; y++) {
      const p = ph[x] * pa[y] * tau(x, y, lh, la);
      cells.push(p); total += p;
    }
  }
  let r = rng.next('match') * total;
  for (let i = 0; i < cells.length; i++) {
    r -= cells[i];
    if (r <= 0) return { hg: Math.floor(i / (MAX_G + 1)), ag: i % (MAX_G + 1) };
  }
  return { hg: 0, ag: 0 };
}

export type MatchContext = {
  homeBoost?: number; // 0 en cancha neutral
  homeFormBoost?: number;
  awayFormBoost?: number;
  kFactor?: number; // 20 liga, 25 copa, 30 continental
};

/** Lambdas esperados según fuerza de plantel, estilo real (ETL) y táctica. */
export function matchLambdas(home: Club, away: Club, ctx: MatchContext = {}): { lh: number; la: number; sh: TeamStrength; sa: TeamStrength } {
  const sh = teamStrength(home, ctx.homeFormBoost ?? 0);
  const sa = teamStrength(away, ctx.awayFormBoost ?? 0);
  const tacticH = TACTIC_MATRIX[home.philosophy]?.[away.philosophy] ?? 0;
  const tacticA = TACTIC_MATRIX[away.philosophy]?.[home.philosophy] ?? 0;
  const coachH = (home.coachQuality - 70) * 0.002;
  const coachA = (away.coachQuality - 70) * 0.002;
  const homeBoost = ctx.homeBoost ?? 0.16 + (home.style.homeAdv - 0.5) * 0.2;

  const lh = 1.18 * Math.exp(
    0.042 * (sh.attack - sa.defense) + 0.2 * home.attack + 0.2 * away.defense + tacticH + coachH,
  ) * (1 + homeBoost);
  const la = 1.18 * Math.exp(
    0.042 * (sa.attack - sh.defense) + 0.2 * away.attack + 0.2 * home.defense + tacticA + coachA,
  ) * (1 - homeBoost * 0.35);
  return { lh, la, sh, sa };
}

function assignScorers(rng: Rng, xi: Player[], goals: number): string[] {
  if (xi.length === 0 || goals === 0) return [];
  const weights = xi.map((p) => (ATTACK_WEIGHT[p.position] ?? 0.1) * Math.pow(p.overall / 70, 2));
  const total = weights.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  for (let g = 0; g < goals; g++) {
    let r = rng.next('match') * total;
    for (let i = 0; i < xi.length; i++) {
      r -= weights[i];
      if (r <= 0) { out.push(xi[i].id); break; }
    }
  }
  return out;
}

/** Simula un partido completo: marcador, goleadores, stats de jugadores y Elo. */
export function playMatch(rng: Rng, home: Club, away: Club, ctx: MatchContext = {}): MatchResult {
  const { lh, la, sh, sa } = matchLambdas(home, away, ctx);
  const { hg, ag } = sampleScore(rng, lh, la);

  const scorersHome = assignScorers(rng, sh.xi, hg);
  const scorersAway = assignScorers(rng, sa.xi, ag);

  // Stats de jugadores
  applyStats(sh.xi, scorersHome, hg, ag);
  applyStats(sa.xi, scorersAway, ag, hg);

  // Elo (§7.1)
  const k0 = ctx.kFactor ?? 20;
  const homeAdvElo = ctx.homeBoost === 0 ? 0 : 65;
  const expH = 1 / (1 + Math.pow(10, (away.elo - home.elo - homeAdvElo) / 400));
  const s = hg > ag ? 1 : hg === ag ? 0.5 : 0;
  const k = k0 * (1 + 0.5 * Math.abs(hg - ag));
  home.elo += k * (s - expH);
  away.elo += k * ((1 - s) - (1 - expH));

  return { homeId: home.id, awayId: away.id, hg, ag, scorersHome, scorersAway };
}

function applyStats(xi: Player[], scorers: string[], gf: number, ga: number): void {
  for (const p of xi) {
    p.seasonStats.apps++;
    p.careerApps++;
    const goals = scorers.filter((id) => id === p.id).length;
    p.seasonStats.goals += goals;
    p.careerGoals += goals;
    const base = gf > ga ? 7.0 : gf === ga ? 6.6 : 6.1;
    p.seasonStats.rating = Number((p.seasonStats.rating * 0.9 + (base + goals * 0.8) * 0.1).toFixed(2));
    p.form = Math.max(-10, Math.min(10, p.form + (gf > ga ? 0.6 : gf < ga ? -0.6 : 0.1) + goals * 0.8));
    p.fitness = Math.max(40, p.fitness - 3);
  }
}
