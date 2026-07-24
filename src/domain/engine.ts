import { Rng, initRngState } from './rng';
import type { Difficulty, GameState, Manager, MatchResult, Moment } from './types';
import { SEASON_LABELS } from './types';
import { buildWorld, type EtlData } from './worldgen';
import { initSeason, advanceRound, seasonFinished, finishSeasonSporting, sortTable } from './season';
import { applySeasonFinance, advanceWorldEconomy } from './economy';
import { evolveSquad } from './development';
import { aiOffseason, forcedSale, replenishPlayerSquad } from './ai';
import { genObjectives, evaluateBiennium, updateFanMood } from './board';
import { maybeBuildMoment, seasonHeadline } from './events';

export const GAME_VERSION = '1.0.0';

// ------------------------------ Creación ------------------------------

export function createGame(
  etl: EtlData,
  opts: { seed: string; clubId: string; manager: Manager; difficulty: Difficulty },
): GameState {
  const rngState = initRngState(opts.seed);
  const rng = new Rng(rngState);
  const { clubs, leagues } = buildWorld(etl, rng, 1.0);

  const me = clubs[opts.clubId];
  const league = leagues.find((l) => l.clubIds.includes(me.id))!;
  const eloRank = [...league.clubIds].map((id) => clubs[id]).sort((a, b) => b.elo - a.elo).findIndex((c) => c.id === me.id) + 1;

  const state: GameState = {
    seed: opts.seed,
    version: GAME_VERSION,
    difficulty: opts.difficulty,
    clubId: opts.clubId,
    manager: opts.manager,
    currentBiennium: 1,
    currentSeason: 1,
    phase: 'planificacion',
    doctrine: [],
    prevDoctrine: [],
    boardTrust: 50,
    objectives: { sportive: '', sportiveTargetPos: 10, financial: '', soft: '' },
    clubs,
    leagues,
    marketIndex: 1.0,
    salesThisSeason: {},
    seasonLive: null,
    log: [],
    rng: rngState,
    champions: {},
    continentalChampions: [],
    managerTitles: [],
    fired: false,
    annals: [],
    legends: {},
    baseline: {
      elo: me.elo,
      prestige: me.prestige,
      squadValue: Number(me.squad.reduce((a, p) => a + p.value, 0).toFixed(1)),
      division: me.division,
      expectedPos: eloRank,
    },
  };

  applyBackground(state);
  state.objectives = genObjectives(state, rng);
  pushLog(state, 'hito', `Bienvenido a ${me.name}`, `${opts.manager.name} asume la dirección del club. Temporada ${SEASON_LABELS[0]}. La junta espera: ${state.objectives.sportive.toLowerCase()}.`);
  return state;
}

function applyBackground(state: GameState): void {
  const me = state.clubs[state.clubId];
  switch (state.manager.background) {
    case 'ídolo':
      me.fanbase.mood = Math.min(97, me.fanbase.mood + 15);
      state.boardTrust -= 10;
      break;
    case 'cantera':
      me.facilities.academy = Math.min(5, me.facilities.academy + 1);
      me.finances.cash = Number((me.finances.cash * 0.9).toFixed(1));
      break;
    case 'financiero':
      for (const s of me.sponsors) s.annual = Number((s.annual * 1.2).toFixed(1));
      me.prestige = Math.max(3, me.prestige - 3);
      break;
    case 'datos':
      me.facilities.dataDept = Math.min(5, me.facilities.dataDept + 2);
      me.fanbase.mood = Math.max(5, me.fanbase.mood - 8);
      break;
    case 'agente':
      me.finances.cash = Number((me.finances.cash + 25).toFixed(1));
      state.boardTrust -= 5;
      state.objectives.sportiveTargetPos = Math.max(1, state.objectives.sportiveTargetPos - 1);
      break;
  }
}

export function pushLog(state: GameState, kind: GameState['log'][number]['kind'], headline: string, body: string): void {
  state.log.unshift({
    season: SEASON_LABELS[state.currentSeason - 1] ?? '—',
    biennium: state.currentBiennium,
    headline,
    body,
    kind,
  });
  if (state.log.length > 400) state.log.pop();
}

// ------------------------------ Temporada ------------------------------

export function startSeason(state: GameState): void {
  initSeason(state);
  state.phase = state.currentSeason % 2 === 1 ? 'temporadaA' : 'temporadaB';
}

export type RoundOutcome = { results: MatchResult[]; moment: Moment | null; seasonOver: boolean };

export function stepRound(state: GameState): RoundOutcome {
  const results = advanceRound(state);
  const rng = new Rng(state.rng);
  let moment: Moment | null = null;
  if (!seasonFinished(state)) {
    moment = maybeBuildMoment(state, rng);
    if (moment) {
      state.seasonLive!.momentsFired++;
      state.seasonLive!.pendingMoment = moment;
    }
  }
  return { results, moment, seasonOver: seasonFinished(state) };
}

export function resolveMoment(state: GameState, optionIdx: number): string {
  const sl = state.seasonLive!;
  const moment = sl.pendingMoment;
  if (!moment) return '';
  const opt = moment.options[optionIdx] ?? moment.options[0];
  const rng = new Rng(state.rng);
  const me = state.clubs[state.clubId];
  let fx = opt.effects;
  let outcome = '';

  if (fx.riskyChance !== undefined) {
    const ok = rng.chance('event', fx.riskyChance);
    if (!ok && fx.failEffects) {
      fx = fx.failEffects;
      outcome = 'SALIÓ MAL. ';
    } else {
      outcome = fx.riskyChance < 1 ? 'Salió bien. ' : '';
    }
  }

  if (fx.cash) me.finances.cash = Number((me.finances.cash + fx.cash).toFixed(1));
  if (fx.addToxicSponsor) me.sponsors.push({ slot: 'manga', brand: 'BetMaxx', annual: fx.addToxicSponsor, yearsLeft: 3, toxic: true });
  if (fx.boardTrust) state.boardTrust = Math.max(0, Math.min(100, state.boardTrust + fx.boardTrust));
  if (fx.fanMood) me.fanbase.mood = Math.max(3, Math.min(97, me.fanbase.mood + fx.fanMood));
  if (fx.squadMorale) for (const p of me.squad) p.morale = Math.max(5, Math.min(97, p.morale + fx.squadMorale));
  if (fx.formBoost) sl.playerFormBoost += fx.formBoost;
  if (fx.sellPlayerId) {
    const p = me.squad.find((x) => x.id === fx.sellPlayerId);
    if (p) {
      me.squad = me.squad.filter((x) => x.id !== p.id);
      state.salesThisSeason[me.id] = Number(((state.salesThisSeason[me.id] ?? 0) + (fx.sellPrice ?? p.value)).toFixed(1));
      outcome += `${p.name} vendido. `;
    }
  }
  const note = fx.note ? ` ${fx.note}` : '';
  pushLog(state, 'vestuario', moment.title, `${outcome}Elegiste: "${opt.label}".${note}`);
  sl.pendingMoment = null;
  return `${outcome}${fx.note ?? 'Decisión tomada.'}`;
}

// ------------------------------ Cierre de temporada ------------------------------

export function endSeasonProcessing(state: GameState): void {
  const rng = new Rng(state.rng);
  const me = state.clubs[state.clubId];
  const summary = finishSeasonSporting(state);

  // finanzas de TODOS los clubes
  for (const club of Object.values(state.clubs)) {
    applySeasonFinance(state, club, state.salesThisSeason[club.id] ?? 0);
  }

  // evolución de planteles
  const totalRounds = state.seasonLive?.totalRounds ?? 34;
  for (const club of Object.values(state.clubs)) {
    const notes = evolveSquad(state, rng, club, totalRounds);
    if (club.id === state.clubId) for (const n of notes) pushLog(state, 'vestuario', 'Novedades del plantel', n);
  }

  // leyendas del club del jugador
  for (const p of me.squad) {
    if (p.seasonStats.apps < 5) continue;
    const entry = state.legends[p.id] ?? { name: p.name, position: p.position, apps: 0, goals: 0, ratingSum: 0, seasons: 0 };
    entry.apps += p.seasonStats.apps;
    entry.goals += p.seasonStats.goals;
    entry.ratingSum += p.seasonStats.rating;
    entry.seasons++;
    state.legends[p.id] = entry;
  }

  // IA de clubes rivales
  const aiNotes = aiOffseason(state, rng);
  for (const n of aiNotes.slice(0, 4)) pushLog(state, 'mundo', 'Mercado mundial', n);

  // el director deportivo mantiene el plantel del jugador con vida
  for (const n of replenishPlayerSquad(state, rng)) pushLog(state, 'mercado', 'Mercado del club', n);

  // humor de hinchada y confianza de la junta
  updateFanMood(state);
  const rec = me.history[me.history.length - 1];
  if (rec) {
    const titles = rec.titles.length;
    if (rec.division === 1 && rec.position <= state.objectives.sportiveTargetPos) state.boardTrust = Math.min(100, state.boardTrust + 6);
    else if (rec.division > 1 && me.division === 1) state.boardTrust = Math.min(100, state.boardTrust + 15);
    else state.boardTrust = Math.max(0, state.boardTrust - (rec.division === 1 && me.division > 1 ? 25 : 8));
    state.boardTrust = Math.min(100, state.boardTrust + titles * 10);
    state.managerTitles.push(...rec.titles);
    if (titles > 0) pushLog(state, 'hito', `¡TÍTULO! ${rec.titles.join(' + ')}`, `El club levanta ${rec.titles.join(' y ')} en ${rec.season}.`);
  }

  // prensa de fin de temporada
  pushLog(state, 'prensa', seasonHeadline(state, summary.playerPosition, rec?.division ?? 1), buildSeasonRecap(state, summary.playerPosition));
  if (summary.topScorer) pushLog(state, 'prensa', 'Premios de la liga', `Goleador: ${summary.topScorer.name} (${summary.topScorer.club}, ${summary.topScorer.goals}). Mejor jugador: ${summary.bestPlayer?.name ?? '—'}.`);

  // anales
  const pnl = me.finances.lastPnL;
  state.annals.push({
    season: SEASON_LABELS[state.currentSeason - 1],
    division: rec?.division ?? me.division,
    position: summary.playerPosition,
    points: rec?.points ?? 0,
    cash: me.finances.cash,
    squadValue: Number(me.squad.reduce((a, p) => a + p.value, 0).toFixed(1)),
    prestige: me.prestige,
    fanMood: me.fanbase.mood,
    boardTrust: state.boardTrust,
    wageBill: pnl?.wages ?? 0,
    revenue: Number(((pnl?.matchday ?? 0) + (pnl?.tv ?? 0) + (pnl?.commercial ?? 0) + (pnl?.prizes ?? 0) + (pnl?.playerSales ?? 0)).toFixed(1)),
    note: rec?.titles.join(', ') || '',
  });

  // insolvencia del club del jugador
  const prevCash = state.annals[state.annals.length - 2]?.cash ?? 1;
  if (me.finances.cash < 0 && prevCash < 0) {
    const note = forcedSale(state, rng, me);
    state.boardTrust = Math.max(0, state.boardTrust - 12);
    pushLog(state, 'institucional', 'INSOLVENCIA: venta forzada', note ?? 'El club no pudo evitar la quiebra técnica.');
    if (me.finances.cash < -80 && state.difficulty !== 'Sandbox') {
      state.phase = 'despido';
      state.fired = true;
      pushLog(state, 'hito', 'DESCENSO ADMINISTRATIVO', 'La deuda se volvió impagable. Intervención judicial: fin de tu gestión.');
      return;
    }
  }

  state.salesThisSeason = {};
  const wasA = state.currentSeason % 2 === 1;
  state.currentSeason++;
  state.seasonLive = null;
  state.phase = wasA ? 'entretiempo' : 'cierre';
}

function buildSeasonRecap(state: GameState, position: number): string {
  const me = state.clubs[state.clubId];
  const rec = me.history[me.history.length - 1];
  if (!rec) return '';
  return `${rec.season}: ${position}° en ${state.leagues.find((l) => l.id === rec.leagueId)?.name ?? 'la liga'} con ${rec.points} puntos (${rec.won}G ${rec.drawn}E ${rec.lost}P, ${rec.gf}-${rec.ga}). ${rec.cupResult !== '—' ? rec.cupResult + '.' : ''} Caja: ${me.finances.cash}M.`;
}

// ------------------------------ Cierre de bienio ------------------------------

export function closeBiennium(state: GameState): void {
  const rng = new Rng(state.rng);
  const me = state.clubs[state.clubId];
  const evalResult = evaluateBiennium(state);
  state.boardTrust = Math.max(0, Math.min(100, state.boardTrust + evalResult.trustDelta));

  pushLog(state, 'institucional', `Balance del bienio ${state.currentBiennium}`, `${evalResult.verdict} Objetivo deportivo: ${evalResult.sportiveOk ? 'CUMPLIDO' : 'INCUMPLIDO'}. Objetivo financiero: ${evalResult.financialOk ? 'CUMPLIDO' : 'INCUMPLIDO'}.`);

  if (state.boardTrust < 10 && state.difficulty !== 'Sandbox') {
    state.fired = true;
    state.phase = 'despido';
    pushLog(state, 'hito', 'DESPEDIDO', `La junta ejecutó la cláusula de salida tras ${state.currentBiennium} bienios. Confianza final: ${state.boardTrust}/100.`);
    return;
  }
  if (state.boardTrust < 20) {
    pushLog(state, 'institucional', 'Ultimátum de la junta', 'Un bienio más sin resultados y se termina el proyecto.');
  }

  const ecoNotes = advanceWorldEconomy(state, rng);
  for (const n of ecoNotes) pushLog(state, 'mundo', 'Economía mundial', n);

  state.prevDoctrine = state.doctrine;
  state.doctrine = [];
  state.currentBiennium++;

  if (state.currentBiennium > 15) {
    state.phase = 'legado';
    pushLog(state, 'hito', '30 AÑOS DESPUÉS', `${state.manager.name} cierra su era en ${me.name}. Es hora del veredicto de la historia.`);
    return;
  }
  state.objectives = genObjectives(state, rng);
  state.phase = 'planificacion';
  pushLog(state, 'institucional', `Arranca el bienio ${state.currentBiennium}`, `Nuevos objetivos: ${state.objectives.sportive}. ${state.objectives.financial}. Deseo de la junta: ${state.objectives.soft.toLowerCase()}.`);
}

// ------------------------------ Utilidades de UI ------------------------------

export function playerTable(state: GameState) {
  const me = state.clubs[state.clubId];
  const sl = state.seasonLive;
  if (!sl) return [];
  return sortTable(sl.tables[me.leagueId] ?? []);
}
