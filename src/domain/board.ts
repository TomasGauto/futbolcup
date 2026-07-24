import { Rng } from './rng';
import type { BoardObjectives, GameState } from './types';

// Junta directiva: objetivos por bienio, confianza, evaluación.

export function genObjectives(state: GameState, rng: Rng): BoardObjectives {
  const club = state.clubs[state.clubId];
  const league = state.leagues.find((l) => l.clubIds.includes(club.id))!;
  const n = league.clubIds.length;
  const eloRank = [...league.clubIds]
    .map((id) => state.clubs[id])
    .sort((a, b) => b.elo - a.elo)
    .findIndex((c) => c.id === club.id) + 1;

  // objetivo = un poco mejor que tu nivel real (la junta siempre pide de más)
  const stretch = state.difficulty === 'Leyenda' ? 3 : state.difficulty === 'Realista' ? 1 : 0;
  const target = Math.max(1, Math.min(n, eloRank - stretch));

  let sportive: string;
  if (club.division > 1) sportive = 'Conseguir el ascenso en este bienio';
  else if (target <= 1) sportive = 'Pelear el título de liga';
  else if (target <= 4) sportive = `Clasificar a la Copa Élite (top ${Math.min(4, target + 1)})`;
  else if (target <= n * 0.5) sportive = `Terminar en la mitad superior (top ${Math.ceil(n / 2)})`;
  else sportive = 'Mantener la categoría sin sufrir';

  const financial = club.finances.cash < 0
    ? 'Volver a caja positiva antes del cierre del bienio'
    : club.debt.reduce((a, d) => a + d.principal, 0) > 60
      ? 'Reducir la deuda total del club'
      : 'Cerrar el bienio sin pérdidas acumuladas';

  const softs = [
    'Ganarle al menos un clásico a nuestro archirrival',
    'Darle minutos reales a la cantera',
    'No vender al ídolo del club',
    'Mejorar la imagen institucional con la prensa',
  ];
  return {
    sportive,
    sportiveTargetPos: club.division > 1 ? 3 : target,
    financial,
    soft: rng.pick('event', softs),
  };
}

export type BienniumEval = {
  sportiveOk: boolean;
  financialOk: boolean;
  trustDelta: number;
  verdict: string;
};

export function evaluateBiennium(state: GameState): BienniumEval {
  const club = state.clubs[state.clubId];
  const last2 = club.history.slice(-2);
  const target = state.objectives.sportiveTargetPos;
  const bestPos = Math.min(...last2.map((r) => (r.division === 1 ? r.position : r.position + 20)));
  const promoted = last2.some((r, i) => i > 0 && r.division < last2[i - 1].division) || (last2[0] && club.division < last2[0].division);
  const sportiveOk = club.division > 1
    ? promoted || bestPos <= 3 + 20
    : bestPos <= target + 1;

  const window = club.finances.ffpWindow.slice(-2);
  const financialOk = club.finances.cash >= 0 && window.reduce((a, b) => a + b, 0) > -25;

  const titles = last2.flatMap((r) => r.titles).length;
  let delta = 0;
  delta += sportiveOk ? 12 : -16;
  delta += financialOk ? 6 : -12;
  delta += titles * 14;
  if (club.fanbase.mood > 65) delta += 4;
  if (club.fanbase.mood < 30) delta -= 6;

  let verdict: string;
  if (delta >= 20) verdict = 'La junta está encantada. Sos el proyecto.';
  else if (delta >= 0) verdict = 'La junta aprueba la gestión, sin fuegos artificiales.';
  else if (delta >= -15) verdict = 'La junta está inquieta. El margen se achica.';
  else verdict = 'La junta está furiosa. Estás en la cuerda floja.';

  return { sportiveOk, financialOk, trustDelta: delta, verdict };
}

/** Actualiza humor de hinchada al cierre de cada temporada. */
export function updateFanMood(state: GameState): void {
  const club = state.clubs[state.clubId];
  const rec = club.history[club.history.length - 1];
  if (!rec) return;
  const n = state.leagues.find((l) => l.id === rec.leagueId)?.clubIds.length ?? 20;
  const expected = Math.max(1, Math.round(n * (1 - club.fanbase.expectation / 110)));
  let delta = (expected - rec.position) * 2.2;
  delta += rec.titles.length * 15;
  if (rec.division > 1 && club.division === 1) delta += 20; // ascenso (rec previo era div2)
  if (rec.division === 1 && club.division > 1) delta -= 28; // descenso
  const loyaltyCushion = (club.fanbase.loyalty - 50) / 25;
  club.fanbase.mood = Math.max(3, Math.min(97, Math.round(club.fanbase.mood + delta + loyaltyCushion)));
}
