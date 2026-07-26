// Simulador de carrera de JUGADOR (estilo copero.com.ar/juegos/simulador-carrera):
// elegís tu origen, cada temporada llega UN evento con 2-3 opciones comparables
// (canteras, ofertas de clubes, préstamos, riesgos) y tu trayectoria queda trazada
// club por club hasta el retiro. Determinista por seed, usa los clubes reales del ETL.

import { Rng, initRngState, type RngState } from './rng';
import type { EtlData } from './worldgen';
import { getClubRivals } from './rivalries';

export type Chip = { t: string; tone: 'good' | 'bad' | 'warn' | 'muted' };

export type CareerClub = {
  id: string;
  name: string;
  leagueId: string;
  leagueName: string;
  country: string;
  division: number;
  elo: number;
  baseElo: number;
  prestige: number;
  /** coeficiente de la liga (95 Premier … 50 MLS): el Elo solo compara DENTRO de una liga */
  coeff: number;
  confed: string; // UEFA | CONMEBOL | CONCACAF | AFC | CAF
};

export type Stint = {
  clubId: string;
  clubName: string;
  startYear: number;
  endYear: number;
  apps: number;
  goals: number;
  titles: string[];
  loan: boolean;
  as: 'jugador' | 'dt';
};

export type SeasonRow = {
  year: number;
  clubId: string;
  clubName: string;
  role: string;
  apps: number;
  goals: number;
  rating: number;
  leaguePos: number;
  titles: string[];
  note: string;
};

export type CareerOption = {
  id: string;
  label: string;
  sub: string;
  clubId?: string;
  chips: Chip[];
  badge?: { t: string; tone: Chip['tone']; icon?: string };
};

export type CareerEvent = {
  kind: 'academia' | 'ofertas' | 'prestamo' | 'riesgo' | 'seleccion' | 'penal' | 'retiro' | 'dt-decision' | 'dt-ofertas' | 'dt-despido';
  title: string;
  body: string;
  options: CareerOption[];
};

/** Contexto de un penal decisivo pendiente: la final quedó empatada y vos pateás. */
export type PendingPenalty = {
  titleName: string; // el título que se define (ej. "Copa del Mundo 2030")
  competition: string; // etiqueta corta ("MUNDIAL", "COPA AMÉRICA", "COPA DE ITALIA"…)
  source: 'club' | 'nt'; // final de club o de selección
  clubName: string; // quién define (club o país)
  year: number; // temporada en que se juega la final
  fameGoal: number; // fama si convertís
  fameMiss: number; // fama que perdés si la erran
};

export type CareerState = {
  seed: string;
  rng: RngState;
  name: string;
  nationality: string;
  position: string;
  year: number;
  age: number;
  ability: number; // 1-99, nivel real
  potential: number;
  fame: number; // 0-100
  caps: number;
  intlGoals: number;
  clubId: string | null;
  firstClubId: string | null;
  promisedStarter: boolean; // la oferta aceptada prometía titularidad
  onLoan: boolean;
  loanFromId: string | null;
  suspendedSeasons: number;
  trainingBoost: number; // bonus de desarrollo próxima temporada
  formBoost: number; // bonus de rating próxima temporada
  clubs: Record<string, CareerClub>;
  stints: Stint[];
  seasons: SeasonRow[];
  titles: { year: number; title: string; clubName: string; as: 'jugador' | 'dt' }[];
  pendingEvent: CareerEvent;
  retired: boolean;
  retirementNote: string;
  /** fase de la carrera: jugador, o segunda vida como director técnico */
  phase: 'jugador' | 'dt';
  dtSkill: number; // nivel como entrenador, 1-99
  dtJustFired: boolean;
  /** bonus/castigo (en niveles) para la próxima temporada como DT, por decisiones de riesgo */
  dtEdgeBoost: number;
  /** los momentos que hacen a la historia: debut, hitos, fichajes, títulos, escándalos */
  moments: Moment[];
  /** títulos de eventos de riesgo ya mostrados: no se repiten en la misma carrera */
  usedEvents: string[];
  /** penal decisivo pendiente (final empatada): lo resuelve el próximo turno */
  pendingPenalty: PendingPenalty | null;
  /** hilo de selección: seguís disponible para tu país */
  ntActive: boolean;
  /** sos el capitán de la selección */
  isCaptain: boolean;
  /** clasificaste al próximo Mundial (lo definen las Eliminatorias) */
  ntQualified: boolean;
  /** año cuyo torneo de selección ya se resolvió por un evento interactivo (evita doble conteo con el de fondo) */
  ntHandledYear: number;
  /** premios individuales ganados: MVP de liga, Balón de Oro */
  awards: { year: number; award: string }[];
};

export type Moment = { year: number; icon: string; text: string };

function addMoment(state: CareerState, icon: string, text: string): void {
  state.moments.push({ year: state.year, icon, text });
}

const START_YEAR = 2026;
const POSITIONS = [
  'Arquero', 'Defensa central', 'Lateral', 'Mediocampista defensivo',
  'Mediocampista', 'Mediapunta', 'Extremo', 'Delantero',
] as const;
export type PlayerPosition = (typeof POSITIONS)[number];
export const POSITION_LIST = POSITIONS;

// Tasa de gol por posición (goles esperados por partido, base).
const GOAL_RATE: Record<string, number> = {
  Arquero: 0.001, 'Defensa central': 0.03, Lateral: 0.05, 'Mediocampista defensivo': 0.06,
  Mediocampista: 0.14, Mediapunta: 0.3, Extremo: 0.34, Delantero: 0.55,
  Defensor: 0.04, // compat con carreras guardadas del set viejo
};
// Posiciones ofensivas (suman goles con la selección).
const ATTACKING_POS = new Set(['Delantero', 'Extremo', 'Mediapunta', 'Mediocampista']);

// Fuerza de la selección (0–100): afecta convocatorias, goles internacionales y Mundial.
const NAT_STRENGTH: Record<string, number> = {
  // CONMEBOL
  Argentina: 90, Brasil: 90, Uruguay: 80, Colombia: 79, Chile: 74, Perú: 71, Paraguay: 70, Ecuador: 74, Bolivia: 62, Venezuela: 66,
  // UEFA
  Francia: 90, España: 88, Inglaterra: 87, Alemania: 86, Portugal: 86, Italia: 84, Países_Bajos: 84, Bélgica: 84,
  Croacia: 82, Dinamarca: 79, Suiza: 78, Serbia: 76, Austria: 75, Turquía: 75, Ucrania: 74, Suecia: 74, Noruega: 74,
  Polonia: 74, República_Checa: 73, Rusia: 72, Escocia: 71, Grecia: 71, Gales: 71, Irlanda: 70,
  // CONCACAF
  México: 76, Estados_Unidos: 74, Canadá: 72, Costa_Rica: 70, Jamaica: 68, Honduras: 66,
  // CAF
  Marruecos: 80, Senegal: 78, Nigeria: 76, Costa_de_Marfil: 76, Argelia: 76, Camerún: 74, Egipto: 74, Ghana: 74, Malí: 70, Sudáfrica: 68,
  // AFC / OFC
  Japón: 78, Corea_del_Sur: 76, Irán: 73, Australia: 72, Arabia_Saudita: 70, Qatar: 68,
};
export const NATIONALITIES = Object.keys(NAT_STRENGTH).map((k) => k.replace(/_/g, ' '));

// Bandera de cada selección: para festejar la Copa del Mundo "con el país", no con el club.
const NAT_FLAG: Record<string, string> = {
  Argentina: '🇦🇷', Brasil: '🇧🇷', Uruguay: '🇺🇾', Colombia: '🇨🇴', Chile: '🇨🇱', Perú: '🇵🇪',
  Paraguay: '🇵🇾', Ecuador: '🇪🇨', Bolivia: '🇧🇴', Venezuela: '🇻🇪',
  Francia: '🇫🇷', España: '🇪🇸', Inglaterra: '🇬🇧', Alemania: '🇩🇪', Portugal: '🇵🇹', Italia: '🇮🇹',
  'Países Bajos': '🇳🇱', Bélgica: '🇧🇪', Croacia: '🇭🇷', Dinamarca: '🇩🇰', Suiza: '🇨🇭', Serbia: '🇷🇸',
  Austria: '🇦🇹', Turquía: '🇹🇷', Ucrania: '🇺🇦', Suecia: '🇸🇪', Noruega: '🇳🇴', Polonia: '🇵🇱',
  'República Checa': '🇨🇿', Rusia: '🇷🇺', Escocia: '🇬🇧', Grecia: '🇬🇷', Gales: '🇬🇧', Irlanda: '🇮🇪',
  México: '🇲🇽', 'Estados Unidos': '🇺🇸', Canadá: '🇨🇦', 'Costa Rica': '🇨🇷', Jamaica: '🇯🇲', Honduras: '🇭🇳',
  Marruecos: '🇲🇦', Senegal: '🇸🇳', Nigeria: '🇳🇬', 'Costa de Marfil': '🇨🇮', Argelia: '🇩🇿', Camerún: '🇨🇲',
  Egipto: '🇪🇬', Ghana: '🇬🇭', Malí: '🇲🇱', Sudáfrica: '🇿🇦',
  Japón: '🇯🇵', 'Corea del Sur': '🇰🇷', Irán: '🇮🇷', Australia: '🇦🇺', 'Arabia Saudita': '🇸🇦', Qatar: '🇶🇦',
};
export function flagEmoji(nationality: string): string {
  return NAT_FLAG[nationality] ?? '🏳️';
}

const r1 = (x: number) => Number(x.toFixed(1));

// ------------------------------ Nivel de club y roles ------------------------------

export function clubLevel(c: CareerClub): number {
  // El Elo se calcula dentro de cada liga, así que solo compara clubes de la MISMA liga.
  // Para comparar entre ligas se pondera por el coeficiente: Premier (95) suma, MLS (50) resta.
  const leagueAdj = ((c.coeff ?? 78) - 80) * 0.28;
  return Math.round(72 + (c.elo - 1500) / 30 - (c.division - 1) * 5 + leagueAdj);
}

type Role = 'Titular indiscutido' | 'Titular' | 'Rotación' | 'Suplente';

function roleFor(ability: number, level: number, promisedStarter: boolean): Role {
  const diff = ability - level + (promisedStarter ? 3 : 0);
  if (diff >= 3) return 'Titular indiscutido';
  if (diff >= -2) return 'Titular';
  if (diff >= -7) return 'Rotación';
  return 'Suplente';
}

const ROLE_APPS: Record<Role, [number, number]> = {
  'Titular indiscutido': [36, 46], Titular: [28, 40], 'Rotación': [14, 26], Suplente: [2, 10],
};

function projectLabel(club: CareerClub, clubs: Record<string, CareerClub>): { t: string; tone: Chip['tone'] } {
  const peers = Object.values(clubs).filter((c) => c.leagueId === club.leagueId);
  const rank = peers.filter((c) => c.elo > club.elo).length + 1;
  if (club.division > 1) return { t: 'Pelea el ascenso', tone: 'warn' };
  if (rank <= 2) return { t: 'Candidato al título', tone: 'good' };
  if (rank <= 6) return { t: 'Pelea copas internacionales', tone: 'good' };
  if (rank <= 12) return { t: 'Media tabla', tone: 'muted' };
  return { t: 'Pelea el descenso', tone: 'bad' };
}

function wageLabel(level: number): string {
  if (level >= 84) return '€€€€';
  if (level >= 78) return '€€€';
  if (level >= 72) return '€€';
  return '€';
}

// ------------------------------ Creación ------------------------------

export function createCareer(
  etl: EtlData,
  opts: { name: string; nationality: string; position: PlayerPosition; seed: string },
): CareerState {
  const rngState = initRngState(opts.seed);
  const rng = new Rng(rngState);

  const clubs: Record<string, CareerClub> = {};
  for (const c of etl.clubs.filter((x) => x.division <= 2)) {
    const league = etl.leagues.find((l) => l.id === c.leagueId);
    const coeff = league?.coeff ?? 60;
    clubs[c.id] = {
      id: c.id, name: c.name, leagueId: c.leagueId,
      leagueName: c.division === 1 ? (league?.name ?? c.leagueId) : `Segunda de ${c.country}`,
      country: c.country, division: c.division,
      elo: c.elo, baseElo: c.elo, prestige: c.prestige,
      coeff: c.division === 1 ? coeff : coeff - 18,
      confed: league?.confederation ?? 'UEFA',
    };
  }

  const state: CareerState = {
    seed: opts.seed, rng: rngState,
    name: opts.name, nationality: opts.nationality, position: opts.position,
    year: START_YEAR, age: 16,
    ability: 58 + rng.int('world', 0, 6),
    potential: 74 + rng.int('world', 0, 22), // el techo es secreto: se descubre jugando
    fame: 5, caps: 0, intlGoals: 0,
    clubId: null, firstClubId: null,
    promisedStarter: false, onLoan: false, loanFromId: null,
    suspendedSeasons: 0, trainingBoost: 0, formBoost: 0,
    clubs, stints: [], seasons: [], titles: [],
    pendingEvent: { kind: 'academia', title: '', body: '', options: [] },
    retired: false, retirementNote: '',
    phase: 'jugador', dtSkill: 0, dtJustFired: false, dtEdgeBoost: 0,
    moments: [],
    usedEvents: [],
    pendingPenalty: null, ntActive: true, isCaptain: false, ntQualified: true, ntHandledYear: -1,
    awards: [],
  };
  state.pendingEvent = academyEvent(state, rng);
  return state;
}

// nacionalidad → país de liga en el mundo del juego (si existe, tu carrera arranca cerca de casa)
const NAT_TO_COUNTRY: Record<string, string> = {
  Argentina: 'Argentina', Brasil: 'Brasil', Francia: 'Francia', Inglaterra: 'Inglaterra',
  España: 'España', Alemania: 'Alemania', Italia: 'Italia', Portugal: 'Portugal',
  'Países Bajos': 'Holanda', México: 'México', 'Estados Unidos': 'Estados Unidos', Colombia: 'Colombia',
};

function academyEvent(state: CareerState, rng: Rng): CareerEvent {
  const div1 = Object.values(state.clubs).filter((c) => c.division === 1);
  const sorted = [...div1].sort((a, b) => clubLevel(b) - clubLevel(a));
  // Las tres canteras salen, en lo posible, de la liga de tu país: un pibe debutante
  // no arranca en la academia de un gigante extranjero, eso no pasa en la realidad.
  // Sólo se recurre al mercado global cuando tu país no tiene suficientes clubes de primera.
  const homeCountry = NAT_TO_COUNTRY[state.nationality];
  const home = homeCountry ? sorted.filter((c) => c.country === homeCountry) : [];
  const grande = home.length >= 3
    ? rng.pick('event', home.slice(0, 3))
    : rng.pick('event', sorted.slice(0, 10));
  const medio = home.length >= 8
    ? rng.pick('event', home.slice(3, 8))
    : rng.pick('event', sorted.slice(25, 55));
  const chico = home.length >= 12
    ? rng.pick('event', home.slice(8))
    : rng.pick('event', sorted.slice(65, Math.min(95, sorted.length)));
  const mk = (c: CareerClub, tier: 'grande' | 'medio' | 'chico'): CareerOption => ({
    id: `join:${c.id}`,
    label: c.name,
    sub: `${c.leagueName} · ${c.country}`,
    clubId: c.id,
    chips: tier === 'grande'
      ? [{ t: 'Formación de elite', tone: 'good' }, { t: 'Prestigio enorme', tone: 'good' }, { t: 'Difícil debutar', tone: 'bad' }]
      : tier === 'medio'
        ? [{ t: 'Buena formación', tone: 'good' }, { t: 'Camino al primer equipo', tone: 'good' }, { t: 'Club sin títulos recientes', tone: 'warn' }]
        : [{ t: 'Debut casi asegurado', tone: 'good' }, { t: 'Minutos desde joven', tone: 'good' }, { t: 'Formación básica', tone: 'warn' }],
  });
  return {
    kind: 'academia',
    title: 'Tres canteras te quieren',
    body: `${state.name}, ${state.age} años, ${state.position.toLowerCase()} ${state.nationality.toLowerCase() === 'argentina' ? 'argentino' : `de ${state.nationality}`}. Tres clubes te quieren en su proyecto juvenil. Dónde empieza todo define tu camino.`,
    options: [mk(grande, 'grande'), mk(medio, 'medio'), mk(chico, 'chico')],
  };
}

// ------------------------------ Temporada ------------------------------

function currentStint(state: CareerState): Stint {
  return state.stints[state.stints.length - 1];
}

function startStint(state: CareerState, clubId: string, loan: boolean): void {
  const c = state.clubs[clubId];
  state.stints.push({ clubId, clubName: c.name, startYear: state.year, endYear: state.year, apps: 0, goals: 0, titles: [], loan, as: state.phase });
  state.clubId = clubId;
  if (!state.firstClubId && !loan && state.phase === 'jugador') state.firstClubId = clubId;
}

function driftWorld(state: CareerState, rng: Rng): void {
  for (const c of Object.values(state.clubs)) {
    c.elo += rng.normal('world', 0, 22) + 0.12 * (c.baseElo - c.elo);
  }
}

/** Juega el clásico representativo de la temporada y lo convierte en un momento de carrera. */
function playRivalryMatches(state: CareerState, rng: Rng, club: CareerClub, involved: boolean): number {
  if (!involved) return 0;
  const rivals = getClubRivals(club, state.clubs);
  let fame = 0;
  for (const rivalry of rivals) {
    const rival = rivalry.club;
    const edge = (club.elo - rival.elo) / 700;
    const winChance = Math.max(0.18, Math.min(0.72, 0.43 + edge));
    const drawChance = 0.24;
    const roll = rng.next('match');
    if (roll < winChance) {
      fame += 2.4;
      addMoment(state, '⚔️', `Le ganaste el clásico al ${rival.name} (${state.year})`);
    } else if (roll < winChance + drawChance) {
      fame += 0.35;
      addMoment(state, '⚔️', `Empataste el clásico con ${rival.name} (${state.year})`);
    } else {
      fame -= 1.2;
      addMoment(state, '⚔️', `Perdiste el clásico contra ${rival.name} (${state.year})`);
    }
  }
  return fame;
}

/** Posición en la liga y campeones de la temporada, con el Elo como probabilidad. */
function leagueOutcome(state: CareerState, rng: Rng, clubId: string): { pos: number; wonLeague: boolean; wonCup: boolean; wonContinental: boolean } {
  const club = state.clubs[clubId];
  const peers = Object.values(state.clubs).filter((c) => c.leagueId === club.leagueId);
  const noisy = peers.map((c) => ({ c, v: c.elo + rng.normal('match', 0, 55) })).sort((a, b) => b.v - a.v);
  const pos = noisy.findIndex((x) => x.c.id === clubId) + 1;
  const wonLeague = pos === 1;

  // copa nacional: sorteo ponderado por Elo (más plano que la liga: la copa es traicionera)
  const cupWinner = weightedPick(rng, peers, (c) => Math.exp(c.elo / 170));
  const wonCup = cupWinner.id === clubId && club.division === 1;

  // continental: SOLO contra clubes de tu confederación (River no juega la Champions)
  let wonContinental = false;
  if (club.division === 1) {
    const myConfed = club.confed ?? 'UEFA';
    const eliteField = Object.values(state.clubs)
      .filter((c) => c.division === 1 && (c.confed ?? 'UEFA') === myConfed)
      .sort((a, b) => clubLevel(b) - clubLevel(a))
      .slice(0, myConfed === 'UEFA' ? 24 : 16);
    if (eliteField.some((c) => c.id === clubId)) {
      const winner = weightedPick(rng, eliteField, (c) => Math.exp((c.elo + ((c.coeff ?? 78) - 80) * 8) / 150));
      wonContinental = winner.id === clubId;
    }
  }
  return { pos, wonLeague, wonCup, wonContinental };
}

/** Nombre de la copa continental según la confederación del club. */
export function continentalName(club: CareerClub): string {
  const confed = club.confed ?? 'UEFA';
  if (confed === 'CONMEBOL') return 'Copa Libertadores';
  if (confed === 'CONCACAF') return 'Concacaf Champions Cup';
  if (confed === 'AFC') return 'AFC Champions League';
  if (confed === 'CAF') return 'CAF Champions League';
  return 'UEFA Champions League';
}

// ------------------------------ Penal decisivo (6 zonas, puro azar) ------------------------------

// 1 áng. sup. izq · 2 abajo izq · 3 medio alto · 4 raso al medio · 5 áng. sup. der · 6 abajo der
const PENALTY_ZONES: { id: number; label: string; hint: string; tone: Chip['tone'] }[] = [
  { id: 1, label: 'Ángulo superior izquierdo', hint: 'Imparable si entra… pero puede irse afuera', tone: 'warn' },
  { id: 2, label: 'Abajo, al palo izquierdo', hint: 'Seguro, pero el arquero llega si adivina', tone: 'muted' },
  { id: 3, label: 'Al medio, alto', hint: 'Si el arquero vuela, es gol', tone: 'muted' },
  { id: 4, label: 'Raso, al medio', hint: 'Casi siempre al arco; atajable con las piernas', tone: 'muted' },
  { id: 5, label: 'Ángulo superior derecho', hint: 'Imparable si entra… pero puede irse afuera', tone: 'warn' },
  { id: 6, label: 'Abajo, al palo derecho', hint: 'Seguro, pero el arquero llega si adivina', tone: 'muted' },
];

/** Resuelve el penal: el arquero se juega a una zona al azar. Puro azar (con leve riesgo de irse afuera en los ángulos altos). */
function resolvePenalty(rng: Rng, zone: number): { keeperZone: number; scored: boolean; offTarget: boolean; saved: boolean } {
  const keeperZone = rng.int('match', 1, 6);
  const topCorner = zone === 1 || zone === 5;
  const offTarget = topCorner && rng.chance('match', 0.12);
  const saved = !offTarget && keeperZone === zone;
  return { keeperZone, scored: !offTarget && !saved, offTarget, saved };
}

/** Arma el evento del penal decisivo a partir del contexto pendiente. */
function penaltyEvent(state: CareerState): CareerEvent {
  const p = state.pendingPenalty!;
  return {
    kind: 'penal',
    title: `Penal decisivo · ${p.competition}`,
    body: `La final quedó empatada y se define desde los doce pasos. Te toca a vos: si la metés, ${p.clubName} es campeón de ${p.titleName}. ¿A dónde la mandás?`,
    options: PENALTY_ZONES.map((z) => ({
      id: `pen:${z.id}`, label: z.label, sub: '', chips: [{ t: z.hint, tone: z.tone }],
    })),
  };
}

/** Marca una final como "a definir por penal" en vez de otorgar el título automáticamente. */
function deferToPenalty(state: CareerState, ctx: PendingPenalty): void {
  state.pendingPenalty = ctx;
}

// ------------------------------ Selección: confederaciones y torneos ------------------------------

type NatConfed = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC';
const NAT_CONFED: Record<string, NatConfed> = {
  Argentina: 'CONMEBOL', Brasil: 'CONMEBOL', Uruguay: 'CONMEBOL', Colombia: 'CONMEBOL', Chile: 'CONMEBOL', Perú: 'CONMEBOL', Paraguay: 'CONMEBOL', Ecuador: 'CONMEBOL', Bolivia: 'CONMEBOL', Venezuela: 'CONMEBOL',
  Francia: 'UEFA', España: 'UEFA', Inglaterra: 'UEFA', Alemania: 'UEFA', Portugal: 'UEFA', Italia: 'UEFA', 'Países Bajos': 'UEFA', Bélgica: 'UEFA', Croacia: 'UEFA', Dinamarca: 'UEFA', Suiza: 'UEFA', Serbia: 'UEFA', Austria: 'UEFA', Turquía: 'UEFA', Ucrania: 'UEFA', Suecia: 'UEFA', Noruega: 'UEFA', Polonia: 'UEFA', 'República Checa': 'UEFA', Rusia: 'UEFA', Escocia: 'UEFA', Grecia: 'UEFA', Gales: 'UEFA', Irlanda: 'UEFA',
  México: 'CONCACAF', 'Estados Unidos': 'CONCACAF', Canadá: 'CONCACAF', 'Costa Rica': 'CONCACAF', Jamaica: 'CONCACAF', Honduras: 'CONCACAF',
  Marruecos: 'CAF', Senegal: 'CAF', Nigeria: 'CAF', 'Costa de Marfil': 'CAF', Argelia: 'CAF', Camerún: 'CAF', Egipto: 'CAF', Ghana: 'CAF', Malí: 'CAF', Sudáfrica: 'CAF',
  Japón: 'AFC', 'Corea del Sur': 'AFC', Irán: 'AFC', Australia: 'AFC', 'Arabia Saudita': 'AFC', Qatar: 'AFC',
};
const CONTINENTAL_CUP: Record<NatConfed, string> = {
  CONMEBOL: 'Copa América', UEFA: 'Eurocopa', CONCACAF: 'Copa Oro', CAF: 'Copa Africana de Naciones', AFC: 'Copa Asiática',
};
const natConfedOf = (nat: string): NatConfed => NAT_CONFED[nat] ?? 'UEFA';
const natLevelOf = (nat: string): number => NAT_STRENGTH[nat.replace(/ /g, '_')] ?? 72;
/** ¿Sos elegible para tu selección? (nivel cercano al de tu país, en edad, y no colgaste la camiseta) */
function ntEligible(state: CareerState): boolean {
  return state.ntActive && state.phase === 'jugador' && state.age >= 18 && state.age <= 36
    && state.ability >= natLevelOf(state.nationality) - 12;
}

// Calendario de 4 años: Mundial (m=0), Eliminatorias (m=3, previa), torneo continental (m=2).
type NtKind = 'mundial' | 'continental' | 'eliminatorias';
function ntEventKind(year: number): NtKind | null {
  const m = (((year - 2026) % 4) + 4) % 4;
  if (m === 0) return 'mundial';
  if (m === 2) return 'continental';
  if (m === 3) return 'eliminatorias';
  return null;
}

/** Evento de selección para el año en curso (convocatoria a Eliminatorias / torneo continental / Mundial). */
function nationalTeamEvent(state: CareerState, kind: NtKind): CareerEvent {
  const nat = state.nationality;
  const cup = CONTINENTAL_CUP[natConfedOf(nat)];
  const year = state.year;
  const canRetire = state.age >= 33;
  const retireOpt: CareerOption[] = canRetire
    ? [{ id: 'nt:retire', label: 'Colgar la camiseta de la selección', sub: 'Cerrás tu ciclo internacional', chips: [{ t: 'Sin más desgaste con el seleccionado', tone: 'muted' }] }]
    : [];

  if (kind === 'eliminatorias') {
    return {
      kind: 'seleccion',
      title: `Eliminatorias · ${nat}`,
      body: `${nat} arranca las Eliminatorias rumbo al Mundial ${year + 1}. Te convocan. ¿Respondés al llamado?`,
      options: [
        { id: 'nt:play', label: 'Jugar las Eliminatorias', sub: 'Pelear la clasificación', chips: [{ t: 'Caps + goles internacionales', tone: 'good' }, { t: 'Ayudás a clasificar', tone: 'good' }, { t: 'Desgaste físico', tone: 'warn' }] },
        { id: 'nt:rest', label: 'Priorizar el club', sub: 'Descansás los viajes', chips: [{ t: 'Llegás mejor a la temporada', tone: 'good' }, { t: 'La clasificación queda en otras manos', tone: 'bad' }] },
        ...retireOpt,
      ],
    };
  }

  if (kind === 'mundial' && !state.ntQualified) {
    return {
      kind: 'seleccion',
      title: `Sin Mundial · ${nat}`,
      body: `${nat} no logró clasificar al Mundial ${year}. Toca vivirlo desde afuera y enfocarse en el club.`,
      options: [{ id: 'nt:rest', label: 'Enfocarte en el club', sub: 'A meterle a la temporada', chips: [{ t: 'Concentración total en tu equipo', tone: 'muted' }] }],
    };
  }

  const torneo = kind === 'mundial' ? `el Mundial ${year}` : `la ${cup} ${year}`;
  return {
    kind: 'seleccion',
    title: `${kind === 'mundial' ? 'Mundial' : cup} ${year} · ${nat}`,
    body: `Se juega ${torneo}. ${state.isCaptain ? 'Como capitán, cargás con la ilusión de todo un país. ' : 'La ilusión de todo un país está en juego. '}¿Vas al frente?`,
    options: [
      { id: 'nt:play', label: 'Jugar por tu país', sub: 'Dejar todo por la camiseta', chips: [{ t: 'Gloria si salís campeón', tone: 'good' }, { t: 'Caps + goles internacionales', tone: 'good' }, { t: 'Desgaste físico', tone: 'warn' }] },
      { id: 'nt:rest', label: 'Bajarte por el club', sub: 'Priorizás tu equipo', chips: [{ t: 'Llegás entero a la temporada', tone: 'good' }, { t: 'Te perdés el torneo', tone: 'bad' }] },
      ...retireOpt,
    ],
  };
}

function weightedPick<T>(rng: Rng, arr: T[], w: (x: T) => number): T {
  const total = arr.reduce((a, x) => a + w(x), 0);
  let r = rng.next('match') * total;
  for (const x of arr) {
    r -= w(x);
    if (r <= 0) return x;
  }
  return arr[arr.length - 1];
}

function ageCurve(age: number): number {
  if (age <= 20) return 3.2;
  if (age <= 24) return 1.8;
  if (age <= 28) return 0.4;
  if (age <= 31) return -0.8;
  return -2.4;
}

/** Simula UNA temporada en el club actual. Devuelve la fila para la trayectoria. */
function playSeason(state: CareerState, rng: Rng): SeasonRow {
  const club = state.clubs[state.clubId!];
  const level = clubLevel(club);
  let note = '';
  const prevGoals = state.seasons.reduce((a, s) => a + s.goals, 0);
  const prevApps = state.seasons.reduce((a, s) => a + s.apps, 0);
  const prevCaps = state.caps;
  const isDebutSeason = state.seasons.length === 0;

  let role: Role = roleFor(state.ability, level, state.promisedStarter);
  let apps: number;
  if (state.suspendedSeasons > 0) {
    state.suspendedSeasons--;
    apps = 0;
    role = 'Suplente';
    note = 'Suspendido: no jugaste ni un minuto.';
  } else {
    const [lo, hi] = ROLE_APPS[role];
    apps = rng.int('match', lo, hi);
    if (rng.chance('injury', 0.1)) {
      apps = Math.max(2, Math.round(apps * 0.45));
      note = 'Una lesión te sacó media temporada.';
    }
  }

  const goals = Math.round(apps * (GOAL_RATE[state.position] ?? 0.1) * Math.pow(Math.max(0.5, state.ability / Math.max(60, level)), 2) * (0.7 + rng.next('match') * 0.6));
  const out = leagueOutcome(state, rng, club.id);
  const rivalryFame = playRivalryMatches(state, rng, club, apps >= 5);
  const rating = r1(Math.max(4.5, Math.min(9.8,
    6.1 + (state.ability - level) * 0.06 + goals * 0.03 + state.formBoost + rng.normal('match', 0, 0.35),
  )));

  // títulos (contás si jugaste al menos 5 partidos)
  const titles: string[] = [];
  if (apps >= 5) {
    if (out.wonLeague && club.division === 1) titles.push(club.leagueName);
    if (out.wonLeague && club.division === 2) titles.push(`Ascenso con ${club.name}`);
    // finales de copa: a veces (si no sos arquero) las definís desde los doce pasos
    const finals: { title: string; comp: string }[] = [];
    if (out.wonContinental) finals.push({ title: continentalName(club), comp: continentalName(club).toUpperCase() });
    if (out.wonCup) finals.push({ title: `Copa de ${club.country}`, comp: `COPA DE ${club.country.toUpperCase()}` });
    const canShoot = state.position !== 'Arquero';
    let deferred = false;
    for (const f of finals) {
      if (!deferred && canShoot && !state.pendingPenalty && rng.chance('event', 0.45)) {
        deferToPenalty(state, { titleName: f.title, competition: f.comp, source: 'club', clubName: club.name, year: state.year, fameGoal: 9, fameMiss: 6 });
        deferred = true;
      } else {
        titles.push(f.title);
      }
    }
  }

  // selección: amistosos + torneos de fondo (los interactivos ya se resolvieron por evento este año)
  if (apps >= 15 && ntEligible(state)) {
    state.caps += rng.int('match', 2, 6);
    if (ATTACKING_POS.has(state.position)) state.intlGoals += rng.int('match', 0, 3);
    if (state.ntHandledYear !== state.year) {
      const nat = state.nationality; const lvl = natLevelOf(nat); const cup = CONTINENTAL_CUP[natConfedOf(nat)];
      const k = ntEventKind(state.year);
      if (k === 'eliminatorias') {
        state.ntQualified = rng.chance('event', Math.min(0.95, Math.pow(lvl / 100, 3) + 0.25));
        addMoment(state, state.ntQualified ? '🌍' : '😔', state.ntQualified ? `Clasificaste al Mundial con ${nat}` : `${nat} no clasificó al próximo Mundial`);
      } else if (k === 'continental') {
        state.caps += rng.int('match', 2, 4);
        if (rng.chance('match', Math.pow(lvl / 100, 4) * 0.5)) {
          titles.push(`${cup} ${state.year}`);
          state.fame = Math.min(100, state.fame + 8);
          addMoment(state, '🌎', `Campeón de la ${cup} con ${nat} (${state.year})`);
        }
      }
    }
  }

  // premios individuales: no todos los años, y el Balón de Oro es carísimo de ganar
  const awards = state.awards ?? (state.awards = []); // compat con partidas guardadas viejas
  if (apps >= 12 && rating >= 7.3) {
    const mvpChance = Math.min(0.6, Math.pow((rating - 7.1) / 1.3, 2) * 0.8 + (out.wonLeague ? 0.1 : 0));
    if (rng.chance('event', mvpChance)) {
      const award = `MVP de ${club.leagueName} ${state.year}`;
      awards.push({ year: state.year, award });
      addMoment(state, '⭐', award);
    }
    if (rating >= 8 && state.fame >= 45 && level >= 74) {
      const ballonChance = Math.min(0.25, Math.pow((rating - 7.8) / 1.4, 3) * 0.5);
      if (rng.chance('event', ballonChance)) {
        const award = `Balón de Oro ${state.year}`;
        awards.push({ year: state.year, award });
        addMoment(state, '🥇', award);
        state.fame = Math.min(100, state.fame + 5);
      }
    }
  }

  // desarrollo
  const minutesFactor = 0.55 + 0.5 * Math.min(1, apps / 38);
  let delta = ageCurve(state.age) * minutesFactor * (0.8 + level / 400) + state.trainingBoost + rng.normal('dev', 0, 0.9);
  if (delta > 0) delta = Math.min(delta, (state.potential - state.ability) * 0.55);
  state.ability = Math.round(Math.max(40, Math.min(99, state.ability + delta)));
  state.trainingBoost = 0;
  state.formBoost = 0;
  state.promisedStarter = false;

  // la fama premia sobre todo títulos: jugar mucho ya no alcanza para ser leyenda por acumulación pasiva
  state.fame = Math.min(100, r1(state.fame + apps * 0.03 + goals * 0.12 + titles.length * 9 + (level >= 82 ? 1.5 : 0) + rivalryFame - 1.5));

  // registrar
  const stint = currentStint(state);
  stint.apps += apps;
  stint.goals += goals;
  stint.endYear = state.year + 1;
  stint.titles.push(...titles);
  for (const t of titles) state.titles.push({ year: state.year, title: t, clubName: club.name, as: 'jugador' });

  // momentos que quedan en la historia
  if (isDebutSeason && apps > 0) addMoment(state, '⚽', `Debut profesional con ${club.name} a los ${state.age} años`);
  const crossed = (from: number, to: number, mark: number) => from < mark && to >= mark;
  const newGoals = prevGoals + goals;
  const newApps = prevApps + apps;
  if (crossed(prevGoals, newGoals, 1)) addMoment(state, '🥅', `Primer gol como profesional (${club.name})`);
  for (const mark of [50, 100, 200, 300]) if (crossed(prevGoals, newGoals, mark)) addMoment(state, '🥅', `Gol n° ${mark} de tu carrera`);
  for (const mark of [100, 300, 500]) if (crossed(prevApps, newApps, mark)) addMoment(state, '🎽', `Partido n° ${mark} de tu carrera`);
  if (prevCaps === 0 && state.caps > 0) addMoment(state, '🇦🇷', `Primera convocatoria a la selección de ${state.nationality}`);
  for (const t of titles) {
    if (!t.startsWith('Copa del Mundo')) addMoment(state, '🏆', `Campeón: ${t} con ${club.name} (${state.year})`);
  }
  if (note.startsWith('Una lesión')) addMoment(state, '🏥', `Lesión grave en ${club.name} (${state.year}): media temporada afuera`);

  const row: SeasonRow = {
    year: state.year, clubId: club.id, clubName: club.name, role, apps, goals, rating,
    leaguePos: out.pos, titles, note,
  };
  state.seasons.push(row);

  driftWorld(state, rng);
  state.year++;
  state.age++;
  return row;
}

// ------------------------------ Ofertas y eventos ------------------------------

function optionBadge(option: CareerOption): CareerOption['badge'] | undefined {
  if (option.id.startsWith('risk:') || option.id.startsWith('dtrisk:')) {
    return { t: 'Arriesgado', tone: 'warn', icon: '⚠️' };
  }
  if (option.id.endsWith(':skip') || option.id === 'stay' || option.id === 'nat:keep' || option.id === 'dt:no' || option.id === 'risk:skip') {
    return { t: 'Seguro', tone: 'good', icon: '🛡️' };
  }
  if (option.id.startsWith('join:') || option.id.startsWith('dtjoin:')) {
    return { t: 'Popular', tone: 'good', icon: '🔥' };
  }
  if (option.id.startsWith('loan:')) {
    return { t: 'Movida viral', tone: 'muted', icon: '🎒' };
  }
  if (option.id.startsWith('retire:')) {
    return { t: 'Cierre épico', tone: 'muted', icon: '🏁' };
  }
  return undefined;
}

function withBadge(option: CareerOption): CareerOption {
  return { ...option, badge: option.badge ?? optionBadge(option) };
}

function applyOptionBadges(event: CareerEvent): CareerEvent {
  return { ...event, options: event.options.map(withBadge) };
}

function offerOption(state: CareerState, c: CareerClub, promise: boolean): CareerOption {
  const level = clubLevel(c);
  const role = roleFor(state.ability, level, promise);
  const proj = projectLabel(c, state.clubs);
  return withBadge({
    id: `join:${c.id}${promise ? ':promesa' : ''}`,
    label: c.name,
    sub: `${c.leagueName} · nivel ${level}`,
    clubId: c.id,
    chips: [
      { t: `Rol: ${role}`, tone: role.startsWith('Titular') ? 'good' : role === 'Rotación' ? 'warn' : 'bad' },
      { t: proj.t, tone: proj.tone },
      { t: `Sueldo ${wageLabel(level)}`, tone: 'muted' },
    ],
  });
}

function stayOption(state: CareerState): CareerOption {
  const club = state.clubs[state.clubId!];
  const level = clubLevel(club);
  const role = roleFor(state.ability, level, false);
  const proj = projectLabel(club, state.clubs);
  return withBadge({
    id: 'stay',
    label: `Quedarte en ${club.name}`,
    sub: 'La casa conocida',
    clubId: club.id,
    chips: [
      { t: `Rol: ${role}`, tone: role.startsWith('Titular') ? 'good' : role === 'Rotación' ? 'warn' : 'bad' },
      { t: proj.t, tone: proj.tone },
      { t: 'Ídolo si te quedás años', tone: 'muted' },
    ],
  });
}

function genOffers(state: CareerState, rng: Rng): CareerClub[] {
  const last = state.seasons[state.seasons.length - 1];
  const club = state.clubs[state.clubId!];
  const myLevel = clubLevel(club);
  const perf = (last?.rating ?? 6) - 6.4 + state.fame / 60 + (last && last.apps >= 28 ? 0.3 : 0);
  const n = perf > 1.2 ? 2 + (rng.chance('market', 0.5) ? 1 : 0) : perf > 0.4 ? 2 : perf > -0.3 ? 1 : 0;
  if (n === 0) return [];
  // Realismo: nadie deja una liga top por una mucho más débil en su prime.
  // Después de los 30 se abren los mercados "exóticos" (el retiro dorado ya existe aparte).
  const myCoeff = club.coeff ?? 78;
  const pool = Object.values(state.clubs).filter((c) =>
    c.id !== club.id && c.division === 1 && ((c.coeff ?? 78) >= myCoeff - 12 || state.age >= 30));
  const stepUp = pool.filter((c) => clubLevel(c) > myLevel + 1 && clubLevel(c) <= state.ability + 8);
  const lateral = pool.filter((c) => Math.abs(clubLevel(c) - myLevel) <= 1);
  const offers: CareerClub[] = [];
  const tryAdd = (source: CareerClub[], attempts: number) => {
    for (let i = 0; i < attempts && offers.length < n && source.length > 0; i++) {
      const c = rng.pick('market', source);
      if (!offers.some((o) => o.id === c.id)) offers.push(c);
    }
  };
  if (stepUp.length && perf > 0.3) offers.push(rng.pick('market', stepUp));
  tryAdd(lateral, 10);
  tryAdd(pool, 10);
  return offers.slice(0, 3);
}

const RISK_EVENTS: ((state: CareerState) => CareerEvent | null)[] = [
  (s) => s.age <= 27 ? {
    kind: 'riesgo',
    title: 'Pretemporada de doble turno',
    body: 'El preparador físico propone una rutina brutal. Podés dar un salto de nivel… o romperte.',
    options: [
      { id: 'risk:train', label: 'Aceptar la rutina intensa', sub: '70% sale bien', chips: [{ t: 'Nivel +3', tone: 'good' }, { t: '30%: lesión y media temporada afuera', tone: 'bad' }] },
      { id: 'risk:skip', label: 'Entrenar normal', sub: 'Sin riesgo', chips: [{ t: 'Todo sigue igual', tone: 'muted' }] },
    ],
  } : null,
  (s) => s.age >= 20 && s.age <= 30 ? {
    kind: 'riesgo',
    title: 'El suplemento "milagroso"',
    body: 'Un médico externo te ofrece un suplemento que mejora el rendimiento. No está claro si pasa el antidoping.',
    options: [
      { id: 'risk:dope', label: 'Tomarlo en secreto', sub: '75% no te descubren', chips: [{ t: 'Nivel +4', tone: 'good' }, { t: '25%: suspensión 1 año y escándalo', tone: 'bad' }] },
      { id: 'risk:clean', label: 'Rechazarlo', sub: 'Tu carrera limpia', chips: [{ t: 'Fama +2 (se filtra que dijiste no)', tone: 'good' }] },
    ],
  } : null,
  (s) => {
    const club = s.clubs[s.clubId!];
    const natKey = s.nationality.replace(/ /g, '_');
    const better = Object.entries(NAT_STRENGTH).filter(([k, v]) => v > (NAT_STRENGTH[natKey] ?? 72) + 4);
    if (s.caps > 0 || better.length === 0 || s.age > 24) return null;
    const [k, v] = better[Math.floor(better.length / 2)];
    return {
      kind: 'seleccion',
      title: 'Abuelo de otra nacionalidad',
      body: `Descubren que tu abuelo nació en ${k.replace('_', ' ')}: podés cambiar de selección. Más chances de ganar cosas, menos identidad.`,
      options: [
        { id: `nat:${k}`, label: `Representar a ${k.replace('_', ' ')}`, sub: 'Selección más fuerte', chips: [{ t: 'Más chances de Mundial', tone: 'good' }, { t: 'Tu país no te lo perdona (fama −5)', tone: 'bad' }] },
        { id: 'nat:keep', label: `Seguir con ${s.nationality}`, sub: 'La camiseta de tu vida', chips: [{ t: 'Identidad intacta', tone: 'good' }] },
      ],
    };
  },
  (s) => s.age >= 24 && s.age <= 31 ? {
    kind: 'riesgo',
    title: 'Lesión antes de la final',
    body: 'Llegás tocado a la definición de la temporada. El médico recomienda parar; el DT te quiere adentro.',
    options: [
      { id: 'risk:force', label: 'Infiltrarte y jugar', sub: '55% sale bien', chips: [{ t: 'Héroe si salís campeón (fama +8)', tone: 'good' }, { t: '45%: agravás la lesión (nivel −3)', tone: 'bad' }] },
      { id: 'risk:rest', label: 'Priorizar la recuperación', sub: 'Sin riesgo', chips: [{ t: 'Volvés al 100%', tone: 'good' }, { t: 'Te perdés la definición', tone: 'warn' }] },
    ],
  } : null,
];

/**
 * Sortea un evento de riesgo que todavía no haya aparecido en esta carrera.
 * Se identifica por título: una vez mostrado, no vuelve a salir (el Mundial de DT
 * lleva el año en el título, así que cada cita mundialista cuenta aparte).
 */
function pickUnusedEvent(
  state: CareerState,
  rng: Rng,
  pool: ((s: CareerState) => CareerEvent | null)[],
): CareerEvent | null {
  const used = state.usedEvents ?? (state.usedEvents = []); // compat con partidas guardadas viejas
  const shuffled = rng.shuffle('event', [...pool]);
  for (const build of shuffled) {
    const ev = build(state);
    if (ev && !used.includes(ev.title)) {
      used.push(ev.title);
      return ev;
    }
  }
  return null;
}

function nextEvent(state: CareerState, rng: Rng): CareerEvent {
  const club = state.clubs[state.clubId!];
  const last = state.seasons[state.seasons.length - 1];

  // retiro
  if (state.age >= 34 || (state.age >= 31 && state.ability < 62)) {
    const first = state.firstClubId ? state.clubs[state.firstClubId] : null;
    const options: CareerOption[] = [];
    if (first && first.id !== club.id) {
      options.push({
        id: `retire:first`, label: `Última temporada en ${first.name}`, sub: 'Volver a casa para el adiós', clubId: first.id,
        chips: [{ t: 'Cierre de ídolo (fama +10)', tone: 'good' }, { t: 'Una temporada más y afuera', tone: 'muted' }],
      });
    }
    options.push({
      id: 'retire:gulf', label: 'Contrato millonario en el Golfo', sub: 'Al-Qimma SC te llena la billetera', chips: [
        { t: 'Retiro dorado', tone: 'good' }, { t: 'Fama −6: la crítica no perdona', tone: 'bad' }, { t: 'Una temporada más', tone: 'muted' },
      ],
    });
    options.push({
      id: 'retire:now', label: 'Colgar los botines ya', sub: 'Irse en un buen momento', chips: [{ t: 'Se cierra la historia', tone: 'muted' }],
    });
    return {
      kind: 'retiro',
      title: `${state.age} años: se acerca el final`,
      body: 'El cuerpo avisa y el contrato termina. Elegí cómo se cierra tu carrera.',
      options,
    };
  }

  // préstamo si sos pibe y no jugás
  if (state.age <= 21 && last && last.apps < 12 && !state.onLoan) {
    const dest = Object.values(state.clubs)
      .filter((c) => c.id !== club.id && clubLevel(c) <= state.ability + 2 && clubLevel(c) >= state.ability - 8)
      .sort((a, b) => clubLevel(b) - clubLevel(a));
    if (dest.length >= 2) {
      const d1 = dest[0];
      const d2 = rng.pick('market', dest.slice(1, Math.min(8, dest.length)));
      return {
        kind: 'prestamo',
        title: `${club.name} quiere cederte a préstamo`,
        body: 'No estás teniendo minutos y el club quiere que juegues. Elegí dónde seguir tu desarrollo (o quedate a pelearla).',
        options: [
          { ...offerOption(state, d1, true), id: `loan:${d1.id}`, chips: [{ t: 'Rol: Titular', tone: 'good' }, { t: 'Volvés en 1 año', tone: 'muted' }, { t: `Liga: ${d1.leagueName}`, tone: 'muted' }] },
          { ...offerOption(state, d2, true), id: `loan:${d2.id}`, chips: [{ t: 'Rol: Titular', tone: 'good' }, { t: 'Volvés en 1 año', tone: 'muted' }, { t: `Liga: ${d2.leagueName}`, tone: 'muted' }] },
          { ...stayOption(state), label: `Quedarte a pelearla en ${club.name}`, sub: 'Contra pronóstico' },
        ],
      };
    }
  }

  // volver del préstamo
  if (state.onLoan) {
    const parent = state.clubs[state.loanFromId!];
    const wanted = state.ability >= clubLevel(parent) - 3;
    state.onLoan = false;
    const backId = state.loanFromId!;
    state.loanFromId = null;
    const offers = genOffers(state, rng).slice(0, 1);
    const options: CareerOption[] = [
      { ...offerOption(state, parent, wanted), id: `join:${backId}`, label: `Volver a ${parent.name}`, sub: wanted ? 'Te esperan con lugar en el equipo' : 'Volvés, pero no te aseguran minutos' },
      ...offers.map((c) => offerOption(state, c, false)),
    ];
    if (options.length < 2) options.push(stayOption(state));
    return applyOptionBadges({
      kind: 'ofertas',
      title: wanted ? 'Fin del préstamo: te quieren de vuelta' : 'Fin del préstamo: futuro incierto',
      body: wanted
        ? `${parent.name} siguió tu año a préstamo y te quiere en el plantel. También hay otra puerta abierta.`
        : `Volvés a ${parent.name} pero no estás en los planes. Quizás sea hora de otro rumbo.`,
      options,
    });
  }

  // selección nacional: el Mundial es el gran evento interactivo (cada 4 años); el torneo
  // continental sólo a veces; las Eliminatorias se juegan de fondo. Así no opaca al club.
  if (state.clubId && ntEligible(state)) {
    const k = ntEventKind(state.year);
    const interactive = (k === 'mundial' && state.ntQualified) || (k === 'continental' && rng.chance('event', 0.3));
    if (interactive && k) { state.ntHandledYear = state.year; return nationalTeamEvent(state, k); }
  }

  // evento de riesgo (a veces) — cada uno aparece una sola vez por carrera
  if (rng.chance('event', 0.3)) {
    const ev = pickUnusedEvent(state, rng, RISK_EVENTS);
    if (ev) return ev;
  }

  // ofertas de mercado (lo más común)
  const offers = genOffers(state, rng);
  if (offers.length === 0) {
    return applyOptionBadges({
      kind: 'ofertas',
      title: 'Mercado tranquilo',
      body: last && last.apps < 15
        ? 'No sonó el teléfono: tu temporada pasó desapercibida. Toca remarla donde estás.'
        : 'Sin ofertas serias este año. Tu club cuenta con vos.',
      options: [
        stayOption(state),
        { id: 'risk:train', label: 'Redoblar el entrenamiento', sub: 'Que el próximo mercado te encuentre mejor', chips: [{ t: 'Nivel +3 (70%)', tone: 'good' }, { t: '30%: lesión', tone: 'bad' }] },
      ],
    });
  }
  return applyOptionBadges({
    kind: 'ofertas',
    title: offers.length > 1 ? `${offers.length} clubes preguntaron por vos` : 'Una oferta sobre la mesa',
    body: 'Después de tu última temporada llegaron ofertas. Podés aceptar una o quedarte donde estás.',
    options: [...offers.map((c) => offerOption(state, c, c.elo < club.elo)), stayOption(state)],
  });
}

// ------------------------------ Segunda vida: director técnico ------------------------------

function dtDecisionEvent(state: CareerState): CareerEvent {
  return applyOptionBadges({
    kind: 'dt-decision',
    title: 'Colgaste los botines. ¿Y ahora?',
    body: 'El teléfono no para de sonar: hay bancos que quieren tu apellido. Podés hacer el curso de DT y empezar una segunda carrera, o cerrar la historia acá.',
    options: [
      withBadge({
        id: 'dt:start', label: 'Hacerme director técnico', sub: 'La segunda vida en los bancos',
        chips: [
          { t: 'Arrancás con tu prestigio de jugador', tone: 'good' },
          { t: 'Los bancos queman: te pueden echar', tone: 'warn' },
          { t: 'Podés ganar títulos como DT', tone: 'good' },
        ],
      }),
      withBadge({
        id: 'dt:no', label: 'Retirarme del fútbol', sub: 'Ver los partidos desde el sillón',
        chips: [{ t: 'Se cierra la historia con lo logrado', tone: 'muted' }],
      }),
    ],
  });
}

function dtOfferOption(state: CareerState, c: CareerClub): CareerOption {
  const level = clubLevel(c);
  const proj = projectLabel(c, state.clubs);
  const hot = level - state.dtSkill; // banco más grande que tu chapa = más caliente
  return {
    id: `dtjoin:${c.id}`,
    label: `DT de ${c.name}`,
    sub: `${c.leagueName} · plantel nivel ${level}`,
    clubId: c.id,
    chips: [
      proj,
      { t: hot >= 4 ? 'Banco MUY caliente' : hot >= 0 ? 'Paciencia limitada' : 'Proyecto a tu medida', tone: hot >= 4 ? 'bad' : hot >= 0 ? 'warn' : 'good' },
      { t: `Sueldo ${wageLabel(level)}`, tone: 'muted' },
    ],
  };
}

function genDtOffers(state: CareerState, rng: Rng, n: number): CareerClub[] {
  const pool = Object.values(state.clubs).filter((c) => c.id !== state.clubId && c.id !== 'GULF-AlQimma');
  const current = state.clubId ? state.clubs[state.clubId] : null;
  const myLevel = current ? clubLevel(current) : Math.max(56, state.dtSkill - 8);
  // Realismo: te llaman clubes a los que les cerrás por chapa (nivel ≤ dtSkill+5)
  // y a los que vos no bajarías: si estás empleado, nada muy por debajo de tu club.
  const floor = current ? myLevel - 3 : myLevel - 9;
  const cap = state.dtSkill + 5;
  const candidates = pool
    .filter((c) => { const l = clubLevel(c); return l >= floor && l <= cap; })
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 14); // los mejores disponibles dentro de tu rango
  const offers: CareerClub[] = [];
  for (let i = 0; i < 12 && offers.length < n && candidates.length > 0; i++) {
    const c = rng.pick('market', candidates);
    if (!offers.some((o) => o.id === c.id)) offers.push(c);
  }
  return offers;
}

function dtOffersEvent(state: CareerState, rng: Rng, opening: boolean): CareerEvent {
  const offers = genDtOffers(state, rng, opening || state.dtJustFired ? 3 : 2);
  const options: CareerOption[] = offers.map((c) => withBadge(dtOfferOption(state, c)));
  if (!opening && !state.dtJustFired && state.clubId) {
    const club = state.clubs[state.clubId];
    const proj = projectLabel(club, state.clubs);
    options.push(withBadge({
      id: 'dtstay', label: `Seguir en ${club.name}`, sub: 'Continuidad del proyecto', clubId: club.id,
      chips: [proj, { t: 'La dirigencia te banca', tone: 'good' }],
    }));
  }
  if (state.age >= 50 || state.dtJustFired) {
    options.push(withBadge({
      id: 'dtretire', label: 'Retirarme definitivamente', sub: 'Dejar el fútbol siendo leyenda',
      chips: [{ t: 'Fin de la historia', tone: 'muted' }],
    }));
  }
  const fired = state.dtJustFired;
  state.dtJustFired = false;
  const noOffers = offers.length === 0;
  return {
    kind: fired ? 'dt-despido' : 'dt-ofertas',
    title: opening ? 'Tu primer banco te espera'
      : fired ? 'Sin trabajo… pero con ofertas'
        : noOffers ? 'El mercado te respeta' : 'El mercado de entrenadores se mueve',
    body: opening
      ? `Curso aprobado. Con tu chapa de ${state.fame >= 60 ? 'ex crack' : 'ex profesional'}, estos clubes te ofrecen su banco.`
      : fired
        ? 'El despido dolió, pero en el fútbol siempre hay otra oportunidad. Elegí tu próximo desafío.'
        : noOffers
          ? 'Nadie se anima a tentarte: estás donde cualquier técnico querría estar. La dirigencia quiere que sigas.'
          : 'Terminó la temporada y hay dirigentes a tu altura preguntando por vos.',
    options,
  };
}

/** Una temporada en el banco: el equipo rinde según tu nivel de DT vs. el plantel. */
function playDtSeason(state: CareerState, rng: Rng): SeasonRow {
  const club = state.clubs[state.clubId!];
  const level = clubLevel(club);
  const edge = state.dtSkill - level + (state.dtEdgeBoost ?? 0); // DT mejor que el plantel = sobrerrinde
  state.dtEdgeBoost = 0;

  // impacto del DT en el sorteo de la liga: bono temporal de Elo
  // (tope moderado: ni el mejor DT del mundo debería ganar la Champions todos los años)
  const bonus = Math.max(-55, Math.min(55, edge * 7));
  club.elo += bonus;
  const out = leagueOutcome(state, rng, club.id);
  club.elo -= bonus;

  const peers = Object.values(state.clubs).filter((c) => c.leagueId === club.leagueId);
  const expectedRank = peers.filter((c) => c.elo > club.elo).length + 1;
  const over = expectedRank - out.pos; // positivo = sobrerrendiste

  const titles: string[] = [];
  if (out.wonLeague && club.division === 1) titles.push(club.leagueName);
  if (out.wonLeague && club.division === 2) titles.push(`Ascenso con ${club.name}`);
  if (out.wonCup) titles.push(`Copa de ${club.country}`);
  if (out.wonContinental) titles.push(continentalName(club));

  const matches = rng.int('match', 42, 55);
  const rivalryFame = playRivalryMatches(state, rng, club, true);
  const rating = r1(Math.max(4.5, Math.min(9.8, 6.4 + over * 0.18 + titles.length * 0.5 + rng.normal('match', 0, 0.3))));

  // el nivel de DT también puede bajar: una mala temporada te desgasta como a cualquier
  // técnico real, no hay un ascenso garantizado a leyenda con solo acumular años en el banco.
  const skillDelta = titles.length * 1.5 + (over >= 3 ? 1 : over >= 0 ? 0.5 : over >= -4 ? -0.6 : -1.6);
  state.dtSkill = Math.round(Math.max(40, Math.min(92, state.dtSkill + skillDelta)));
  state.fame = Math.min(100, r1(state.fame + titles.length * 5 + (over >= 3 ? 2 : 0) + rivalryFame - 0.5));

  const stint = currentStint(state);
  stint.apps += matches;
  stint.endYear = state.year + 1;
  stint.titles.push(...titles);
  for (const t of titles) {
    state.titles.push({ year: state.year, title: t, clubName: club.name, as: 'dt' });
    addMoment(state, '🏆', `Campeón como DT: ${t} con ${club.name} (${state.year})`);
  }

  // ¿te echan? rendir muy por debajo de lo esperado enciende el banco
  let note = '';
  const firedNow = over <= -5 || (out.pos >= peers.length - 2 && expectedRank < peers.length - 4);
  if (firedNow) {
    state.dtJustFired = true;
    note = 'La dirigencia te echó al terminar la temporada.';
    state.clubId = null;
    addMoment(state, '🪑', `${club.name} te echó del banco (${state.year})`);
  }

  const row: SeasonRow = {
    year: state.year, clubId: club.id, clubName: club.name, role: 'Director técnico',
    apps: matches, goals: 0, rating, leaguePos: out.pos, titles, note,
  };
  state.seasons.push(row);
  driftWorld(state, rng);
  state.year++;
  state.age++;
  return row;
}

// Decisiones de riesgo del DT: mismo formato que las del jugador, con porcentajes declarados.
const DT_RISK_EVENTS: ((state: CareerState) => CareerEvent | null)[] = [
  (s) => {
    if (!s.clubId) return null;
    return {
      kind: 'riesgo',
      title: 'La dirigencia pregunta por los juveniles',
      body: 'Tenés una camada interesante en la reserva. Meterlos es una apuesta: puede salir un equipo con hambre… o un papelón.',
      options: [
        { id: 'dtrisk:pibes', label: 'Llenar el equipo de pibes', sub: '65% sale bien', chips: [{ t: 'Equipo con hambre (+2 rendimiento)', tone: 'good' }, { t: 'Fama +3: te miran como formador', tone: 'good' }, { t: '35%: te cuesta puntos (−2)', tone: 'bad' }] },
        { id: 'dtrisk:skip', label: 'Que sigan madurando abajo', sub: 'Sin riesgo', chips: [{ t: 'Todo sigue igual', tone: 'muted' }] },
      ],
    };
  },
  (s) => {
    if (!s.clubId) return null;
    return {
      kind: 'riesgo',
      title: 'Tu idea revolucionaria',
      body: 'Venís laburando un esquema que nadie usa. Implementarlo puede adelantarte a la época… o dejarte pagando.',
      options: [
        { id: 'dtrisk:esquema', label: 'Implementar el sistema nuevo', sub: '55% sale bien', chips: [{ t: 'El equipo vuela (+2.5)', tone: 'good' }, { t: '45%: vestuario perdido (−2.5)', tone: 'bad' }] },
        { id: 'dtrisk:skip', label: 'Jugar a lo seguro', sub: 'Sin riesgo', chips: [{ t: 'Lo conocido funciona', tone: 'muted' }] },
      ],
    };
  },
  (s) => {
    if (!s.clubId) return null;
    return {
      kind: 'riesgo',
      title: 'La estrella del plantel te desafía',
      body: 'El mejor jugador del equipo llegó tarde tres veces y te contestó delante de todos. El vestuario espera tu reacción.',
      options: [
        { id: 'dtrisk:estrella-out', label: 'Borrarlo del equipo', sub: '60% sale bien', chips: [{ t: 'El grupo te respalda (+2)', tone: 'good' }, { t: '40%: te quedás sin tu mejor arma (−2.5)', tone: 'bad' }] },
        { id: 'dtrisk:estrella-in', label: 'Arreglarlo en privado', sub: 'Sin riesgo', chips: [{ t: 'Paz en el vestuario (+0.5)', tone: 'good' }, { t: 'La prensa dice que sos blando', tone: 'warn' }] },
      ],
    };
  },
  (s) => {
    if (!s.clubId) return null;
    return {
      kind: 'riesgo',
      title: 'Pedirle un refuerzo a la dirigencia',
      body: 'Te falta un jugador para pelear todo. Podés plantarte y exigirlo públicamente, o arreglarte con lo que hay.',
      options: [
        { id: 'dtrisk:fichaje', label: 'Exigir el fichaje en conferencia', sub: '50% te lo traen', chips: [{ t: 'Llega el refuerzo (+2)', tone: 'good' }, { t: '50%: te dicen que no y quedás debilitado (−1, fama −2)', tone: 'bad' }] },
        { id: 'dtrisk:skip', label: 'Trabajar con lo que hay', sub: 'Sin riesgo', chips: [{ t: 'La dirigencia lo valora', tone: 'muted' }] },
      ],
    };
  },
  (s) => {
    const isWcYear = (s.year - 2026) % 4 === 0 && s.year > START_YEAR;
    if (!isWcYear || s.dtSkill < 72 || s.fame < 45) return null;
    const natLevel = NAT_STRENGTH[s.nationality.replace(/ /g, '_')] ?? 72;
    const pWin = Math.round(Math.pow(natLevel / 100, 6) * (20 + s.dtSkill / 4));
    return {
      kind: 'seleccion',
      title: `${s.nationality} te quiere para el Mundial ${s.year}`,
      body: 'La federación te ofrece dirigir a la selección en el Mundial sin dejar tu club. El país entero pendiente de vos.',
      options: [
        { id: 'dtrisk:seleccion', label: `Dirigir a ${s.nationality} en el Mundial`, sub: `${pWin}% de gritar campeón`, chips: [{ t: `${pWin}%: CAMPEÓN DEL MUNDO como DT`, tone: 'good' }, { t: 'Si te eliminan temprano: fama −4', tone: 'bad' }] },
        { id: 'dtrisk:skip', label: 'Rechazar con respeto', sub: 'El club primero', chips: [{ t: 'Enfocado en tu equipo', tone: 'muted' }] },
      ],
    };
  },
];

function nextDtEvent(state: CareerState, rng: Rng): CareerEvent {
  if (state.age >= 65) {
    state.retired = true;
    state.retirementNote = `A los ${state.age} años, el fútbol te despide de pie. Dos vidas en una: jugador y entrenador.`;
    return state.pendingEvent;
  }
  // si seguís empleado, a veces la decisión del año no es de mercado sino de vestuario
  // (cada situación aparece una sola vez por carrera)
  if (state.clubId && !state.dtJustFired && rng.chance('event', 0.38)) {
    const ev = pickUnusedEvent(state, rng, DT_RISK_EVENTS);
    if (ev) return ev;
  }
  return dtOffersEvent(state, rng, false);
}

// ------------------------------ Avance ------------------------------

export type TurnResult = {
  season: SeasonRow | null;
  flash: string | null;
  /** si la opción elegida era una apuesta: cómo salió el sorteo (para animarlo en la UI) */
  risk?: { ok: boolean; text: string };
  /** si pateaste un penal decisivo: para animar el arco en la UI */
  penalty?: { zone: number; keeperZone: number; scored: boolean; offTarget: boolean; titleName: string; competition: string; won: boolean };
  /** como DT las decisiones cubren un ciclo de hasta 3 temporadas: acá van todas */
  cycle?: SeasonRow[];
  /** frase social / meme generado a partir de la decisión */
  meme?: string;
};

function socialMemeForOption(
  state: CareerState,
  event: CareerEvent,
  option: CareerOption,
  res: { risk?: TurnResult['risk']; flash: string | null; season: SeasonRow | null; penalty?: TurnResult['penalty']; cycle?: SeasonRow[] },
): string | null {
  // reservado a los momentos grandes: apuestas de riesgo, penales y títulos ganados
  // (antes se disparaba en cada oferta/préstamo/convocatoria y saturaba la carrera de memes)
  if (res.risk) {
    const okMemes = [
      'Cine 🚬. Te recibiste de basado absoluto.',
      'El edit con música de Phonk ya es viral en TikTok.',
      'La termo-esfera decretó que sos más grande que Pelé.',
      'Masterclass. En redes todos piden tu Balón de Oro.'
    ];
    const failMemes = [
      'En TikTok ya hicieron 14 edits tuyos con música triste.',
      'Sos tendencia en X por las razones equivocadas. #Jubilate',
      'Ya apareciste en el compilado de bloopers rústicos.',
      'En Twitter te están liquidando. Te dicen "Ex Jugador".'
    ];
    return res.risk.ok ? okMemes[state.year % okMemes.length] : failMemes[state.year % failMemes.length];
  }

  if (event.kind === 'penal') {
    const okMemes = [
      'Ice in my veins 🥶. Te tiraste un pasito y es trend.',
      'Mente fría, termo intacto. Cerraste el estadio.',
      'A lo Panenka... en redes ya te comparan con los grandes.'
    ];
    const failMemes = [
      'Ese penal lo agarraron en la estratósfera. Sos meme.',
      'Apareciste en TV por mandar la pelota a Júpiter.',
      'Inspiración Sergio Ramos: bajaste un satélite de Starlink.'
    ];
    return res.penalty?.scored ? okMemes[state.year % okMemes.length] : failMemes[state.year % failMemes.length];
  }

  const wonTitle = res.season?.titles[0] ?? res.cycle?.flatMap((r) => r.titles)[0];
  if (wonTitle) {
    const titleMemes = [
      `Ya sos canon: edit con la ${wonTitle} y reggaetón de fondo.`,
      `El stream festejando la ${wonTitle} rompió Twitch.`,
      `Te tatuaste la ${wonTitle} y en redes ya te dicen GOAT 🐐.`,
      `Campeón de ${wonTitle} y lluvia de historias con lentes de sol.`
    ];
    return titleMemes[state.year % titleMemes.length];
  }

  return null;
}

function resultWithMeme(
  res: TurnResult,
  state: CareerState,
  event: CareerEvent,
  option: CareerOption,
): TurnResult {
  if (!res.meme) {
    res.meme = socialMemeForOption(state, event, option, {
      risk: res.risk,
      flash: res.flash,
      season: res.season,
      penalty: res.penalty,
      cycle: res.cycle,
    }) ?? undefined;
  }
  if (res.meme) {
    addMoment(state, '🎭', res.meme);
  }
  return res;
}

/** Ciclo de DT: hasta 3 temporadas seguidas en el banco (corta si te echan o te jubilás). */
function playDtCycle(state: CareerState, rng: Rng): SeasonRow[] {
  const rows: SeasonRow[] = [];
  for (let i = 0; i < 3; i++) {
    rows.push(playDtSeason(state, rng));
    if (state.dtJustFired || !state.clubId || state.age >= 65) break;
  }
  return rows;
}

/** Aplica la opción elegida, simula la temporada y prepara el próximo evento. */
export function chooseOption(state: CareerState, optionId: string): TurnResult {
  const rng = new Rng(state.rng);
  const ev = state.pendingEvent;
  let flash: string | null = null;
  let risk: TurnResult['risk'];

  const [verb, arg] = optionId.split(':');

  // penal decisivo: resuelve la final pendiente (no juega temporada, es un interludio del mismo año)
  if (verb === 'pen') {
    const p = state.pendingPenalty;
    state.pendingPenalty = null;
    if (!p) { state.pendingEvent = nextEvent(state, rng); return { season: null, flash: null }; }
    const zone = Number(arg);
    const r = resolvePenalty(rng, zone);
    const won = r.scored;
    const isWC = p.titleName.startsWith('Copa del Mundo');
    if (won) {
      state.titles.push({ year: p.year, title: p.titleName, clubName: p.clubName, as: 'jugador' });
      if (p.source === 'club' && state.stints.length > 0) currentStint(state).titles.push(p.titleName);
      if (p.source === 'nt') state.intlGoals += 1;
      state.fame = Math.min(100, state.fame + p.fameGoal);
      addMoment(state, isWC ? '🌍' : '🏆', `Metiste el penal decisivo: ${p.clubName} campeón de ${p.titleName}`);
      flash = `¡GOOOL! Mandaste al arquero para el otro palo. ${p.clubName} es campeón de ${p.titleName}.`;
    } else {
      state.fame = Math.max(0, state.fame - p.fameMiss);
      addMoment(state, '💔', `Erraste el penal decisivo en la final de ${p.titleName} (${p.year})`);
      flash = r.offTarget
        ? `Le pegaste al travesaño. Se escapó ${p.titleName} por centímetros.`
        : `El arquero voló a tu palo y la sacó. Se escapó ${p.titleName}.`;
    }
    state.pendingEvent = nextEvent(state, rng);
    return { season: null, flash, penalty: { zone, keeperZone: r.keeperZone, scored: won, offTarget: r.offTarget, titleName: p.titleName, competition: p.competition, won } };
  }

  // fin de la etapa de jugador: en vez de cerrar la historia, se abre la puerta del banco
  if (verb === 'retire' && arg === 'now') {
    state.retirementNote = 'Como jugador, elegiste irte en un buen momento, por la puerta grande.';
    addMoment(state, '👋', `Retiro como jugador a los ${state.age} años`);
    state.pendingEvent = dtDecisionEvent(state);
    return { season: null, flash: null };
  }
  if (verb === 'retire' && arg === 'gulf') {
    state.fame = Math.max(0, state.fame - 6);
    const gulf: CareerClub = {
      id: 'GULF-AlQimma', name: 'Al-Qimma SC', leagueId: 'GULF', leagueName: 'Liga del Golfo',
      country: 'Golfo', division: 1, elo: 1450, baseElo: 1450, prestige: 30,
      coeff: 45, confed: 'AFC',
    };
    state.clubs[gulf.id] = gulf;
    startStint(state, gulf.id, false);
    addMoment(state, '💰', 'Último baile: contrato millonario en el Golfo');
    const season = playSeason(state, rng);
    state.retirementNote = 'Cerraste tu etapa de jugador con un contrato millonario en el Golfo.';
    addMoment(state, '👋', `Retiro como jugador a los ${state.age} años`);
    state.pendingEvent = dtDecisionEvent(state);
    return { season, flash: null };
  }
  if (verb === 'retire' && arg === 'first') {
    startStint(state, state.firstClubId!, false);
    state.promisedStarter = true;
    state.fame = Math.min(100, state.fame + 10);
    addMoment(state, '🏠', `Volviste a ${state.clubs[state.firstClubId!].name} para el adiós`);
    const season = playSeason(state, rng);
    state.retirementNote = `Volviste a ${state.clubs[state.firstClubId!].name} para el adiós como jugador. Final de película.`;
    addMoment(state, '👋', `Retiro como jugador a los ${state.age} años`);
    state.pendingEvent = dtDecisionEvent(state);
    return { season, flash: null };
  }

  // decisión post-retiro y carrera de DT
  if (verb === 'dt') {
    if (arg === 'no') {
      state.retired = true;
      addMoment(state, '🚪', `Adiós definitivo al fútbol (${state.year})`);
      return { season: null, flash: null };
    }
    // dt:start — el prestigio de jugador define desde dónde arrancás
    state.phase = 'dt';
    state.dtSkill = Math.round(Math.min(82, 52 + state.fame * 0.28 + state.titles.length * 1.2));
    state.clubId = null;
    addMoment(state, '📋', `Curso de DT aprobado: empieza tu segunda vida en los bancos (nivel ${state.dtSkill})`);
    state.pendingEvent = dtOffersEvent(state, rng, true);
    return { season: null, flash: `Curso de DT aprobado. Tu chapa inicial como entrenador: nivel ${state.dtSkill}.` };
  }
  if (verb === 'dtretire') {
    state.retired = true;
    state.retirementNote = state.retirementNote || 'Dejaste el fútbol después de dos vidas: la de jugador y la del banco.';
    addMoment(state, '🚪', `Adiós definitivo al fútbol (${state.year})`);
    return { season: null, flash: null };
  }
  // decisiones de riesgo del DT: se resuelven y se juega la temporada en el mismo club
  if (verb === 'dtrisk') {
    if (arg === 'pibes') {
      const ok = rng.chance('event', 0.65);
      if (ok) { state.dtEdgeBoost = 2; state.fame = Math.min(100, state.fame + 3); flash = 'Los pibes respondieron: el equipo juega con un hambre que contagia.'; }
      else { state.dtEdgeBoost = -2; flash = 'La apuesta por los juveniles costó puntos. La prensa no perdona.'; }
      risk = { ok, text: flash };
    } else if (arg === 'esquema') {
      const ok = rng.chance('event', 0.55);
      if (ok) { state.dtEdgeBoost = 2.5; flash = 'Tu sistema revolucionario descolocó a todos. Los rivales no te encuentran la vuelta.'; }
      else { state.dtEdgeBoost = -2.5; flash = 'El vestuario nunca entendió la idea. Año de transición forzada.'; }
      risk = { ok, text: flash };
    } else if (arg === 'estrella-out') {
      const ok = rng.chance('event', 0.6);
      if (ok) { state.dtEdgeBoost = 2; flash = 'Borraste a la estrella y el grupo se hizo cargo. Autoridad intacta.'; }
      else { state.dtEdgeBoost = -2.5; flash = 'Sin tu mejor jugador, el equipo perdió peligro. La pulseada te salió cara.'; }
      risk = { ok, text: flash };
    } else if (arg === 'estrella-in') {
      state.dtEdgeBoost = 0.5;
      flash = 'Lo arreglaste puertas adentro. La paz también suma puntos.';
    } else if (arg === 'fichaje') {
      const ok = rng.chance('event', 0.5);
      if (ok) { state.dtEdgeBoost = 2; flash = 'La dirigencia aflojó: llegó el refuerzo que pediste.'; }
      else { state.dtEdgeBoost = -1; state.fame = Math.max(0, state.fame - 2); flash = 'Te dijeron que no en público. Quedaste debilitado.'; }
      risk = { ok, text: flash };
    } else if (arg === 'seleccion') {
      const natLevel = NAT_STRENGTH[state.nationality.replace(/ /g, '_')] ?? 72;
      const pWin = Math.pow(natLevel / 100, 6) * (20 + state.dtSkill / 4) / 100;
      const ok = rng.chance('event', pWin);
      if (ok) {
        state.titles.push({ year: state.year, title: `Copa del Mundo ${state.year}`, clubName: state.nationality, as: 'dt' });
        state.fame = Math.min(100, state.fame + 20);
        addMoment(state, '🌍', `CAMPEÓN DEL MUNDO como DT de ${state.nationality} (${state.year})`);
        flash = `¡¡CAMPEÓN DEL MUNDO como DT de ${state.nationality}!! El país es una fiesta.`;
      } else {
        state.fame = Math.max(0, state.fame - 4);
        addMoment(state, '🌍', `Dirigiste a ${state.nationality} en el Mundial ${state.year}: eliminado antes de la final`);
        flash = `El Mundial con ${state.nationality} terminó antes de lo soñado. Duele.`;
      }
      risk = { ok, text: flash };
    }
    // skip: sin efectos
    const cycle = playDtCycle(state, rng);
    const season = cycle[cycle.length - 1];
    state.pendingEvent = nextDtEvent(state, rng);
    return { season, flash: flash ?? season.note ?? null, risk, cycle };
  }

  if (verb === 'dtjoin' || verb === 'dtstay') {
    if (verb === 'dtjoin') {
      startStint(state, arg, false);
      addMoment(state, '🧠', `Asumiste como DT de ${state.clubs[arg].name} (${state.year})`);
    }
    const cycle = playDtCycle(state, rng);
    const season = cycle[cycle.length - 1];
    state.pendingEvent = nextDtEvent(state, rng);
    return { season, flash: season.note || null, cycle };
  }

  const chosenOption = ev.options.find((o) => o.id === optionId);

  if (verb === 'join') {
    const promised = optionId.endsWith(':promesa') || ev.kind === 'academia';
    const isReturn = state.stints.some((s) => s.clubId === arg);
    startStint(state, arg, false);
    state.promisedStarter = promised || state.ability >= clubLevel(state.clubs[arg]) - 2;
    if (ev.kind === 'academia') addMoment(state, '🎓', `Empezaste en la cantera de ${state.clubs[arg].name}`);
    else addMoment(state, isReturn ? '🏠' : '✍', `${isReturn ? 'Volviste a' : 'Fichaste por'} ${state.clubs[arg].name} (${state.year})`);
  } else if (verb === 'loan') {
    state.loanFromId = state.clubId;
    state.onLoan = true;
    startStint(state, arg, true);
    state.promisedStarter = true;
    addMoment(state, '🔁', `A préstamo a ${state.clubs[arg].name} en busca de minutos`);
  } else if (verb === 'nat') {
    if (arg !== 'keep') {
      state.nationality = arg.replace('_', ' ');
      state.fame = Math.max(0, state.fame - 5);
      flash = `Ahora representás a ${state.nationality}.`;
      addMoment(state, '🛂', `Cambio de selección: ahora jugás para ${state.nationality}`);
    }
  } else if (verb === 'risk') {
    if (arg === 'train') {
      const ok = rng.chance('event', 0.7);
      if (ok) { state.trainingBoost = 3; flash = 'La pretemporada brutal rindió: llegás volando.'; }
      else { state.formBoost = -0.5; state.trainingBoost = -1; flash = 'Te rompiste en la pretemporada. Año cuesta arriba.'; }
      risk = { ok, text: flash };
    } else if (arg === 'dope') {
      const ok = rng.chance('event', 0.75);
      if (ok) { state.trainingBoost = 4; flash = 'Nadie preguntó nada. Rendís como nunca.'; }
      else {
        state.suspendedSeasons = 1; state.fame = Math.max(0, state.fame - 15);
        flash = 'DOPING POSITIVO. Un año suspendido y tu nombre manchado.';
        addMoment(state, '🚫', `Doping positivo (${state.year}): un año de suspensión`);
      }
      risk = { ok, text: flash };
    } else if (arg === 'clean') {
      state.fame = Math.min(100, state.fame + 2);
    } else if (arg === 'force') {
      const ok = rng.chance('event', 0.55);
      if (ok) { state.formBoost = 0.4; state.fame = Math.min(100, state.fame + 8); flash = 'Jugaste infiltrado y respondiste como un héroe.'; }
      else { state.trainingBoost = -3; flash = 'La lesión se agravó: pagaste cara la infiltración.'; }
      risk = { ok, text: flash };
    }
    // rest / skip: sin efectos
  } else if (verb === 'nt') {
    const kind = ntEventKind(state.year);
    const nat = state.nationality;
    const cup = CONTINENTAL_CUP[natConfedOf(nat)];
    const lvl = natLevelOf(nat);
    if (arg === 'retire') {
      state.ntActive = false;
      addMoment(state, '🎽', `Te retiraste de la selección de ${nat} (${state.year})`);
      flash = `Colgaste la camiseta de ${nat}. Gracias por tanto.`;
    } else if (arg === 'rest') {
      state.formBoost += 0.3;
      flash = `Elegiste el club: ${nat} juega sin vos esta vez.`;
    } else if (arg === 'play' && kind) {
      state.caps += rng.int('match', 4, 8);
      if (ATTACKING_POS.has(state.position)) state.intlGoals += rng.int('match', 0, 3);
      if (!state.isCaptain && state.fame >= 60 && state.caps >= 25) {
        state.isCaptain = true;
        addMoment(state, '🎽', `Te pusieron la cinta de capitán de ${nat}`);
      }
      if (kind === 'eliminatorias') {
        state.ntQualified = rng.chance('event', Math.min(0.95, Math.pow(lvl / 100, 3) + 0.25));
        if (state.ntQualified) { state.fame = Math.min(100, state.fame + 2); addMoment(state, '🌍', `Clasificaste al Mundial con ${nat}`); flash = `Clasificaste al Mundial con ${nat}. El sueño sigue en pie.`; }
        else { state.fame = Math.max(0, state.fame - 3); addMoment(state, '😔', `${nat} no clasificó al Mundial`); flash = `Eliminatorias amargas: ${nat} se quedó afuera del próximo Mundial.`; }
      } else {
        const cupName = kind === 'mundial' ? `Copa del Mundo ${state.year}` : `${cup} ${state.year}`;
        const reachProb = kind === 'mundial'
          ? Math.min(0.6, Math.pow(lvl / 100, 5) * (0.7 + (state.ability - 70) / 260) + (state.isCaptain ? 0.03 : 0))
          : Math.min(0.72, Math.pow(lvl / 100, 3) * 0.85 + (state.ability - 70) / 300);
        if (rng.chance('event', reachProb)) {
          deferToPenalty(state, {
            titleName: cupName, competition: kind === 'mundial' ? 'MUNDIAL' : cup.toUpperCase(),
            source: 'nt', clubName: nat, year: state.year,
            fameGoal: kind === 'mundial' ? 24 : 12, fameMiss: kind === 'mundial' ? 10 : 6,
          });
          flash = `¡${nat} a la FINAL de ${cupName}! Y se define por penales…`;
        } else {
          state.fame = Math.min(100, state.fame + (kind === 'mundial' ? 3 : 2));
          addMoment(state, kind === 'mundial' ? '🌍' : '🌎', `Jugaste ${kind === 'mundial' ? `el Mundial ${state.year}` : `la ${cup} ${state.year}`} con ${nat}`);
          flash = `Dejaste todo con ${nat}, pero el título quedó en el camino esta vez.`;
        }
      }
    }
  }
  // 'stay': sin cambios de club

  const season = playSeason(state, rng);
  // si una final quedó a definir por penal, el próximo turno es el penal decisivo
  state.pendingEvent = state.pendingPenalty ? penaltyEvent(state) : nextEvent(state, rng);
  return chosenOption
    ? resultWithMeme({ season, flash, risk }, state, ev, chosenOption)
    : { season, flash, risk };
}

// ------------------------------ Legado ------------------------------

export type CareerLegacy = {
  score: number;
  tier: string;
  tagline: string;
  totalApps: number;
  totalGoals: number;
  titleCount: Record<string, number>;
  breakdown: string[];
  dtSeasons: number;
  dtTitles: number;
  dtMatches: number;
  /** premios individuales ganados (MVP de liga, Balón de Oro), con año */
  awards: { year: number; award: string }[];
};

function classify(title: string): string {
  return title.startsWith('Copa del Mundo') ? 'Copa del Mundo'
    : /Copa América|Eurocopa|Copa Oro|Copa Africana|Copa Asiática/.test(title) ? 'Selección continental'
      : /Champions League|Europa League|Conference League|Copa Libertadores|Copa Sudamericana|Concacaf Champions/.test(title) ? 'Copa Continental'
        : title.startsWith('Copa de') ? 'Copas nacionales'
          : title.startsWith('Ascenso') ? 'Ascensos' : 'Ligas';
}

export function computeCareerLegacy(state: CareerState): CareerLegacy {
  const playerSeasons = state.seasons.filter((s) => s.role !== 'Director técnico');
  const dtSeasonRows = state.seasons.filter((s) => s.role === 'Director técnico');
  const totalApps = playerSeasons.reduce((a, s) => a + s.apps, 0);
  const totalGoals = playerSeasons.reduce((a, s) => a + s.goals, 0);
  const dtMatches = dtSeasonRows.reduce((a, s) => a + s.apps, 0);

  const titleCount: Record<string, number> = {};
  const dtCount: Record<string, number> = {};
  for (const t of state.titles) {
    const key = classify(t.title);
    if (t.as === 'dt') dtCount[key] = (dtCount[key] ?? 0) + 1;
    else titleCount[key] = (titleCount[key] ?? 0) + 1;
  }
  const dtTitles = Object.values(dtCount).reduce((a, b) => a + b, 0);

  const breakdown: string[] = [];
  let score = 0;
  const add = (pts: number, label: string) => { if (Math.round(pts) !== 0) { score += pts; breakdown.push(`${label}: +${Math.round(pts)}`); } };
  // rendimientos decrecientes: el 1er título vale entero, cada repetición vale menos
  // (suma geométrica: base·(1-decay^n)/(1-decay); un multicampeón no rompe la escala)
  const dim = (n: number, base: number, decay: number) => (n > 0 ? base * (1 - Math.pow(decay, n)) / (1 - decay) : 0);
  add(dim(titleCount['Copa del Mundo'] ?? 0, 180, 0.55), 'Copas del Mundo');
  add(dim(titleCount['Selección continental'] ?? 0, 60, 0.7), 'Títulos con tu selección');
  add(dim(titleCount['Copa Continental'] ?? 0, 80, 0.7), 'Copas continentales');
  add(dim(titleCount['Ligas'] ?? 0, 45, 0.8), 'Ligas como jugador');
  add(dim(titleCount['Copas nacionales'] ?? 0, 18, 0.75), 'Copas nacionales');
  add(dim(titleCount['Ascensos'] ?? 0, 10, 0.6), 'Ascensos');
  const awards = state.awards ?? [];
  const ballonCount = awards.filter((a) => a.award.startsWith('Balón de Oro')).length;
  const mvpCount = awards.length - ballonCount;
  add(dim(ballonCount, 50, 0.6), 'Balones de Oro');
  add(dim(mvpCount, 14, 0.75), 'Premios MVP');
  add(Math.min(100, totalGoals * 0.25), 'Goles');
  add(Math.min(70, totalApps * 0.08), 'Partidos');
  add(Math.min(50, state.caps * 0.4), 'Partidos de selección');
  // segunda vida: el banco también hace leyenda (pero menos que los botines)
  add(dim(dtCount['Copa del Mundo'] ?? 0, 120, 0.5), 'Mundiales como DT');
  add(dim(dtCount['Copa Continental'] ?? 0, 55, 0.65), 'Copas continentales como DT');
  add(dim(dtCount['Ligas'] ?? 0, 30, 0.75), 'Ligas como DT');
  add(dim(dtCount['Copas nacionales'] ?? 0, 12, 0.7), 'Copas como DT');
  add(dim(dtCount['Ascensos'] ?? 0, 8, 0.6), 'Ascensos como DT');
  add(Math.min(40, dtSeasonRows.length * 2), 'Temporadas dirigidas');
  add(Math.min(60, Math.round(state.fame * 0.6)), 'Fama final');
  // curva legendaria: de 500 para arriba cada punto cuesta más; 1000 es asíntota (GOAT total)
  const raw = score;
  if (raw > 500) {
    const upper = raw <= 850 ? 500 + (raw - 500) * 0.6 : 710 + 290 * (1 - Math.exp(-(raw - 850) / 420));
    breakdown.push(`Escala legendaria (arriba de 500 cada punto cuesta más): −${Math.round(raw - upper)}`);
    score = upper;
  }
  score = Math.round(Math.max(0, Math.min(1000, score)));

  const playerBig = (titleCount['Ligas'] ?? 0) + (titleCount['Copa Continental'] ?? 0) * 2 + (titleCount['Copa del Mundo'] ?? 0) * 3;
  const dtBig = (dtCount['Ligas'] ?? 0) + (dtCount['Copa Continental'] ?? 0) * 2;
  // tiers alineados a la escala real: el autopiloto "perfecto" ronda 600-650
  const tier = score >= 700 ? 'LEYENDA MUNDIAL'
    : score >= 600 && playerBig >= 3 && dtBig >= 2 ? 'DOBLE LEYENDA'
      : score >= 480 ? 'ÍDOLO ETERNO'
        : score >= 340 ? 'CRACK CONSAGRADO'
          : score >= 200 ? 'MUY BUEN PROFESIONAL'
            : score >= 90 ? 'JORNALERO DEL FÚTBOL' : 'PROMESA QUE NO FUE';

  const clubsCount = new Set(state.stints.filter((s) => s.as === 'jugador').map((s) => s.clubId)).size;
  const tagline = playerBig >= 3 && dtBig >= 2
    ? 'Ganó como jugador, ganó como DT. De esos nacen las estatuas.'
    : (titleCount['Copa del Mundo'] ?? 0) > 0
      ? `Campeón del mundo con ${state.nationality}. No hace falta decir más.`
      : dtTitles > 0
        ? `Lo que no ganó con los botines lo fue a buscar desde el banco: ${dtTitles} título${dtTitles > 1 ? 's' : ''} como DT.`
        : clubsCount === 1
          ? `Toda una vida en ${state.stints[0]?.clubName}. Bandera de un solo club.`
          : clubsCount >= 6
            ? `Trotamundos: ${clubsCount} clubes, mil vestuarios, una sola pasión.`
            : `${playerSeasons.length} temporadas de profesional puro.`;

  return { score, tier, tagline, totalApps, totalGoals, titleCount, breakdown, dtSeasons: dtSeasonRows.length, dtTitles, dtMatches, awards };
}
