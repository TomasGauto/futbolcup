import { Rng } from './rng';
import type { Club, GameState, League, PnL } from './types';
import { SEASON_LABELS } from './types';
import { sortTable } from './season';

// ------------------------------ Asistencia y día de partido ------------------------------

export const PRICE_ELASTICITY = 0.45;

export function demand(club: Club, recentFormPts: number): number {
  const priceRef = 25 + club.prestige * 0.35;
  const d = 0.55
    + 0.30 * (club.prestige / 100)
    + 0.25 * ((club.fanbase.mood - 50) / 50)
    + 0.15 * recentFormPts // 0..1 (puntos recientes normalizados)
    - PRICE_ELASTICITY * (club.stadium.ticketPrice / priceRef - 1);
  return Math.max(0.15, Math.min(1.05, d));
}

export function attendance(club: Club, recentFormPts = 0.5): number {
  const effCapacity = club.stadium.works ? Math.round(club.stadium.capacity * 0.8) : club.stadium.capacity;
  const qualityPenalty = club.stadium.quality < 40 ? 0.85 : 1;
  return Math.round(effCapacity * Math.min(1, demand(club, recentFormPts)) * qualityPenalty);
}

// ------------------------------ P&L de temporada ------------------------------

function positionOf(state: GameState, club: Club): { pos: number; n: number; league: League } {
  const rec = club.history[club.history.length - 1];
  const league = state.leagues.find((l) => l.id === rec?.leagueId) ?? state.leagues.find((l) => l.clubIds.includes(club.id))!;
  return { pos: rec?.position ?? 10, n: Math.max(league.clubIds.length, 2), league };
}

export function computeSeasonPnL(state: GameState, club: Club): PnL {
  const { pos, n, league } = positionOf(state, club);
  const rec = club.history[club.history.length - 1];
  const homeGames = Math.max(1, Math.round((rec?.played ?? 34) / 2));
  const formPts = rec ? rec.points / (rec.played * 3) : 0.4;

  const att = attendance(club, formPts);
  const perCapita = club.stadium.ticketPrice * 1.45; // entrada + consumo + hospitality
  const matchday = (att * perCapita * homeGames) / 1e6;

  const posMult = 1.25 - 0.8 * ((pos - 1) / (n - 1));
  const tv = league.tvBase * league.tvCycleMult * posMult * (league.division === 1 ? 1 : 1) / (league.division === 1 ? 1 : league.division === 2 ? 1 : 1);

  const sponsorIncome = club.sponsors.reduce((a, s) => a + s.annual, 0)
    + (club.stadium.namingRights?.annual ?? 0);
  const merch = (club.fanbase.size / 1e6) * (8 + club.prestige * 0.3) * state.marketIndex;
  const commercial = sponsorIncome + merch + (club.facilities.womensTeam ? 1.5 : 0);

  const prizes = (state.seasonLive?.prizes[club.id] ?? 0)
    + Math.max(0, (n - pos)) * (league.division === 1 ? 1.6 : 0.3); // premio por posición de liga

  const wages = club.squad.reduce((a, p) => a + p.contract.wage, 0) * 1.12; // + staff
  const amortization = club.amortPool.reduce((a, x) => a + x.annual, 0);
  const maintenance = club.stadium.capacity / 1e6 * 17 + club.stadium.maintenanceDebt * 0.05
    + (club.facilities.academy + club.facilities.medical + club.facilities.training + club.facilities.scouting + club.facilities.dataDept) * 0.7;
  const interest = club.debt.reduce((a, d) => a + d.principal * d.rate, 0);
  const operating = 3 + club.prestige * 0.1 + (league.division === 1 ? 3 : 1);

  const income = matchday + tv + commercial + prizes;
  const costs = wages + amortization + maintenance + interest + operating;
  return {
    season: SEASON_LABELS[state.currentSeason - 1] ?? '?',
    matchday: r1(matchday), tv: r1(tv), commercial: r1(commercial), prizes: r1(prizes),
    playerSales: 0,
    wages: r1(wages), amortization: r1(amortization), maintenance: r1(maintenance),
    interest: r1(interest), operating: r1(operating),
    net: r1(income - costs),
  };
}

const r1 = (x: number) => Number(x.toFixed(1));

const RATING_ORDER = ['CCC', 'B', 'BB', 'BBB', 'A', 'AA', 'AAA'] as const;

export function applySeasonFinance(state: GameState, club: Club, playerSales: number): PnL {
  const pnl = computeSeasonPnL(state, club);
  pnl.playerSales = r1(playerSales);
  pnl.net = r1(pnl.net + playerSales);
  // la caja de las ventas ya se acreditó al momento de vender: acá solo entra el resto
  club.finances.cash = r1(club.finances.cash + pnl.net - playerSales);
  club.finances.lastPnL = pnl;
  club.finances.ffpWindow.push(pnl.net);
  if (club.finances.ffpWindow.length > 3) club.finances.ffpWindow.shift();

  // deuda: amortización anual del principal
  for (const d of club.debt) {
    const cuota = d.principal / Math.max(1, d.yearsLeft);
    d.principal = r1(d.principal - cuota);
    d.yearsLeft--;
    club.finances.cash = r1(club.finances.cash - cuota);
  }
  club.debt = club.debt.filter((d) => d.yearsLeft > 0 && d.principal > 0.1);

  // amortización de fichajes
  for (const a of club.amortPool) a.yearsLeft--;
  club.amortPool = club.amortPool.filter((a) => a.yearsLeft > 0);

  // sponsors: contratos que expiran
  for (const s of club.sponsors) s.yearsLeft--;
  club.sponsors = club.sponsors.filter((s) => s.yearsLeft > 0);
  if (club.stadium.namingRights) {
    club.stadium.namingRights.yearsLeft--;
    if (club.stadium.namingRights.yearsLeft <= 0) club.stadium.namingRights = undefined;
  }

  // obras
  if (club.stadium.works) {
    club.stadium.works.seasonsLeft--;
    if (club.stadium.works.seasonsLeft <= 0) {
      club.stadium.capacity += club.stadium.works.capacityDelta;
      club.stadium.quality = Math.min(98, club.stadium.quality + club.stadium.works.qualityDelta);
      club.stadium.works = undefined;
    }
  }

  // mantenimiento diferido degrada el estadio
  if (club.stadium.maintenanceDebt > 0) {
    club.stadium.quality = Math.max(15, club.stadium.quality - Math.min(6, club.stadium.maintenanceDebt / 10));
  }

  // rating crediticio según caja y deuda
  const debtTotal = club.debt.reduce((a, d) => a + d.principal, 0);
  const income = pnl.matchday + pnl.tv + pnl.commercial + pnl.prizes;
  const leverage = income > 0 ? debtTotal / income : 5;
  const cashOk = club.finances.cash > 0 ? 1 : -2;
  const idx = Math.max(0, Math.min(6, Math.round(4 + cashOk - leverage * 1.5 + (pnl.net > 0 ? 1 : -1))));
  club.finances.creditRating = RATING_ORDER[idx];

  // FFP: pérdidas acumuladas de 3 temporadas
  const window = club.finances.ffpWindow;
  const acc = window.reduce((a, b) => a + Math.min(0, b), 0);
  const threshold = -(30 + club.prestige * 0.6); // clubes grandes tienen más margen
  if (window.length >= 2 && acc < threshold) {
    club.finances.ffpSanction = Math.min(4, club.finances.ffpSanction + 1);
  } else if (acc > threshold * 0.4) {
    club.finances.ffpSanction = Math.max(0, club.finances.ffpSanction - 1);
  }
  return pnl;
}

/** Índice de mercado global: ~5% anual con ruido; ciclos de TV cada 3 temporadas. */
export function advanceWorldEconomy(state: GameState, rng: Rng): string[] {
  const notes: string[] = [];
  state.marketIndex = Number((state.marketIndex * (1.05 + rng.normal('world', 0, 0.015))).toFixed(3));

  if (state.currentSeason % 3 === 0) {
    for (const lg of state.leagues.filter((l) => l.division === 1)) {
      const change = 0.9 + rng.next('world') * 0.45; // -10% a +35%
      lg.tvCycleMult = Number((lg.tvCycleMult * change).toFixed(2));
      if (change > 1.2) notes.push(`${lg.name}: nuevo ciclo de TV récord (+${Math.round((change - 1) * 100)}%).`);
      else if (change < 0.97) notes.push(`${lg.name}: los derechos de TV se achican (${Math.round((change - 1) * 100)}%).`);
    }
  }

  // shocks históricos (prob. baja por temporada)
  const roll = rng.next('world');
  if (roll < 0.03) {
    for (const c of Object.values(state.clubs)) c.finances.cash = r1(c.finances.cash * 0.97);
    for (const lg of state.leagues) lg.tvCycleMult *= 0.92;
    notes.push('CRISIS ECONÓMICA GLOBAL: caen ingresos comerciales y de TV en todo el mundo.');
  } else if (roll < 0.055) {
    for (const lg of state.leagues.filter((l) => l.division === 1)) lg.tvCycleMult *= 1.15;
    notes.push('Boom del streaming: los derechos audiovisuales explotan.');
  }
  return notes;
}
