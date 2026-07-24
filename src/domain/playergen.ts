import { Rng } from './rng';
import type { Player, Position, Trait } from './types';
import { NAME_POOLS, NATIONALITY_MIX, POSITIONS_TEMPLATE } from './constants';
import { playerValue, fairWage } from './valuation';

let playerCounter = 0;
export function resetPlayerCounter(n = 0): void { playerCounter = n; }
export function getPlayerCounter(): number { return playerCounter; }

export function pickNationality(rng: Rng, country: string): string {
  const mix = NATIONALITY_MIX[country] ?? [['Resto', 1]];
  const r = rng.next('world');
  let acc = 0;
  for (const [nat, w] of mix) {
    acc += w;
    if (r < acc) return nat;
  }
  return mix[mix.length - 1][0];
}

export function genName(rng: Rng, nationality: string): string {
  const pool = NAME_POOLS[nationality] ?? NAME_POOLS.Resto;
  return `${rng.pick('world', pool.first)} ${rng.pick('world', pool.last)}`;
}

export function genPlayer(
  rng: Rng,
  opts: {
    country: string;
    position: Position;
    targetOverall: number; // media buscada
    age?: number;
    leagueMult: number;
    prestige: number;
    marketIndex: number;
    homegrown?: boolean;
  },
): Player {
  const age = opts.age ?? Math.round(Math.min(38, Math.max(17, rng.normal('world', 25.5, 4.2))));
  const overall = Math.round(Math.min(94, Math.max(45, rng.normal('world', opts.targetOverall, 4))));
  // Potencial: los jóvenes tienen upside; a los 27+ potencial = overall
  const upside = age <= 20 ? rng.int('world', 4, 14) : age <= 23 ? rng.int('world', 2, 9) : age <= 26 ? rng.int('world', 0, 4) : 0;
  const potential = Math.min(96, overall + upside);
  const nationality = opts.homegrown ? localNationality(opts.country) : pickNationality(rng, opts.country);
  const traits: Trait[] = [];
  if (opts.homegrown) traits.push('cantera');
  if (rng.chance('world', 0.06)) traits.push('líder');
  if (rng.chance('world', 0.07)) traits.push('frágil');
  if (rng.chance('world', 0.06)) traits.push('mercenario');
  if (rng.chance('world', 0.04)) traits.push('polémico');
  if (age <= 20 && potential >= 82) traits.push('promesa');

  const yearsLeft = rng.int('world', 1, 4);
  const p: Player = {
    id: `p${++playerCounter}`,
    name: genName(rng, nationality),
    nationality,
    age,
    position: opts.position,
    overall,
    potential,
    traits,
    form: 0,
    morale: rng.int('world', 55, 80),
    fitness: 100,
    contract: { yearsLeft, wage: 0 },
    value: 0,
    wantsToLeave: false,
    homegrown: opts.homegrown ?? rng.chance('world', 0.12),
    promisedRole: overall >= opts.targetOverall + 2 ? 'titular' : age <= 21 ? 'promesa' : 'rotación',
    seasonStats: { apps: 0, goals: 0, assists: 0, rating: 6.5 },
    careerGoals: 0,
    careerApps: 0,
    yearsAtClub: rng.int('world', 0, Math.max(1, Math.min(8, age - 17))),
  };
  p.value = playerValue(p, opts.marketIndex);
  p.contract.wage = fairWage(p, opts.leagueMult, opts.prestige);
  return p;
}

function localNationality(country: string): string {
  return NAME_POOLS[country] ? country : 'Resto';
}

/** Plantilla completa de 25 jugadores coherente con el nivel del club. */
export function genSquad(
  rng: Rng,
  opts: { country: string; targetOverall: number; leagueMult: number; prestige: number; marketIndex: number },
): Player[] {
  const squad: Player[] = [];
  for (const { pos, count } of POSITIONS_TEMPLATE) {
    for (let i = 0; i < count; i++) {
      // titulares algo mejores que suplentes
      const delta = i === 0 ? 2 : i === 1 ? -1 : -4;
      squad.push(
        genPlayer(rng, {
          country: opts.country,
          position: pos as Position,
          targetOverall: opts.targetOverall + delta,
          leagueMult: opts.leagueMult,
          prestige: opts.prestige,
          marketIndex: opts.marketIndex,
          homegrown: rng.chance('world', 0.15),
        }),
      );
    }
  }
  // Una estrella por club con prestigio alto
  if (opts.prestige >= 70) {
    const star = squad.reduce((a, b) => (b.overall > a.overall ? b : a));
    star.overall = Math.min(93, star.overall + 4);
    star.potential = Math.max(star.potential, star.overall);
    if (rng.chance('world', 0.5)) star.traits.push('ídolo');
    star.value = playerValue(star, opts.marketIndex);
  }
  return squad;
}

/** Juvenil de la academia (para promociones y eventos). */
export function genYouth(
  rng: Rng,
  opts: { country: string; academyLevel: number; leagueMult: number; prestige: number; marketIndex: number },
): Player {
  const positions: Position[] = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
  const pos = rng.pick('world', positions);
  const quality = 52 + opts.academyLevel * 3 + rng.int('world', -4, 6);
  const p = genPlayer(rng, {
    country: opts.country,
    position: pos,
    targetOverall: quality,
    age: rng.int('world', 17, 19),
    leagueMult: opts.leagueMult,
    prestige: opts.prestige,
    marketIndex: opts.marketIndex,
    homegrown: true,
  });
  p.potential = Math.min(95, p.overall + rng.int('world', 6, 16 + opts.academyLevel * 2));
  p.contract.yearsLeft = 3;
  p.contract.wage = Math.max(0.05, p.contract.wage * 0.3);
  return p;
}
