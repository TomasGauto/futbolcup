import type { RngState } from './rng';

// ------------------------------ Jugadores ------------------------------

export type Position = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'CM' | 'AM' | 'LW' | 'RW' | 'ST';

export type Trait = 'cantera' | 'líder' | 'frágil' | 'mercenario' | 'ídolo' | 'polémico' | 'promesa';

export type Injury = { type: string; weeksLeft: number };

export type Player = {
  id: string;
  name: string;
  nationality: string;
  age: number;
  position: Position;
  overall: number; // 40–95
  potential: number; // >= overall
  traits: Trait[];
  form: number; // -10..10
  morale: number; // 0..100
  fitness: number; // 0..100
  injury?: Injury;
  contract: { yearsLeft: number; wage: number; releaseClause?: number };
  value: number; // millones
  wantsToLeave: boolean;
  homegrown: boolean;
  promisedRole: 'titular' | 'rotación' | 'promesa';
  seasonStats: { apps: number; goals: number; assists: number; rating: number };
  careerGoals: number;
  careerApps: number;
  yearsAtClub: number;
};

// ------------------------------ Club ------------------------------

export type Stadium = {
  name: string;
  capacity: number;
  quality: number; // 1–100
  ticketPrice: number; // precio promedio
  maintenanceDebt: number;
  namingRights?: { sponsor: string; annual: number; yearsLeft: number };
  works?: { label: string; seasonsLeft: number; capacityDelta: number; qualityDelta: number };
};

export type Facilities = {
  academy: number; // 1-5
  medical: number;
  training: number;
  scouting: number;
  dataDept: number;
  womensTeam: boolean;
};

export type Sponsor = {
  slot: 'camiseta' | 'manga' | 'entrenamiento' | 'naming';
  brand: string;
  annual: number;
  yearsLeft: number;
  toxic: boolean; // apuestas / dudosos: más plata, menos humor de hinchada
};

export type DebtItem = {
  label: string;
  principal: number;
  rate: number; // interés anual
  yearsLeft: number;
};

export type Finances = {
  cash: number; // millones
  wageBudget: number;
  ffpWindow: number[]; // pérdidas (negativas) últimas 3 temporadas
  creditRating: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC';
  lastPnL: PnL | null;
  ffpSanction: number; // 0 = nada, 1 advertencia, 2 multa, 3 sin fichajes, 4 quita de puntos
};

export type PnL = {
  season: string;
  matchday: number;
  tv: number;
  commercial: number;
  prizes: number;
  playerSales: number;
  wages: number;
  amortization: number;
  maintenance: number;
  interest: number;
  operating: number;
  net: number;
};

export type AiProfile = 'ambicioso' | 'conservador' | 'formador' | 'mecenas' | 'en crisis';

export type SeasonRecord = {
  season: string; // "2026/27"
  leagueId: string;
  division: number;
  position: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  cupResult: string;
  continental: string;
  titles: string[];
};

export type Club = {
  id: string;
  name: string;
  shortName: string;
  country: string;
  leagueId: string; // liga actual (puede cambiar por ascenso/descenso)
  division: number; // 1..3
  colors: { primary: string; secondary: string };
  elo: number;
  attack: number; // rating Dixon-Coles (log-scale, ~0 promedio)
  defense: number;
  style: { aggression: number; dominance: number; homeAdv: number };
  prestige: number; // 1–100
  fanbase: { size: number; loyalty: number; expectation: number; mood: number };
  stadium: Stadium;
  facilities: Facilities;
  finances: Finances;
  squad: Player[];
  sponsors: Sponsor[];
  debt: DebtItem[];
  aiProfile: AiProfile;
  philosophy: 'posesión' | 'presión alta' | 'contragolpe' | 'bloque bajo' | 'juego directo';
  coachQuality: number; // 40-95
  identity: number; // 0-100: identidad de club (doctrinas erráticas la bajan)
  history: SeasonRecord[];
  amortPool: { annual: number; yearsLeft: number }[]; // amortización de fichajes
  continentalCoeff: number;
};

// ------------------------------ Ligas ------------------------------

export type League = {
  id: string;
  name: string;
  country: string;
  division: number;
  clubIds: string[];
  tvBase: number; // millones base por temporada para el 1º
  tvCycleMult: number; // ciclo de derechos vigente
  homeAdvElo: number; // ventaja de localía en puntos Elo
  relegations: number;
  promotions: number;
  continentalSlots: { elite: number; second: number; third: number };
  coeff: number; // coeficiente de liga
  confederation: Confederation;
};

// Confederación continental: define en qué copas compite la liga.
export type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'AFC';

// ------------------------------ Partidos / temporada ------------------------------

export type MatchResult = {
  homeId: string;
  awayId: string;
  hg: number;
  ag: number;
  scorersHome: string[];
  scorersAway: string[];
};

export type LeagueRow = {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  points: number;
};

// ------------------------------ Decisiones y eventos ------------------------------

export type DoctrineAxis =
  | 'cantera'
  | 'fichajes'
  | 'estadio'
  | 'comercial'
  | 'saneamiento'
  | 'proyecto';

export type NarrativeEvent = {
  season: string;
  biennium: number;
  headline: string;
  body: string;
  kind: 'prensa' | 'mercado' | 'vestuario' | 'institucional' | 'hinchada' | 'mundo' | 'hito';
};

export type Moment = {
  id: string;
  title: string;
  body: string;
  options: MomentOption[];
};

export type MomentOption = {
  label: string;
  detail: string; // costo/riesgo declarado
  effects: MomentEffects;
};

export type MomentEffects = {
  cash?: number;
  boardTrust?: number;
  fanMood?: number;
  squadMorale?: number;
  formBoost?: number; // ajusta forma del equipo el resto de la temporada
  sellPlayerId?: string;
  sellPrice?: number;
  /** firma un sponsor de apuestas por este monto anual (3 años) */
  addToxicSponsor?: number;
  note?: string;
  riskyChance?: number; // prob de que salga bien; si sale mal se aplican failEffects
  failEffects?: Omit<MomentEffects, 'riskyChance' | 'failEffects'>;
};

// ------------------------------ Manager y partida ------------------------------

export type Background = 'ídolo' | 'cantera' | 'financiero' | 'datos' | 'agente';

export type Manager = {
  name: string;
  nationality: string;
  background: Background;
  reputation: number;
};

export type BoardObjectives = {
  sportive: string;
  sportiveTargetPos: number;
  financial: string;
  soft: string;
};

export type Phase =
  | 'onboarding'
  | 'planificacion'
  | 'mercadoA'
  | 'temporadaA'
  | 'entretiempo'
  | 'temporadaB'
  | 'cierre'
  | 'legado'
  | 'despido';

export type KoRound = { name: string; results: MatchResult[] };

export type KoCup = {
  id: string;
  name: string;
  comp: 'copa' | 'elite' | 'second' | 'third';
  confederation?: Confederation; // continental cups: a qué confederación pertenece
  country?: string;
  alive: string[]; // ids vivos (se aparean por sorteo determinista)
  roundsPlayed: KoRound[];
  winner: string | null;
  schedule: number[]; // rondas de liga tras las cuales se juega cada fase
  kFactor: number;
  prizePerWin: number;
  participation: number;
};

export type SeasonLive = {
  seasonIdx: number; // 0..29
  fixturesByLeague: Record<string, { round: number; matches: { homeId: string; awayId: string }[] }[]>;
  tables: Record<string, LeagueRow[]>;
  playerResults: MatchResult[][]; // por ronda, solo liga del jugador
  round: number; // próxima ronda a jugar (0-based)
  totalRounds: number; // rondas de la liga del jugador
  momentsFired: number;
  pendingMoment: Moment | null;
  cups: KoCup[];
  playerFormBoost: number;
  prizes: Record<string, number>; // clubId -> premios acumulados (M)
  cupResultText: Record<string, string>; // clubId -> "Copa: semifinal", etc.
};

export type Difficulty = 'Sandbox' | 'Realista' | 'Leyenda';

export type GameState = {
  seed: string;
  version: string;
  difficulty: Difficulty;
  clubId: string;
  manager: Manager;
  currentBiennium: number; // 1..15
  currentSeason: number; // 1..30
  phase: Phase;
  doctrine: DoctrineAxis[]; // 2 ejes del bienio actual
  boardTrust: number; // 0-100
  objectives: BoardObjectives;
  clubs: Record<string, Club>;
  leagues: League[];
  marketIndex: number; // inflación global, arranca 1.0
  /** ventas de jugadores por club en la temporada en curso (para el P&L; la caja ya se acreditó al vender) */
  salesThisSeason: Record<string, number>;
  prevDoctrine: DoctrineAxis[];
  seasonLive: SeasonLive | null;
  log: NarrativeEvent[];
  rng: RngState;
  champions: Record<string, string[]>; // leagueId -> campeón por temporada
  continentalChampions: string[];
  managerTitles: string[];
  fired: boolean;
  /** métrica por temporada del club del jugador (para gráficos e Historia) */
  annals: Annal[];
  /** jugadores que pasaron por el club (para el once ideal de la era) */
  legends: Record<string, LegendEntry>;
  /** foto inicial del club para la comparación final */
  baseline: { elo: number; prestige: number; squadValue: number; division: number; expectedPos: number };
};

export type Annal = {
  season: string;
  division: number;
  position: number;
  points: number;
  cash: number;
  squadValue: number;
  prestige: number;
  fanMood: number;
  boardTrust: number;
  wageBill: number;
  revenue: number;
  note: string;
};

export type LegendEntry = {
  name: string;
  position: Position;
  apps: number;
  goals: number;
  ratingSum: number;
  seasons: number;
};

export const SEASON_LABELS: string[] = Array.from({ length: 30 }, (_, i) => {
  const y = 2026 + i;
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
});
