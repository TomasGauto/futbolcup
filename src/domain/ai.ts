import { Rng } from './rng';
import type { Club, GameState, Player, Position } from './types';
import { genPlayer } from './playergen';
import { playerValue, fairWage, eloToOverall } from './valuation';
import { leagueMultFor } from './development';
import { POSITIONS_TEMPLATE, PHILOSOPHIES } from './constants';

const AGGRESSION: Record<string, number> = {
  ambicioso: 0.9, mecenas: 1.0, formador: 0.35, conservador: 0.4, 'en crisis': 0.15,
};

function weakestPosition(club: Club): Position {
  let worst: Position = 'CM';
  let worstAvg = 999;
  for (const { pos, count } of POSITIONS_TEMPLATE) {
    const players = club.squad.filter((p) => p.position === pos).sort((a, b) => b.overall - a.overall);
    const top = players.slice(0, Math.min(2, count));
    const avg = top.length ? top.reduce((a, p) => a + p.overall, 0) / top.length : 0;
    if (players.length === 0 || avg < worstAvg) { worstAvg = players.length ? avg : 0; worst = pos as Position; }
  }
  return worst;
}

function squadAvg(club: Club): number {
  const top = [...club.squad].sort((a, b) => b.overall - a.overall).slice(0, 16);
  return top.length ? top.reduce((a, p) => a + p.overall, 0) / top.length : 60;
}

/** Venta forzada: el club en rojo vende a su figura al mejor precio posible. */
export function forcedSale(state: GameState, rng: Rng, club: Club): string | null {
  const sellable = [...club.squad].sort((a, b) => b.value - a.value);
  const star = sellable[0];
  if (!star) return null;
  const fee = star.value * (0.75 + rng.next('market') * 0.2); // malvendido: el mercado sabe que estás ahogado
  club.squad = club.squad.filter((p) => p.id !== star.id);
  club.finances.cash = Number((club.finances.cash + fee).toFixed(1));
  state.salesThisSeason[club.id] = Number(((state.salesThisSeason[club.id] ?? 0) + fee).toFixed(1));
  club.fanbase.mood = Math.max(5, club.fanbase.mood - 12);
  return `${club.shortName} vendió de urgencia a ${star.name} por ${fee.toFixed(1)}M para tapar el rojo.`;
}

function aiBuy(state: GameState, rng: Rng, club: Club, notes: string[], targetOverride?: number): void {
  const budget = club.finances.cash * AGGRESSION[club.aiProfile] * (state.difficulty === 'Leyenda' && club.id !== state.clubId ? 1.08 : 1);
  if (budget < 2) return;
  const pos = weakestPosition(club);
  const target = Math.max(55, Math.min(90, targetOverride ?? squadAvg(club) + (club.aiProfile === 'ambicioso' || club.aiProfile === 'mecenas' ? 4 : 1)));

  // 50%: compra a otro club del mundo; 50%: fichaje "del exterior" (generado)
  if (rng.chance('market', 0.5)) {
    const candidates: { p: Player; from: Club }[] = [];
    for (const other of Object.values(state.clubs)) {
      if (other.id === club.id || other.id === state.clubId) continue;
      for (const p of other.squad) {
        if (p.position !== pos) continue;
        if (p.overall < target - 4 || p.overall > target + 5) continue;
        if (p.value > budget) continue;
        if (!p.wantsToLeave && p.overall > squadAvg(other) + 2 && !rng.chance('market', 0.25)) continue;
        candidates.push({ p, from: other });
        if (candidates.length > 12) break;
      }
      if (candidates.length > 12) break;
    }
    if (candidates.length > 0) {
      const { p, from } = rng.pick('market', candidates);
      const fee = Number((p.value * (1 + rng.next('market') * 0.3)).toFixed(1));
      from.squad = from.squad.filter((x) => x.id !== p.id);
      from.finances.cash = Number((from.finances.cash + fee).toFixed(1));
      club.finances.cash = Number((club.finances.cash - fee).toFixed(1));
      club.amortPool.push({ annual: Number((fee / 4).toFixed(1)), yearsLeft: 4 });
      p.contract.yearsLeft = rng.int('market', 3, 5);
      p.contract.wage = fairWage(p, leagueMultFor(club), club.prestige);
      p.yearsAtClub = 0; p.wantsToLeave = false; p.morale = 75;
      p.traits = p.traits.filter((t) => t !== 'ídolo' && t !== 'cantera');
      p.homegrown = false;
      club.squad.push(p);
      if (from.id === state.clubId) notes.push(`OJO: ${club.name} te compró a ${p.name} por ${fee}M (tenía mercado y vos no lo blindaste).`);
      return;
    }
  }
  // fichaje del exterior
  const p = genPlayer(rng, {
    country: club.country, position: pos, targetOverall: target,
    leagueMult: leagueMultFor(club), prestige: club.prestige, marketIndex: state.marketIndex,
  });
  const fee = Number((p.value * (1 + rng.next('market') * 0.25)).toFixed(1));
  if (fee > Math.max(1, budget)) return;
  club.finances.cash = Number((club.finances.cash - fee).toFixed(1));
  club.amortPool.push({ annual: Number((fee / 4).toFixed(1)), yearsLeft: 4 });
  p.yearsAtClub = 0;
  club.squad.push(p);
}

function aiInvest(state: GameState, rng: Rng, club: Club): void {
  const cash = club.finances.cash;
  const profile = club.aiProfile;
  if (cash > 40 && rng.chance('market', profile === 'formador' ? 0.5 : 0.2)) {
    const facs = ['academy', 'medical', 'training', 'scouting', 'dataDept'] as const;
    const f = rng.pick('market', facs);
    if (club.facilities[f] < 5) {
      club.facilities[f]++;
      club.finances.cash -= 12;
    }
  }
  if (cash > 120 && !club.stadium.works && rng.chance('market', profile === 'ambicioso' || profile === 'mecenas' ? 0.15 : 0.05)) {
    club.stadium.works = { label: 'Ampliación', seasonsLeft: 2, capacityDelta: 12000, qualityDelta: 8 };
    club.finances.cash -= 90;
  }
  // mantenimiento: la IA lo paga si puede
  const upkeep = club.stadium.capacity / 1e6 * 6;
  if (cash > upkeep) club.finances.cash = Number((club.finances.cash - upkeep).toFixed(1));
  else club.stadium.maintenanceDebt += upkeep;
}

/**
 * Reposición de plantel del club del JUGADOR: el director deportivo cubre huecos
 * con fichajes de nivel medio para que el equipo nunca quede en 12 jugadores.
 * Las decisiones estratégicas (cracks, ventas, cantera) siguen siendo del jugador.
 */
export function replenishPlayerSquad(state: GameState, rng: Rng): string[] {
  const club = state.clubs[state.clubId];
  const notes: string[] = [];
  let guard = 0;
  while (club.squad.length < 21 && club.finances.cash > 1 && guard++ < 4) {
    const target = Math.max(56, Math.round(squadAvg(club)) - 2);
    const pos = weakestPosition(club);
    const p = genPlayer(rng, {
      country: club.country, position: pos, targetOverall: target,
      leagueMult: leagueMultFor(club), prestige: club.prestige, marketIndex: state.marketIndex,
    });
    const fee = Number((p.value * (1 + rng.next('market') * 0.2)).toFixed(1));
    if (fee > club.finances.cash) break;
    club.finances.cash = Number((club.finances.cash - fee).toFixed(1));
    club.amortPool.push({ annual: Number((fee / 3).toFixed(1)), yearsLeft: 3 });
    p.contract = { yearsLeft: rng.int('market', 2, 4), wage: fairWage(p, leagueMultFor(club), club.prestige) };
    p.yearsAtClub = 0;
    club.squad.push(p);
    notes.push(`El director deportivo cubrió el puesto de ${pos}: llegó ${p.name} (${p.overall}) por ${fee}M.`);
  }
  return notes;
}

/** Mercado y gestión de todos los clubes IA (una vez por temporada, en el receso). */
export function aiOffseason(state: GameState, rng: Rng): string[] {
  const notes: string[] = [];
  const clubs = rng.shuffle('market', Object.values(state.clubs).filter((c) => c.id !== state.clubId));

  for (const club of clubs) {
    // insolvencia: dos cajas negativas seguidas → venta forzada
    if (club.finances.cash < 0) {
      const note = forcedSale(state, rng, club);
      if (note && club.division === 1) notes.push(note);
      if (club.finances.cash < -30) { const n2 = forcedSale(state, rng, club); if (n2 && club.division === 1) notes.push(n2); }
      club.aiProfile = 'en crisis';
      continue;
    }

    // ventana de ascenso: adelanto de TV + reconstrucción real del plantel para la nueva categoría
    const lastRec = club.history[club.history.length - 1];
    if (lastRec && lastRec.division > club.division) {
      const toDiv1 = club.division === 1;
      club.finances.cash = Number((club.finances.cash + (toDiv1 ? 60 : 15)).toFixed(1));
      const prevProfile = club.aiProfile;
      club.aiProfile = 'ambicioso';
      const target = toDiv1 ? 70 + rng.int('market', 0, 2) : 65;
      const buys = toDiv1 ? 4 : 2;
      // libera a los más flojos para hacer lugar (el plantel se renueva de verdad)
      const worst = [...club.squad].sort((a, b) => a.overall - b.overall).slice(0, Math.min(buys, 4));
      for (const p of worst) club.squad = club.squad.filter((x) => x.id !== p.id);
      for (let i = 0; i < buys; i++) aiBuy(state, rng, club, notes, target);
      club.aiProfile = prevProfile === 'en crisis' ? 'conservador' : prevProfile;
    }

    // cambio de dueño / shocks institucionales
    const roll = rng.next('market');
    if (roll < 0.02) {
      club.aiProfile = 'mecenas';
      club.finances.cash += 80 + rng.next('market') * 200;
      if (club.division === 1) notes.push(`${club.name} fue comprado por un inversor millonario. Se viene una era de gasto.`);
    } else if (roll < 0.035) {
      club.aiProfile = 'en crisis';
      club.finances.cash *= 0.5;
      if (club.division === 1) notes.push(`Escándalo institucional en ${club.name}: fuga de capitales y crisis interna.`);
    }

    // vende descontentos o exceso de plantel
    const surplus = club.squad.filter((p) => p.wantsToLeave || club.squad.length > 27);
    for (const p of surplus.slice(0, 2)) {
      if (rng.chance('market', 0.5)) {
        const fee = p.value * (0.85 + rng.next('market') * 0.25);
        club.squad = club.squad.filter((x) => x.id !== p.id);
        club.finances.cash = Number((club.finances.cash + fee).toFixed(1));
      }
    }

    // compra 1-2 refuerzos según perfil
    if (club.finances.ffpSanction < 3) {
      aiBuy(state, rng, club, notes);
      if (rng.chance('market', AGGRESSION[club.aiProfile] * 0.5)) aiBuy(state, rng, club, notes);
    }

    // reposición: ningún club serio juega con 18 jugadores
    let guard = 0;
    while (club.squad.length < 21 && club.finances.cash > 1 && guard++ < 4) {
      aiBuy(state, rng, club, notes, Math.max(56, Math.round(squadAvg(club)) - 2));
    }

    aiInvest(state, rng, club);

    // entrenador y filosofía
    if (rng.chance('market', 0.12)) {
      club.coachQuality = Math.min(92, Math.max(45, Math.round(squadAvg(club) + rng.int('market', -5, 8))));
      if (rng.chance('market', 0.3)) club.philosophy = rng.pick('market', PHILOSOPHIES as unknown as string[]) as Club['philosophy'];
    }

    // el rating de estilo heredado del ETL se diluye con los años
    club.attack *= 0.92;
    club.defense *= 0.92;

    // prestigio sigue a los resultados
    const rec = club.history[club.history.length - 1];
    if (rec) {
      const perf = rec.division === 1 ? (rec.position <= 4 ? 2 : rec.position <= 10 ? 0.5 : -0.5) : -1;
      const titleBoost = rec.titles.length * 3;
      club.prestige = Math.max(3, Math.min(99, Math.round(club.prestige * 0.97 + perf + titleBoost + eloToOverall(club.elo, 1) * 0.02)));
    }
    club.fanbase.expectation = Math.min(95, Math.round(club.prestige * 0.9 + 10));
  }
  return notes;
}
