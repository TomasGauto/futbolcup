import { Rng } from './rng';
import type { Club, GameState, Player, Position } from './types';
import { genPlayer } from './playergen';
import { fairWage, playerValue } from './valuation';
import { leagueMultFor } from './development';

// Mercado de pases del club del JUGADOR: scouting, negociación, ventas, renovaciones.

export type TransferTarget = {
  player: Player;
  fromClubId: string | null; // null = mercado exterior
  askingPrice: number;
  scoutedPotential: number; // lo que ve tu scouting (puede estar inflado si es malo)
  interest: number; // 0-100: ganas del jugador de venir
};

export function askingPriceFor(p: Player, seller: Club | null, rng: Rng): number {
  const needMult = seller ? (seller.finances.cash < 5 ? 0.85 : seller.aiProfile === 'mecenas' ? 1.5 : 1.2) : 1.1;
  const starMult = p.overall >= 84 ? 1.35 : 1;
  const wantsOut = p.wantsToLeave ? 0.8 : 1;
  return Number((p.value * needMult * starMult * wantsOut * (0.95 + rng.next('market') * 0.2)).toFixed(1));
}

export function scoutTargets(
  state: GameState,
  rng: Rng,
  opts: { position?: Position; maxPrice?: number; minOverall?: number },
): TransferTarget[] {
  const me = state.clubs[state.clubId];
  const scoutLevel = me.facilities.scouting + me.facilities.dataDept * 0.5;
  const out: TransferTarget[] = [];

  // candidatos de clubes del mundo
  const pool: { p: Player; from: Club }[] = [];
  for (const club of Object.values(state.clubs)) {
    if (club.id === me.id) continue;
    for (const p of club.squad) {
      if (opts.position && p.position !== opts.position) continue;
      if (opts.minOverall && p.overall < opts.minOverall) continue;
      pool.push({ p, from: club });
    }
  }
  const sorted = pool.sort((a, b) => b.p.overall - a.p.overall);
  const picks = rng.shuffle('market', sorted.slice(0, 120)).slice(0, 8 + Math.round(scoutLevel * 2));
  for (const { p, from } of picks) {
    const asking = askingPriceFor(p, from, rng);
    if (opts.maxPrice && asking > opts.maxPrice) continue;
    const prestigeDiff = me.prestige - from.prestige;
    const interest = Math.max(5, Math.min(98, Math.round(
      50 + prestigeDiff * 0.6 + (p.wantsToLeave ? 25 : 0) + (me.division === 1 ? 10 : -25) + rng.int('market', -10, 10),
    )));
    out.push({ player: p, fromClubId: from.id, askingPrice: asking, scoutedPotential: scoutPotential(rng, p, scoutLevel), interest });
  }

  // mercado exterior (generados): más opciones si tu scouting es bueno
  const nExt = 3 + Math.round(scoutLevel);
  for (let i = 0; i < nExt; i++) {
    const positions: Position[] = opts.position ? [opts.position] : ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
    const targetOv = (opts.minOverall ?? 66) + rng.int('market', 0, 8);
    const p = genPlayer(rng, {
      country: me.country, position: rng.pick('market', positions), targetOverall: targetOv,
      leagueMult: leagueMultFor(me), prestige: me.prestige, marketIndex: state.marketIndex,
    });
    const asking = Number((p.value * (1 + rng.next('market') * 0.2)).toFixed(1));
    if (opts.maxPrice && asking > opts.maxPrice) continue;
    out.push({
      player: p, fromClubId: null, askingPrice: asking,
      scoutedPotential: scoutPotential(rng, p, scoutLevel),
      interest: Math.max(20, Math.min(95, 60 + (me.prestige - 50) / 2 + rng.int('market', -8, 8))),
    });
  }
  return out.sort((a, b) => b.player.overall - a.player.overall);
}

function scoutPotential(rng: Rng, p: Player, scoutLevel: number): number {
  const noise = Math.max(0, 7 - scoutLevel) * rng.next('market');
  return Math.round(p.potential + noise); // scouting flojo = potencial inflado ("fichaje fantasma")
}

export type SigningResult = { ok: boolean; message: string; feePaid?: number };

export function attemptSigning(
  state: GameState,
  rng: Rng,
  target: TransferTarget,
  offer: { fee: number; wage: number; years: number; installments: boolean },
): SigningResult {
  const me = state.clubs[state.clubId];
  if (me.finances.ffpSanction >= 3) return { ok: false, message: 'Sanción de FFP vigente: tenés prohibido fichar esta temporada.' };
  const upfront = offer.installments ? offer.fee * 0.4 : offer.fee;
  if (upfront > me.finances.cash) return { ok: false, message: `No te alcanza la caja: necesitás ${upfront.toFixed(1)}M al contado.` };

  const p = target.player;
  const feeRatio = offer.fee / Math.max(0.1, target.askingPrice);
  const fair = fairWage(p, leagueMultFor(me), me.prestige);
  const wageRatio = offer.wage / Math.max(0.05, fair);

  // el club vendedor acepta?
  const sellerOk = target.fromClubId === null || feeRatio >= 0.92 || (feeRatio >= 0.8 && rng.chance('market', (feeRatio - 0.7) * 2));
  if (!sellerOk) return { ok: false, message: `${state.clubs[target.fromClubId!].name} rechazó la oferta: piden cerca de ${target.askingPrice}M.` };

  // el jugador acepta? (proyecto + salario + interés previo)
  const mercMult = p.traits.includes('mercenario') ? 1.6 : 1;
  const pAccept = Math.min(0.97, (target.interest / 100) * Math.min(1.4, Math.pow(wageRatio, mercMult)) * (offer.installments ? 0.98 : 1));
  if (!rng.chance('market', pAccept)) {
    return { ok: false, message: `${p.name} rechazó tu propuesta: ${wageRatio < 1 ? 'el salario no lo convence' : 'no lo seduce el proyecto'}.` };
  }

  // transferencia efectiva
  if (target.fromClubId) {
    const from = state.clubs[target.fromClubId];
    from.squad = from.squad.filter((x) => x.id !== p.id);
    from.finances.cash = Number((from.finances.cash + offer.fee).toFixed(1));
  }
  me.finances.cash = Number((me.finances.cash - upfront).toFixed(1));
  if (offer.installments) {
    me.debt.push({ label: `Cuotas por ${p.name}`, principal: Number((offer.fee * 0.6).toFixed(1)), rate: 0.02, yearsLeft: 3 });
  }
  me.amortPool.push({ annual: Number((offer.fee / offer.years).toFixed(1)), yearsLeft: offer.years });
  p.contract = { yearsLeft: offer.years, wage: offer.wage };
  p.yearsAtClub = 0;
  p.morale = 78;
  p.wantsToLeave = false;
  p.homegrown = false;
  p.traits = p.traits.filter((t) => t !== 'ídolo' && t !== 'cantera');
  me.squad.push(p);
  return { ok: true, message: `¡${p.name} es nuevo jugador del club! ${offer.fee.toFixed(1)}M${offer.installments ? ' (40% contado + cuotas)' : ''}, ${offer.years} años.`, feePaid: offer.fee };
}

export type SaleOffer = { buyerName: string; amount: number };

export function offersFor(state: GameState, rng: Rng, p: Player): SaleOffer[] {
  const me = state.clubs[state.clubId];
  const n = p.overall >= 80 ? 3 : p.overall >= 72 ? 2 : rng.chance('market', 0.7) ? 1 : 0;
  const offers: SaleOffer[] = [];
  const buyers = Object.values(state.clubs)
    .filter((c) => c.id !== me.id && c.division === 1 && c.finances.cash > p.value * 0.8)
    .sort((a, b) => b.finances.cash - a.finances.cash);
  for (let i = 0; i < n; i++) {
    const buyer = buyers[rng.int('market', 0, Math.min(12, buyers.length - 1))];
    const mult = 0.8 + rng.next('market') * 0.5 + (p.wantsToLeave ? -0.1 : 0);
    offers.push({ buyerName: buyer ? buyer.name : 'Liga del Golfo', amount: Number((p.value * mult).toFixed(1)) });
  }
  if (p.overall >= 78 && rng.chance('market', 0.25)) {
    offers.push({ buyerName: 'Al-Qimma SC (Golfo)', amount: Number((p.value * (1.4 + rng.next('market') * 0.6)).toFixed(1)) });
  }
  return offers.sort((a, b) => b.amount - a.amount);
}

export function executeSale(state: GameState, p: Player, offer: SaleOffer): string {
  const me = state.clubs[state.clubId];
  me.squad = me.squad.filter((x) => x.id !== p.id);
  me.finances.cash = Number((me.finances.cash + offer.amount).toFixed(1));
  state.salesThisSeason[me.id] = Number(((state.salesThisSeason[me.id] ?? 0) + offer.amount).toFixed(1));
  const isIdol = p.traits.includes('ídolo');
  if (isIdol) {
    me.fanbase.mood = Math.max(5, me.fanbase.mood - 18);
    me.fanbase.loyalty = Math.max(10, me.fanbase.loyalty - 6);
  }
  for (const mate of me.squad) mate.morale = Math.max(10, mate.morale - (isIdol ? 8 : 3));
  return `${p.name} vendido a ${offer.buyerName} por ${offer.amount}M.${isIdol ? ' La hinchada está DOLIDA: era el ídolo.' : ''}`;
}

export type RenewResult = { ok: boolean; message: string };

export function renewContract(state: GameState, rng: Rng, p: Player, years: number, wageOffer: number): RenewResult {
  const me = state.clubs[state.clubId];
  const fair = fairWage(p, leagueMultFor(me), me.prestige);
  const clauseMult = p.contract.releaseClause ? 1.15 : 1; // cláusula alta encarece renovar
  const needed = fair * clauseMult * (p.wantsToLeave ? 1.3 : 1);
  const ratio = wageOffer / needed;
  const pAccept = Math.min(0.97, Math.max(0.03, (ratio - 0.55) * 1.6 + p.morale / 400));
  if (!rng.chance('market', pAccept)) {
    p.morale = Math.max(5, p.morale - 6);
    return { ok: false, message: `${p.name} rechazó la renovación: pide alrededor de ${needed.toFixed(2)}M/año.` };
  }
  p.contract.yearsLeft = years;
  p.contract.wage = Number(wageOffer.toFixed(2));
  p.morale = Math.min(96, p.morale + 10);
  p.wantsToLeave = false;
  return { ok: true, message: `${p.name} renovó por ${years} años (${wageOffer.toFixed(2)}M/año).` };
}

export function setReleaseClause(p: Player, amount: number | undefined): void {
  p.contract.releaseClause = amount;
}

export function releasePlayer(state: GameState, p: Player): string {
  const me = state.clubs[state.clubId];
  const cost = p.contract.wage * p.contract.yearsLeft * 0.6;
  me.squad = me.squad.filter((x) => x.id !== p.id);
  me.finances.cash = Number((me.finances.cash - cost).toFixed(1));
  return `Rescindiste el contrato de ${p.name} pagando ${cost.toFixed(1)}M de indemnización.`;
}

/** Refuerzo del valor de mercado del plantel del jugador tras cada mercado. */
export function refreshPlayerClubValues(state: GameState): void {
  const me = state.clubs[state.clubId];
  for (const p of me.squad) p.value = playerValue(p, state.marketIndex);
}
