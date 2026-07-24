import { Rng } from './rng';
import type { Club, GameState, Player } from './types';
import { genYouth } from './playergen';
import { playerValue, fairWage } from './valuation';
import { LEAGUE_WAGE_MULT } from './worldgen';

// Curva de edad (§7.3): crecimiento fuerte 16–21, meseta 26–29, caída 33+
export function ageCurveBase(age: number): number {
  if (age <= 21) return 2.2;
  if (age <= 25) return 1.1;
  if (age <= 29) return 0.1;
  if (age <= 32) return -0.9;
  return -2.2;
}

export function developPlayer(rng: Rng, p: Player, trainingLevel: number, totalRounds: number): void {
  const minutesFactor = 1 + 0.08 * (Math.min(1.4, p.seasonStats.apps / (totalRounds * 0.75)) - 1);
  let delta = ageCurveBase(p.age)
    * (1 + 0.10 * (trainingLevel - 3))
    * minutesFactor
    * (1 + 0.05 * (p.morale - 50) / 50)
    + rng.normal('dev', 0, 1.2);
  // el potencial frena el crecimiento
  if (delta > 0) {
    const headroom = p.potential - p.overall;
    delta = Math.min(delta, headroom * 0.6);
  }
  p.overall = Math.round(Math.max(42, Math.min(96, p.overall + delta)));
  p.age++;
  p.yearsAtClub++;
  if (p.age >= 27) p.potential = p.overall;
}

export function leagueMultFor(club: Club): number {
  const base = LEAGUE_WAGE_MULT[club.leagueId.slice(0, 3) + '1'] ?? 1;
  return base * (club.division === 1 ? 1 : club.division === 2 ? 0.35 : 0.15);
}

/**
 * Evolución anual del plantel de un club: desarrollo, retiros, contratos,
 * moral por rol prometido y camada de la academia.
 * Devuelve notas narrativas relevantes (para el club del jugador).
 */
export function evolveSquad(state: GameState, rng: Rng, club: Club, totalRounds: number): string[] {
  const notes: string[] = [];
  const isPlayer = club.id === state.clubId;
  const retirees: Player[] = [];

  for (const p of club.squad) {
    developPlayer(rng, p, club.facilities.training, totalRounds);

    // moral según minutos vs rol prometido
    const expectedApps = p.promisedRole === 'titular' ? totalRounds * 0.75 : p.promisedRole === 'rotación' ? totalRounds * 0.4 : totalRounds * 0.15;
    const ratio = p.seasonStats.apps / Math.max(1, expectedApps);
    if (ratio < 0.6) {
      p.morale = Math.max(5, p.morale - 18);
      if (p.morale < 35 && !p.traits.includes('cantera')) {
        p.wantsToLeave = true;
        if (isPlayer && p.overall >= 74) notes.push(`${p.name} está descontento: jugó menos de lo prometido y quiere irse.`);
      }
    } else {
      p.morale = Math.min(95, p.morale + 6);
      if (ratio > 0.9 && p.wantsToLeave && rng.chance('dev', 0.5)) p.wantsToLeave = false;
    }

    // contratos
    p.contract.yearsLeft--;

    // retiro
    if (p.age >= 34 && (p.overall < 62 || rng.chance('dev', 0.25 + (p.age - 34) * 0.2))) retirees.push(p);
  }

  for (const p of retirees) {
    club.squad = club.squad.filter((x) => x.id !== p.id);
    if (isPlayer) notes.push(`${p.name} (${p.age}) cuelga los botines tras ${p.careerApps} partidos y ${p.careerGoals} goles.`);
  }

  // contratos vencidos: el club renueva a los que aportan (y a casi todos si el plantel
  // quedó corto); se van los descontentos, los muy flojos y los veteranos en declive.
  const expired = club.squad.filter((p) => p.contract.yearsLeft <= 0);
  for (const p of expired) {
    const others = club.squad.filter((x) => x.id !== p.id);
    const avg = others.length ? others.reduce((a, x) => a + x.overall, 0) / others.length : 60;
    const declining = p.age >= 33 && p.overall < avg - 4;
    const keep = !p.wantsToLeave
      && !declining
      && (club.squad.length <= 21 || p.overall >= avg - 7)
      && rng.chance('dev', 0.85);
    if (keep) {
      p.contract.yearsLeft = rng.int('dev', 1, 4);
      p.contract.wage = fairWage(p, leagueMultFor(club), club.prestige) * (isPlayer ? 1.1 : 1);
      if (isPlayer && p.overall >= 74) notes.push(`${p.name} renovó automáticamente (+10% de salario).`);
    } else {
      club.squad = club.squad.filter((x) => x.id !== p.id);
      if (isPlayer && p.overall >= 70) notes.push(`${p.name} se fue LIBRE al vencer su contrato.`);
    }
  }

  // camada de academia
  const intake = club.facilities.academy >= 4 ? 2 : 1;
  for (let i = 0; i < intake; i++) {
    if (club.squad.length >= 30) break;
    const y = genYouth(rng, {
      country: club.country,
      academyLevel: club.facilities.academy,
      leagueMult: leagueMultFor(club),
      prestige: club.prestige,
      marketIndex: state.marketIndex,
    });
    club.squad.push(y);
    if (isPlayer && y.potential >= 84) notes.push(`La cantera produjo una joya: ${y.name} (${y.age}, ${y.position}, potencial altísimo).`);
  }

  // refrescar valores y salarios de referencia
  for (const p of club.squad) p.value = playerValue(p, state.marketIndex);

  return notes;
}
