import { Rng } from './rng';
import type { DoctrineAxis, GameState, Sponsor } from './types';
import { SPONSOR_BRANDS } from './constants';

// Decisiones estructurales de la Fase de Planificación (una vez por bienio).
// Cada acción declara costo real; la doctrina abarata su eje 25% y encarece el resto 15%.

const AXIS_OF_CATEGORY: Record<string, DoctrineAxis> = {
  academy: 'cantera', training: 'cantera', medical: 'proyecto', scouting: 'fichajes',
  dataDept: 'fichajes', stadium: 'estadio', sponsor: 'comercial', debt: 'saneamiento',
  coach: 'proyecto', tour: 'comercial',
};

export function costMult(state: GameState, category: string): number {
  if (state.doctrine.length === 0) return 1;
  const axis = AXIS_OF_CATEGORY[category];
  if (!axis) return 1;
  return state.doctrine.includes(axis) ? 0.75 : 1.15;
}

export function setDoctrine(state: GameState, axes: DoctrineAxis[]): string {
  const changed = state.prevDoctrine.length > 0 && axes.some((a) => !state.prevDoctrine.includes(a));
  state.doctrine = axes;
  const me = state.clubs[state.clubId];
  if (changed) {
    me.identity = Math.max(5, me.identity - 12);
    return 'Doctrina fijada. Cambiar de rumbo cada bienio erosiona la identidad del club (−12).';
  }
  me.identity = Math.min(100, me.identity + 6);
  return 'Doctrina fijada. Mantener el rumbo refuerza la identidad del club (+6).';
}

// ------------------------------ Estadio ------------------------------

export type StadiumProject = { key: string; label: string; cost: number; seasons: number; capacityDelta: number; qualityDelta: number };

export function stadiumProjects(state: GameState): StadiumProject[] {
  const me = state.clubs[state.clubId];
  const m = costMult(state, 'stadium') * state.marketIndex;
  return [
    { key: 'small', label: 'Ampliación +5.000', cost: Math.round(28 * m), seasons: 1, capacityDelta: 5000, qualityDelta: 3 },
    { key: 'medium', label: 'Ampliación +15.000', cost: Math.round(85 * m), seasons: 1, capacityDelta: 15000, qualityDelta: 6 },
    { key: 'big', label: 'Ampliación +30.000', cost: Math.round(190 * m), seasons: 2, capacityDelta: 30000, qualityDelta: 10 },
    { key: 'remodel', label: 'Remodelación VIP + hospitality', cost: Math.round(45 * m), seasons: 1, capacityDelta: 0, qualityDelta: 15 },
    { key: 'new', label: `Estadio nuevo (${Math.round(me.stadium.capacity * 1.5 / 1000)}k, proyecto faraónico)`, cost: Math.round(420 * m), seasons: 4, capacityDelta: Math.round(me.stadium.capacity * 0.5), qualityDelta: 40 },
  ];
}

export function startStadiumWorks(state: GameState, project: StadiumProject, financeWithDebt: boolean): string {
  const me = state.clubs[state.clubId];
  if (me.stadium.works) return 'Ya hay una obra en curso.';
  if (!financeWithDebt && me.finances.cash < project.cost) return `No alcanza la caja (${project.cost}M). Podés financiarla con deuda.`;
  if (financeWithDebt) {
    const rate = rateFor(me.finances.creditRating) + 0.01;
    me.debt.push({ label: `Obra: ${project.label}`, principal: project.cost, rate, yearsLeft: 10 });
  } else {
    me.finances.cash = Number((me.finances.cash - project.cost).toFixed(1));
  }
  me.stadium.works = { label: project.label, seasonsLeft: project.seasons, capacityDelta: project.capacityDelta, qualityDelta: project.qualityDelta };
  return `Obra iniciada: ${project.label}. ${project.seasons} temporada(s) con aforo reducido al 80%.`;
}

export function payMaintenance(state: GameState): string {
  const me = state.clubs[state.clubId];
  const owed = Math.max(4, me.stadium.maintenanceDebt + me.stadium.capacity / 1e6 * 6);
  if (me.finances.cash < owed) return `El mantenimiento cuesta ${owed.toFixed(1)}M y no hay caja.`;
  me.finances.cash = Number((me.finances.cash - owed).toFixed(1));
  me.stadium.maintenanceDebt = 0;
  me.stadium.quality = Math.min(98, me.stadium.quality + 2);
  return `Mantenimiento al día (−${owed.toFixed(1)}M). El estadio luce impecable.`;
}

// ------------------------------ Infraestructura ------------------------------

const FACILITY_LABEL: Record<string, string> = {
  academy: 'Academia', medical: 'Centro médico', training: 'Centro de entrenamiento', scouting: 'Red de scouting', dataDept: 'Departamento de datos',
};

export function facilityUpgradeCost(state: GameState, key: keyof typeof FACILITY_LABEL): number {
  const me = state.clubs[state.clubId];
  const level = me.facilities[key as 'academy'];
  return Math.round((8 + level * 9) * costMult(state, key) * state.marketIndex);
}

export function upgradeFacility(state: GameState, key: 'academy' | 'medical' | 'training' | 'scouting' | 'dataDept'): string {
  const me = state.clubs[state.clubId];
  const level = me.facilities[key];
  if (level >= 5) return `${FACILITY_LABEL[key]} ya está al máximo.`;
  const cost = facilityUpgradeCost(state, key);
  if (me.finances.cash < cost) return `Mejorar ${FACILITY_LABEL[key]} cuesta ${cost}M: no alcanza.`;
  me.finances.cash = Number((me.finances.cash - cost).toFixed(1));
  me.facilities[key]++;
  return `${FACILITY_LABEL[key]} mejorado a nivel ${level + 1} (−${cost}M).`;
}

// ------------------------------ Comercial ------------------------------

export function genSponsorOffers(state: GameState, rng: Rng, slot: Sponsor['slot']): Sponsor[] {
  const me = state.clubs[state.clubId];
  const base = slot === 'naming' ? 4 + me.prestige * 0.28 : slot === 'camiseta' ? 2 + me.prestige * me.prestige * 0.006 : 1 + me.prestige * 0.08;
  const m = state.marketIndex * (2 - costMult(state, 'sponsor')); // doctrina comercial mejora ofertas
  const offers: Sponsor[] = [];
  const n = rng.int('market', 3, 5);
  for (let i = 0; i < n; i++) {
    const toxic = i === n - 1 || rng.chance('market', 0.25);
    offers.push({
      slot,
      brand: toxic ? rng.pick('market', SPONSOR_BRANDS.toxic) : rng.pick('market', SPONSOR_BRANDS.normal),
      annual: Number((base * m * (toxic ? 1.55 : 1) * (0.8 + rng.next('market') * 0.5)).toFixed(1)),
      yearsLeft: rng.int('market', 2, 5),
      toxic,
    });
  }
  return offers.sort((a, b) => b.annual - a.annual);
}

export function signSponsor(state: GameState, offer: Sponsor): string {
  const me = state.clubs[state.clubId];
  if (offer.slot === 'naming') {
    me.stadium.namingRights = { sponsor: offer.brand, annual: offer.annual, yearsLeft: offer.yearsLeft };
  } else {
    me.sponsors = me.sponsors.filter((s) => s.slot !== offer.slot);
    me.sponsors.push(offer);
  }
  if (offer.toxic) {
    me.fanbase.mood = Math.max(5, me.fanbase.mood - 8);
    return `Firmado ${offer.brand}: ${offer.annual}M/año por ${offer.yearsLeft} años. La hinchada NO lo festeja (−8 humor).`;
  }
  return `Firmado ${offer.brand}: ${offer.annual}M/año por ${offer.yearsLeft} años.`;
}

export function setTicketPrice(state: GameState, price: number): string {
  const me = state.clubs[state.clubId];
  const old = me.stadium.ticketPrice;
  me.stadium.ticketPrice = price;
  const deltaPct = (price - old) / old;
  if (deltaPct > 0.05) {
    me.fanbase.mood = Math.max(5, Math.round(me.fanbase.mood - deltaPct * 20));
    return `Entradas a ${price}. Subir precios enfría la popular (elasticidad 0.45: +20% precio ≈ −9% asistencia).`;
  }
  if (deltaPct < -0.05) {
    me.fanbase.mood = Math.min(97, Math.round(me.fanbase.mood - deltaPct * 15));
    return `Entradas a ${price}. La hinchada agradece el gesto.`;
  }
  return `Precio de entradas: ${price}.`;
}

export function preseasonTour(state: GameState): string {
  const me = state.clubs[state.clubId];
  const income = Number((8 + me.prestige * 0.3 * state.marketIndex).toFixed(1));
  me.finances.cash = Number((me.finances.cash + income * (2 - costMult(state, 'tour'))).toFixed(1));
  for (const p of me.squad) p.fitness = Math.max(60, p.fitness - 12);
  return `Gira por Asia y EE.UU.: +${income}M, pero el plantel arranca la temporada con menos nafta.`;
}

// ------------------------------ Deuda ------------------------------

export function rateFor(rating: string): number {
  const map: Record<string, number> = { AAA: 0.03, AA: 0.04, A: 0.05, BBB: 0.065, BB: 0.085, B: 0.11, CCC: 0.16 };
  return map[rating] ?? 0.09;
}

export function takeLoan(state: GameState, amount: number, years: number): string {
  const me = state.clubs[state.clubId];
  const rate = rateFor(me.finances.creditRating) * costMult(state, 'debt');
  me.debt.push({ label: `Préstamo bancario`, principal: amount, rate, yearsLeft: years });
  me.finances.cash = Number((me.finances.cash + amount).toFixed(1));
  return `Préstamo de ${amount}M a ${years} años, tasa ${(rate * 100).toFixed(1)}% (rating ${me.finances.creditRating}).`;
}

export function sellFutureTv(state: GameState): string {
  const me = state.clubs[state.clubId];
  const league = state.leagues.find((l) => l.clubIds.includes(me.id))!;
  const advance = Number((league.tvBase * league.tvCycleMult * 0.5 * 3 * 0.8).toFixed(1));
  me.finances.cash = Number((me.finances.cash + advance).toFixed(1));
  me.debt.push({ label: 'Venta anticipada de TV', principal: Number((advance * 1.25).toFixed(1)), rate: 0.0, yearsLeft: 3 });
  return `Adelanto de derechos de TV: +${advance}M hoy, hipotecando 3 años de ingresos (devolvés ${(advance * 1.25).toFixed(0)}M).`;
}

// ------------------------------ Cuerpo técnico ------------------------------

export function hireCoach(state: GameState, tier: 'joven' | 'consagrado' | 'estrella'): string {
  const me = state.clubs[state.clubId];
  const map = { joven: { q: 68, cost: 4 }, consagrado: { q: 78, cost: 12 }, estrella: { q: 88, cost: 30 } };
  const { q, cost } = map[tier];
  const realCost = Math.round(cost * costMult(state, 'coach') * state.marketIndex);
  if (me.finances.cash < realCost) return `Ese técnico cuesta ${realCost}M entre cláusula y salario: no alcanza.`;
  me.finances.cash = Number((me.finances.cash - realCost).toFixed(1));
  me.coachQuality = q;
  return `Nuevo director técnico (calidad ${q}) por ${realCost}M.`;
}

export function changePhilosophy(state: GameState, phil: typeof PHILOSOPHY_LIST[number]): string {
  const me = state.clubs[state.clubId];
  if (me.philosophy === phil) return `Ya jugás con ${phil}.`;
  me.philosophy = phil;
  if (state.seasonLive) state.seasonLive.playerFormBoost -= 0.01;
  for (const p of me.squad) p.morale = Math.max(20, p.morale - 4);
  return `Filosofía cambiada a ${phil}. La adaptación cuesta rendimiento por una temporada.`;
}

export const PHILOSOPHY_LIST = ['posesión', 'presión alta', 'contragolpe', 'bloque bajo', 'juego directo'] as const;
