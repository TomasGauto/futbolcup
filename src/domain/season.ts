import { Rng } from './rng';
import { bergerFixtures } from './calendar';
import { playMatch } from './match';
import type { Club, Confederation, GameState, KoCup, League, LeagueRow, MatchResult, SeasonLive } from './types';
import { SEASON_LABELS } from './types';

// ------------------------------ Tablas ------------------------------

export function emptyTable(clubIds: string[]): LeagueRow[] {
  return clubIds.map((clubId) => ({ clubId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }));
}

export function applyResultToTable(table: LeagueRow[], r: MatchResult): void {
  const h = table.find((x) => x.clubId === r.homeId);
  const a = table.find((x) => x.clubId === r.awayId);
  if (!h || !a) return;
  h.played++; a.played++;
  h.gf += r.hg; h.ga += r.ag; a.gf += r.ag; a.ga += r.hg;
  if (r.hg > r.ag) { h.won++; h.points += 3; a.lost++; }
  else if (r.hg < r.ag) { a.won++; a.points += 3; h.lost++; }
  else { h.drawn++; a.drawn++; h.points++; a.points++; }
}

export function sortTable(table: LeagueRow[]): LeagueRow[] {
  return [...table].sort((x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

// ------------------------------ Clasificación continental ------------------------------

function lastSeasonPositions(state: GameState, league: League): string[] {
  // Orden del año pasado; si no hay historia (temporada 1), por Elo.
  const clubs = league.clubIds.map((id) => state.clubs[id]);
  const withHist = clubs.filter((c) => c.history.length > 0 && c.history[c.history.length - 1].leagueId === league.id);
  if (withHist.length >= clubs.length * 0.7) {
    return [...clubs].sort((a, b) => {
      const pa = a.history[a.history.length - 1]?.position ?? 99;
      const pb = b.history[b.history.length - 1]?.position ?? 99;
      return pa - pb;
    }).map((c) => c.id);
  }
  return [...clubs].sort((a, b) => b.elo - a.elo).map((c) => c.id);
}

// ------------------------------ Inicio de temporada ------------------------------

function scheduleAt(totalRounds: number, fractions: number[]): number[] {
  return fractions.map((f) => Math.max(1, Math.min(totalRounds - 1, Math.round(totalRounds * f))));
}

// Copas continentales por confederación. `size` es potencia de 2 (bracket limpio);
// las fracciones del schedule tienen log2(size) rondas. Los premios reflejan la escala
// económica de cada confederación (UEFA > CONMEBOL > CONCACAF).
type ConfedTier = {
  comp: 'elite' | 'second' | 'third';
  name: string; size: number; prizePerWin: number; participation: number; sched: number[];
};
const CONFED_TIERS: Record<Confederation, ConfedTier[]> = {
  UEFA: [
    { comp: 'elite', name: 'UEFA Champions League', size: 32, prizePerWin: 14, participation: 18, sched: [0.2, 0.4, 0.6, 0.8, 0.95] },
    { comp: 'second', name: 'UEFA Europa League', size: 32, prizePerWin: 5, participation: 5, sched: [0.22, 0.42, 0.62, 0.82, 0.96] },
    { comp: 'third', name: 'UEFA Conference League', size: 16, prizePerWin: 2.5, participation: 2, sched: [0.3, 0.55, 0.78, 0.94] },
  ],
  CONMEBOL: [
    { comp: 'elite', name: 'Copa Libertadores', size: 16, prizePerWin: 11, participation: 12, sched: [0.3, 0.5, 0.7, 0.9] },
    { comp: 'second', name: 'Copa Sudamericana', size: 16, prizePerWin: 4, participation: 4, sched: [0.32, 0.52, 0.72, 0.92] },
  ],
  CONCACAF: [
    { comp: 'elite', name: 'Concacaf Champions Cup', size: 8, prizePerWin: 6, participation: 6, sched: [0.4, 0.65, 0.9] },
  ],
  AFC: [
    { comp: 'elite', name: 'AFC Champions League', size: 8, prizePerWin: 8, participation: 7, sched: [0.4, 0.65, 0.9] },
  ],
};

const floorPow2 = (n: number): number => (n < 2 ? 0 : 1 << Math.floor(Math.log2(n)));

export function initSeason(state: GameState): void {
  const rng = new Rng(state.rng);
  const fixturesByLeague: SeasonLive['fixturesByLeague'] = {};
  const tables: SeasonLive['tables'] = {};

  for (const lg of state.leagues) {
    const order = rng.shuffle('world', [...lg.clubIds]);
    fixturesByLeague[lg.id] = bergerFixtures(order);
    tables[lg.id] = emptyTable(lg.clubIds);
  }

  const playerClub = state.clubs[state.clubId];
  const playerLeague = state.leagues.find((l) => l.id === playerClub.leagueId)!;
  const totalRounds = fixturesByLeague[playerLeague.id].length;

  // reset stats de temporada
  for (const club of Object.values(state.clubs)) {
    for (const p of club.squad) {
      p.seasonStats = { apps: 0, goals: 0, assists: 0, rating: 6.5 };
      p.form = Math.round(p.form * 0.3);
      p.fitness = 100;
    }
  }

  const cups: KoCup[] = [];

  // Copa nacional por país: div1 + mejores 12 de div2 (32 equipos)
  for (const lg of state.leagues.filter((l) => l.division === 1)) {
    const div2 = state.leagues.find((l) => l.country === lg.country && l.division === 2);
    const div2Clubs = div2 ? [...div2.clubIds].sort((a, b) => state.clubs[b].elo - state.clubs[a].elo).slice(0, 32 - lg.clubIds.length) : [];
    cups.push({
      id: `copa-${lg.country}`,
      name: `Copa de ${lg.country}`,
      comp: 'copa',
      country: lg.country,
      alive: [...lg.clubIds, ...div2Clubs],
      roundsPlayed: [],
      winner: null,
      schedule: scheduleAt(totalRounds, [0.15, 0.35, 0.55, 0.75, 0.9]),
      kFactor: 25,
      prizePerWin: 3,
      participation: 1.5,
    });
  }

  // Continentales POR CONFEDERACIÓN: cada una arma sus copas con su propio pool de clubes.
  const clubConfed = new Map<string, Confederation>();
  for (const lg of state.leagues) for (const id of lg.clubIds) clubConfed.set(id, lg.confederation);
  // completar cupos por coeficiente, restringido a la confederación
  const fillToConfed = (arr: string[], n: number, exclude: Set<string>, confed: Confederation): string[] => {
    if (arr.length < n) {
      const pool = Object.values(state.clubs)
        .filter((c) => c.division === 1 && !exclude.has(c.id) && clubConfed.get(c.id) === confed)
        .sort((a, b) => b.continentalCoeff - a.continentalCoeff);
      for (const c of pool) {
        if (arr.length >= n) break;
        if (!arr.includes(c.id)) { arr.push(c.id); exclude.add(c.id); }
      }
    }
    return arr.slice(0, floorPow2(Math.min(arr.length, n))); // bracket potencia de 2
  };

  const confederations = [...new Set(state.leagues.filter((l) => l.division === 1).map((l) => l.confederation))];
  for (const confed of confederations) {
    const confLeagues = state.leagues.filter((l) => l.division === 1 && l.confederation === confed);
    const seeds: Record<'elite' | 'second' | 'third', string[]> = { elite: [], second: [], third: [] };
    for (const lg of confLeagues) {
      const order = lastSeasonPositions(state, lg);
      const s = lg.continentalSlots;
      seeds.elite.push(...order.slice(0, s.elite));
      seeds.second.push(...order.slice(s.elite, s.elite + s.second));
      seeds.third.push(...order.slice(s.elite + s.second, s.elite + s.second + s.third));
    }
    const used = new Set<string>([...seeds.elite, ...seeds.second, ...seeds.third]);
    for (const tier of CONFED_TIERS[confed] ?? []) {
      const alive = fillToConfed(seeds[tier.comp], tier.size, used, confed);
      if (alive.length < 2) continue;
      cups.push({
        id: `${tier.comp}-${confed}`, name: tier.name, comp: tier.comp, confederation: confed,
        alive, roundsPlayed: [], winner: null, schedule: scheduleAt(totalRounds, tier.sched),
        kFactor: 30, prizePerWin: tier.prizePerWin, participation: tier.participation,
      });
    }
  }

  state.seasonLive = {
    seasonIdx: state.currentSeason - 1,
    fixturesByLeague,
    tables,
    playerResults: [],
    round: 0,
    totalRounds,
    momentsFired: 0,
    pendingMoment: null,
    cups,
    playerFormBoost: 0,
    prizes: {},
    cupResultText: {},
  };
}

// ------------------------------ Avance ronda a ronda ------------------------------

const CUP_ROUND_NAMES: Record<number, string> = { 32: 'dieciseisavos', 16: 'octavos', 8: 'cuartos', 4: 'semifinal', 2: 'final' };

function playCupStage(state: GameState, rng: Rng, cup: KoCup): void {
  if (cup.winner || cup.alive.length < 2) return;
  const sl = state.seasonLive!;
  const name = CUP_ROUND_NAMES[cup.alive.length] ?? `ronda de ${cup.alive.length}`;
  // sorteo determinista: mezcla y aparea
  const order = rng.shuffle('match', [...cup.alive]);
  const results: MatchResult[] = [];
  const survivors: string[] = [];
  for (let i = 0; i < order.length - 1; i += 2) {
    const home = state.clubs[order[i]];
    const away = state.clubs[order[i + 1]];
    const isFinal = cup.alive.length === 2;
    let r = playMatch(rng, home, away, { kFactor: cup.kFactor, homeBoost: isFinal ? 0 : undefined });
    // sin empates: si empatan, penales (moneda sesgada por Elo)
    let winnerId: string;
    if (r.hg === r.ag) {
      const pHome = 1 / (1 + Math.pow(10, (away.elo - home.elo) / 400));
      winnerId = rng.chance('match', pHome) ? home.id : away.id;
    } else {
      winnerId = r.hg > r.ag ? home.id : away.id;
    }
    survivors.push(winnerId);
    const loserId = winnerId === home.id ? away.id : home.id;
    sl.prizes[winnerId] = (sl.prizes[winnerId] ?? 0) + cup.prizePerWin;
    sl.cupResultText[loserId] = `${cup.name}: ${name}`;
    results.push(r);
  }
  cup.roundsPlayed.push({ name, results });
  cup.alive = survivors;
  if (cup.alive.length === 1) {
    cup.winner = cup.alive[0];
    sl.cupResultText[cup.winner] = `${cup.name}: CAMPEÓN`;
    sl.prizes[cup.winner] = (sl.prizes[cup.winner] ?? 0) + cup.prizePerWin * 2;
    if (cup.comp === 'elite') state.continentalChampions.push(state.clubs[cup.winner].name);
  }
}

function applyInjuriesAndRecovery(state: GameState, rng: Rng, playedClubIds: Set<string>): void {
  for (const club of Object.values(state.clubs)) {
    const medical = club.facilities.medical;
    for (const p of club.squad) {
      if (p.injury) {
        p.injury.weeksLeft--;
        if (p.injury.weeksLeft <= 0) { p.injury = undefined; p.fitness = 70; }
        continue;
      }
      if (playedClubIds.has(club.id) && p.seasonStats.apps > 0 && p.fitness < 97) {
        const fatigue = (100 - p.fitness) / 100;
        const fragile = p.traits.includes('frágil') ? 1.5 : 1;
        const risk = 0.028 * (1 + fatigue) * (1 - 0.12 * (medical - 3)) * fragile;
        if (rng.chance('injury', risk)) {
          const roll = rng.next('injury');
          const weeks = roll < 0.5 ? rng.int('injury', 1, 2) : roll < 0.8 ? rng.int('injury', 3, 6) : roll < 0.95 ? rng.int('injury', 7, 16) : rng.int('injury', 20, 40);
          const types = ['desgarro', 'esguince de tobillo', 'lesión muscular', 'rotura de ligamentos', 'fractura'];
          p.injury = { type: weeks > 16 ? 'rotura de ligamentos' : types[Math.min(types.length - 1, Math.floor(weeks / 5))], weeksLeft: weeks };
          if (weeks > 16 && rng.chance('injury', 0.35)) p.overall = Math.max(45, p.overall - rng.int('injury', 1, 3));
        }
      }
      // recuperación semanal
      p.fitness = Math.min(100, p.fitness + 8);
      p.form = p.form * 0.95;
    }
  }
}

/** Juega una ronda de TODAS las ligas + fases de copa programadas. Devuelve los resultados de la liga del jugador. */
export function advanceRound(state: GameState): MatchResult[] {
  const sl = state.seasonLive!;
  const rng = new Rng(state.rng);
  const playerClub = state.clubs[state.clubId];
  const playerLeagueId = playerClub.leagueId;
  const r = sl.round;
  const played = new Set<string>();
  let playerRoundResults: MatchResult[] = [];

  for (const lg of state.leagues) {
    const fixtures = sl.fixturesByLeague[lg.id];
    if (!fixtures || r >= fixtures.length) continue;
    const results: MatchResult[] = [];
    for (const m of fixtures[r].matches) {
      const home = state.clubs[m.homeId];
      const away = state.clubs[m.awayId];
      const isPlayerMatch = m.homeId === state.clubId || m.awayId === state.clubId;
      const res = playMatch(rng, home, away, {
        kFactor: 20,
        homeFormBoost: isPlayerMatch && m.homeId === state.clubId ? sl.playerFormBoost : 0,
        awayFormBoost: isPlayerMatch && m.awayId === state.clubId ? sl.playerFormBoost : 0,
      });
      applyResultToTable(sl.tables[lg.id], res);
      results.push(res);
      played.add(m.homeId); played.add(m.awayId);
    }
    if (lg.id === playerLeagueId) playerRoundResults = results;
  }

  for (const cup of sl.cups) {
    if (cup.schedule.includes(r + 1)) playCupStage(state, rng, cup);
  }

  applyInjuriesAndRecovery(state, rng, played);
  sl.round++;
  return playerRoundResults;
}

export function seasonFinished(state: GameState): boolean {
  return (state.seasonLive?.round ?? 0) >= (state.seasonLive?.totalRounds ?? 0);
}

// ------------------------------ Cierre deportivo de temporada ------------------------------

export type SeasonSummary = {
  champion: Record<string, string>; // leagueId -> clubId
  promoted: string[];
  relegated: string[];
  playerPosition: number;
  topScorer: { name: string; club: string; goals: number } | null;
  bestPlayer: { name: string; club: string; rating: number } | null;
  bestYoung: { name: string; club: string; age: number; score: number } | null;
};

export function finishSeasonSporting(state: GameState): SeasonSummary {
  const sl = state.seasonLive!;
  const label = SEASON_LABELS[sl.seasonIdx];
  const champion: Record<string, string> = {};
  const promoted: string[] = [];
  const relegated: string[] = [];

  // Registrar historia y campeones por liga
  for (const lg of state.leagues) {
    const table = sortTable(sl.tables[lg.id]);
    if (table.length === 0) continue;
    champion[lg.id] = table[0].clubId;
    if (!state.champions[lg.id]) state.champions[lg.id] = [];
    state.champions[lg.id].push(state.clubs[table[0].clubId].name);

    table.forEach((row, i) => {
      const club = state.clubs[row.clubId];
      const titles: string[] = [];
      if (i === 0 && lg.division === 1) titles.push(lg.name);
      const cupWins = sl.cups.filter((c) => c.winner === club.id);
      titles.push(...cupWins.map((c) => c.name));
      club.history.push({
        season: label,
        leagueId: lg.id,
        division: lg.division,
        position: i + 1,
        points: row.points,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        gf: row.gf,
        ga: row.ga,
        cupResult: sl.cupResultText[club.id] ?? '—',
        continental: '',
        titles,
      });
      // coeficiente continental: decae y suma por posición
      club.continentalCoeff = club.continentalCoeff * 0.8 + Math.max(0, (lg.clubIds.length - i)) * (lg.division === 1 ? 0.6 : 0.1);
    });
  }

  // Ascensos y descensos por país (directos; simplificación documentada)
  for (const country of [...new Set(state.leagues.map((l) => l.country))]) {
    const divs = [1, 2, 3].map((d) => state.leagues.find((l) => l.country === country && l.division === d)).filter(Boolean) as League[];
    for (let i = 0; i < divs.length - 1; i++) {
      const upper = divs[i];
      const lower = divs[i + 1];
      const n = upper.relegations;
      const upTable = sortTable(sl.tables[upper.id]);
      const downTable = sortTable(sl.tables[lower.id]);
      const goingDown = upTable.slice(-n).map((r) => r.clubId);
      const goingUp = downTable.slice(0, n).map((r) => r.clubId);
      for (const id of goingDown) {
        const c = state.clubs[id];
        c.leagueId = lower.id; c.division = lower.division;
        relegated.push(id);
      }
      for (const id of goingUp) {
        const c = state.clubs[id];
        c.leagueId = upper.id; c.division = upper.division;
        promoted.push(id);
      }
    }
  }
  // Reconstruir las listas de cada liga desde el estado final de los clubes
  // (evita inconsistencias cuando hay movimientos encadenados div1↔div2↔div3).
  for (const lg of state.leagues) {
    lg.clubIds = Object.values(state.clubs).filter((c) => c.leagueId === lg.id).map((c) => c.id);
  }

  // Premios de la liga del jugador
  const playerLeague = state.leagues.find((l) => l.clubIds.includes(state.clubId)) ?? state.leagues[0];
  const prevLeagueId = state.clubs[state.clubId].history[state.clubs[state.clubId].history.length - 1]?.leagueId ?? playerLeague.id;
  const leagueClubs = Object.values(state.clubs).filter((c) => c.history[c.history.length - 1]?.leagueId === prevLeagueId);
  let topScorer: SeasonSummary['topScorer'] = null;
  let bestPlayer: SeasonSummary['bestPlayer'] = null;
  let bestYoung: SeasonSummary['bestYoung'] = null;
  for (const club of leagueClubs) {
    for (const p of club.squad) {
      if (!topScorer || p.seasonStats.goals > topScorer.goals) topScorer = { name: p.name, club: club.shortName, goals: p.seasonStats.goals };
      const score = p.seasonStats.rating * Math.min(1, p.seasonStats.apps / 25);
      if (!bestPlayer || score > bestPlayer.rating) bestPlayer = { name: p.name, club: club.shortName, rating: Number(score.toFixed(2)) };
      if (p.age <= 21 && p.seasonStats.apps >= 15) {
        const youngScore = p.seasonStats.rating * Math.min(1, p.seasonStats.apps / 30);
        if (!bestYoung || youngScore > bestYoung.score) bestYoung = { name: p.name, club: club.shortName, age: p.age, score: youngScore };
      }
    }
  }

  // Regresión de Elo a la media divisional (15%)
  for (const lg of state.leagues) {
    const clubs = lg.clubIds.map((id) => state.clubs[id]);
    const mean = clubs.reduce((a, c) => a + c.elo, 0) / Math.max(1, clubs.length);
    for (const c of clubs) c.elo += 0.15 * (mean - c.elo);
  }

  const playerTable = sortTable(sl.tables[prevLeagueId]);
  const playerPosition = playerTable.findIndex((r) => r.clubId === state.clubId) + 1;

  return { champion, promoted, relegated, playerPosition, topScorer, bestPlayer, bestYoung };
}
