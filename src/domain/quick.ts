// Modo "partida rápida": 15 decisiones (una por bienio), simulación instantánea.
// Reutiliza todo el motor; este módulo solo define las cartas de decisión y el
// avance de un bienio completo en una llamada síncrona.

import { Rng } from './rng';
import type { GameState, Player } from './types';
import { startSeason, stepRound, resolveMoment, endSeasonProcessing, closeBiennium } from './engine';
import { genPlayer, genYouth } from './playergen';
import { leagueMultFor } from './development';
import { fairWage } from './valuation';

export type Chip = { t: string; tone: 'good' | 'bad' | 'warn' };

export type QuickCard = {
  id: string;
  icon: string;
  title: string;
  desc: string; // una línea: qué es
  chips: Chip[]; // efectos de un vistazo: verde = a favor, rojo = en contra, amarillo = costo/riesgo
  apply: (state: GameState, rng: Rng) => string;
};

/** Fuerza del plantel: media de los 14 mejores (lo que sale a la cancha). */
export function squadStrength(state: GameState): number {
  const squad = state.clubs[state.clubId].squad;
  const top = [...squad].sort((a, b) => b.overall - a.overall).slice(0, 14);
  if (top.length === 0) return 0;
  return Math.round(top.reduce((a, p) => a + p.overall, 0) / top.length);
}

const r1 = (x: number) => Number(x.toFixed(1));

function star(state: GameState): Player | undefined {
  return [...state.clubs[state.clubId].squad].sort((a, b) => b.value - a.value)[0];
}

function weakestAttacker(state: GameState): Player | undefined {
  const me = state.clubs[state.clubId];
  return me.squad.filter((p) => ['ST', 'LW', 'RW', 'AM'].includes(p.position)).sort((a, b) => b.overall - a.overall)[0];
}

// ------------------------------ Pool de cartas ------------------------------

const CARDS: ((state: GameState) => QuickCard | null)[] = [
  // Vender a la figura
  (s) => {
    const p = star(s);
    if (!p || p.overall < 72) return null;
    const price = r1(p.value * 1.35);
    return {
      id: 'vender-figura', icon: '💸',
      title: `Vender a ${p.name} (${p.overall})`,
      desc: 'Hacé caja con tu mejor jugador.',
      chips: [
        { t: `+${price}M ya`, tone: 'good' },
        { t: 'Equipo más débil', tone: 'bad' },
        { t: `Hinchada −${p.traits.includes('ídolo') ? 18 : 12}`, tone: 'bad' },
      ],
      apply: (st, rng) => {
        const me = st.clubs[st.clubId];
        me.squad = me.squad.filter((x) => x.id !== p.id);
        me.finances.cash = r1(me.finances.cash + price);
        st.salesThisSeason[me.id] = r1((st.salesThisSeason[me.id] ?? 0) + price);
        me.fanbase.mood = Math.max(5, me.fanbase.mood - (p.traits.includes('ídolo') ? 18 : 12));
        for (const mate of me.squad) mate.morale = Math.max(10, mate.morale - 5);
        return `${p.name} vendido por ${price}M.`;
      },
    };
  },
  // Fichar una estrella
  (s) => {
    const me = s.clubs[s.clubId];
    const target = Math.min(90, Math.round(me.squad.reduce((a, p) => a + p.overall, 0) / me.squad.length) + 8);
    const costEstimate = r1(0.0042 * Math.exp(0.115 * target) * 1.4 * s.marketIndex);
    return {
      id: 'fichar-estrella', icon: '⭐',
      title: `Fichar un crack (~${target})`,
      desc: 'Un refuerzo de jerarquía para dar el salto.',
      chips: [
        { t: 'Equipo más fuerte', tone: 'good' },
        { t: 'Hinchada +8', tone: 'good' },
        { t: `~−${costEstimate}M (o deuda al 8%)`, tone: 'warn' },
      ],
      apply: (st, rng) => {
        const club = st.clubs[st.clubId];
        const pos = weakestAttacker(st)?.position ?? 'ST';
        const p = genPlayer(rng, {
          country: club.country, position: pos, targetOverall: target,
          leagueMult: leagueMultFor(club), prestige: club.prestige, marketIndex: st.marketIndex,
        });
        p.overall = Math.max(p.overall, target - 2); p.potential = Math.max(p.potential, p.overall);
        const fee = r1(p.value * 1.3);
        if (club.finances.cash < fee) {
          club.debt.push({ label: `Fichaje ${p.name}`, principal: r1(fee - Math.max(0, club.finances.cash)), rate: 0.08, yearsLeft: 5 });
          club.finances.cash = r1(Math.min(club.finances.cash, 0));
        } else {
          club.finances.cash = r1(club.finances.cash - fee);
        }
        club.amortPool.push({ annual: r1(fee / 4), yearsLeft: 4 });
        p.contract = { yearsLeft: 4, wage: fairWage(p, leagueMultFor(club), club.prestige) * 1.2 };
        p.yearsAtClub = 0;
        club.squad.push(p);
        club.fanbase.mood = Math.min(97, club.fanbase.mood + 8);
        return `Llegó ${p.name} (${p.overall}) por ${fee}M. La ciudad está revolucionada.`;
      },
    };
  },
  // Apostar a la cantera
  () => ({
    id: 'cantera', icon: '🌱',
    title: 'Apostar todo a la cantera',
    desc: 'Academia +1 y debutan 3 juveniles del club.',
    chips: [
      { t: 'Gratis', tone: 'good' },
      { t: 'Futuro brillante', tone: 'good' },
      { t: 'Más flojos hoy', tone: 'warn' },
    ],
    apply: (st, rng) => {
      const me = st.clubs[st.clubId];
      me.facilities.academy = Math.min(5, me.facilities.academy + 1);
      const names: string[] = [];
      for (let i = 0; i < 3; i++) {
        const y = genYouth(rng, { country: me.country, academyLevel: me.facilities.academy, leagueMult: leagueMultFor(me), prestige: me.prestige, marketIndex: st.marketIndex });
        me.squad.push(y);
        names.push(`${y.name} (${y.age})`);
      }
      me.fanbase.mood = Math.min(97, me.fanbase.mood + 5);
      me.identity = Math.min(100, me.identity + 8);
      return `Debutan ${names.join(', ')}. La gente ama ver pibes del club.`;
    },
  }),
  // Ampliar estadio
  (s) => {
    const me = s.clubs[s.clubId];
    if (me.stadium.works) return null;
    const cost = Math.round(85 * s.marketIndex);
    return {
      id: 'estadio', icon: '🏟',
      title: 'Ampliar el estadio (+15.000)',
      desc: 'Más aforo = más recaudación cada temporada, para siempre.',
      chips: [
        { t: 'Ingresos futuros ↑', tone: 'good' },
        { t: `Deuda ${cost}M a 10 años`, tone: 'warn' },
        { t: '1 año con aforo −20%', tone: 'bad' },
      ],
      apply: (st) => {
        const club = st.clubs[st.clubId];
        club.debt.push({ label: 'Ampliación estadio', principal: cost, rate: 0.06, yearsLeft: 10 });
        club.stadium.works = { label: 'Ampliación', seasonsLeft: 1, capacityDelta: 15000, qualityDelta: 8 };
        return `Arrancó la obra: ${club.stadium.name} tendrá ${(club.stadium.capacity + 15000).toLocaleString('es-AR')} localidades.`;
      },
    };
  },
  // Sponsor de apuestas
  (s) => {
    const me = s.clubs[s.clubId];
    if (me.sponsors.some((x) => x.toxic)) return null;
    const amount = r1((6 + me.prestige * 0.3) * s.marketIndex);
    return {
      id: 'sponsor-toxico', icon: '🎰',
      title: `Sponsor de apuestas (${amount}M/año)`,
      desc: 'BetMaxx paga muy por encima del mercado, por 4 años.',
      chips: [
        { t: `+${amount}M por año`, tone: 'good' },
        { t: 'Hinchada −10', tone: 'bad' },
      ],
      apply: (st) => {
        const club = st.clubs[st.clubId];
        club.sponsors.push({ slot: 'manga', brand: 'BetMaxx', annual: amount, yearsLeft: 4, toxic: true });
        club.fanbase.mood = Math.max(5, club.fanbase.mood - 10);
        return `BetMaxx en la manga: ${amount}M/año. Las agrupaciones ya colgaron banderas en contra.`;
      },
    };
  },
  // Subir precios
  () => ({
    id: 'precios-arriba', icon: '🎟',
    title: 'Subir las entradas 25%',
    desc: 'Exprimí la recaudación por butaca.',
    chips: [
      { t: 'Más ingresos por partido', tone: 'good' },
      { t: 'Asistencia −9%', tone: 'bad' },
      { t: 'Hinchada −6', tone: 'bad' },
    ],
    apply: (st) => {
      const club = st.clubs[st.clubId];
      club.stadium.ticketPrice = Math.round(club.stadium.ticketPrice * 1.25);
      club.fanbase.mood = Math.max(5, club.fanbase.mood - 6);
      return `Entradas a $${club.stadium.ticketPrice}. Silbidos en la popular.`;
    },
  }),
  // Bajar precios
  (s) => (s.clubs[s.clubId].fanbase.mood < 60 ? {
    id: 'precios-abajo', icon: '❤',
    title: 'Bajar las entradas 15%',
    desc: 'Gesto para reconquistar a la gente.',
    chips: [
      { t: 'Hinchada +9', tone: 'good' },
      { t: 'Cancha llena', tone: 'good' },
      { t: 'Menos ingresos', tone: 'warn' },
    ],
    apply: (st) => {
      const club = st.clubs[st.clubId];
      club.stadium.ticketPrice = Math.max(8, Math.round(club.stadium.ticketPrice * 0.85));
      club.fanbase.mood = Math.min(97, club.fanbase.mood + 9);
      return `Entradas a $${club.stadium.ticketPrice}. La cancha vuelve a ser una fiesta.`;
    },
  } : null),
  // DT estrella
  (s) => (s.clubs[s.clubId].coachQuality < 85 ? {
    id: 'dt-estrella', icon: '🧠',
    title: 'Contratar un DT estrella',
    desc: 'Un entrenador de elite en el banco.',
    chips: [
      { t: 'Equipo rinde más', tone: 'good' },
      { t: `−${Math.round(28 * s.marketIndex)}M`, tone: 'warn' },
    ],
    apply: (st) => {
      const club = st.clubs[st.clubId];
      const cost = Math.round(28 * st.marketIndex);
      club.finances.cash = r1(club.finances.cash - cost);
      club.coachQuality = 88;
      return `Nuevo DT de elite en el banco (−${cost}M). Conferencia de prensa a sala llena.`;
    },
  } : null),
  // Saneamiento
  (s) => (s.clubs[s.clubId].debt.length > 0 || s.clubs[s.clubId].finances.cash < 20 ? {
    id: 'sanear', icon: '🧹',
    title: 'Vender 2 suplentes caros',
    desc: 'Orden financiero: achicá la masa salarial.',
    chips: [
      { t: '+caja', tone: 'good' },
      { t: 'Menos salarios', tone: 'good' },
      { t: 'Plantel corto', tone: 'warn' },
    ],
    apply: (st) => {
      const club = st.clubs[st.clubId];
      const bench = [...club.squad].sort((a, b) => b.contract.wage - a.contract.wage).slice(2, 4);
      let total = 0;
      for (const p of bench) {
        club.squad = club.squad.filter((x) => x.id !== p.id);
        total += p.value;
        st.salesThisSeason[club.id] = r1((st.salesThisSeason[club.id] ?? 0) + p.value);
      }
      club.finances.cash = r1(club.finances.cash + total);
      return `Salieron ${bench.map((p) => p.name).join(' y ')}: +${r1(total)}M y menos salarios.`;
    },
  } : null),
  // Gira mundial
  () => ({
    id: 'gira', icon: '✈',
    title: 'Gira por Asia y EE.UU.',
    desc: 'Plata rápida a cambio de pretemporada.',
    chips: [
      { t: 'Ingreso inmediato', tone: 'good' },
      { t: 'Plantel cansado', tone: 'bad' },
      { t: 'Más lesiones', tone: 'bad' },
    ],
    apply: (st) => {
      const club = st.clubs[st.clubId];
      const income = r1((10 + club.prestige * 0.35) * st.marketIndex);
      club.finances.cash = r1(club.finances.cash + income);
      for (const p of club.squad) p.fitness = Math.max(60, p.fitness - 12);
      return `Gira cerrada: +${income}M y estadios llenos en Yakarta y Los Ángeles.`;
    },
  }),
  // Centro médico + entrenamiento
  (s) => {
    const me = s.clubs[s.clubId];
    if (me.facilities.medical >= 5 && me.facilities.training >= 5) return null;
    const cost = Math.round(30 * s.marketIndex);
    return {
      id: 'infraestructura', icon: '🏥',
      title: 'Invertir en ciencias del deporte',
      desc: 'Centro médico y entrenamiento +1.',
      chips: [
        { t: 'Menos lesiones', tone: 'good' },
        { t: 'Jugadores mejoran más', tone: 'good' },
        { t: `−${cost}M`, tone: 'warn' },
      ],
      apply: (st) => {
        const club = st.clubs[st.clubId];
        club.finances.cash = r1(club.finances.cash - cost);
        club.facilities.medical = Math.min(5, club.facilities.medical + 1);
        club.facilities.training = Math.min(5, club.facilities.training + 1);
        return `Instalaciones de primer nivel (−${cost}M). Los jugadores lo notan.`;
      },
    };
  },
  // Blindar a la figura
  (s) => {
    const p = star(s);
    if (!p || p.contract.yearsLeft > 2) return null;
    return {
      id: 'blindar', icon: '🔒',
      title: `Blindar a ${p.name}`,
      desc: 'Tu figura termina contrato: renovación de por vida.',
      chips: [
        { t: 'Se queda 5 años', tone: 'good' },
        { t: 'Hinchada +6', tone: 'good' },
        { t: 'Salario +40%', tone: 'warn' },
      ],
      apply: (st) => {
        const club = st.clubs[st.clubId];
        p.contract = { yearsLeft: 5, wage: r1(p.contract.wage * 1.4) };
        p.morale = Math.min(96, p.morale + 12);
        p.wantsToLeave = false;
        club.fanbase.mood = Math.min(97, club.fanbase.mood + 6);
        return `${p.name} renovó hasta ${2031 + st.currentSeason}. Bandera nueva en la popular.`;
      },
    };
  },
  // Estabilidad
  () => ({
    id: 'estabilidad', icon: '🧘',
    title: 'No tocar nada: continuidad',
    desc: 'A veces lo mejor es no hacer nada.',
    chips: [
      { t: 'Gratis', tone: 'good' },
      { t: 'Junta +4, plantel tranquilo', tone: 'good' },
      { t: 'Sin refuerzos', tone: 'warn' },
    ],
    apply: (st) => {
      const club = st.clubs[st.clubId];
      club.identity = Math.min(100, club.identity + 8);
      st.boardTrust = Math.min(100, st.boardTrust + 4);
      for (const p of club.squad) p.morale = Math.min(96, p.morale + 3);
      return 'Paz institucional. El plantel entrena tranquilo por primera vez en años.';
    },
  }),
  // Tomar deuda para invertir
  (s) => (s.clubs[s.clubId].debt.reduce((a, d) => a + d.principal, 0) < 100 ? {
    id: 'deuda', icon: '🏦',
    title: 'Bono a 10 años: 80M frescos',
    desc: 'Caja inmediata para lo que venga.',
    chips: [
      { t: '+80M ya', tone: 'good' },
      { t: 'Interés 5.6M/año × 10', tone: 'bad' },
    ],
    apply: (st) => {
      const club = st.clubs[st.clubId];
      club.debt.push({ label: 'Bono 10 años', principal: 80, rate: 0.07, yearsLeft: 10 });
      club.finances.cash = r1(club.finances.cash + 80);
      return 'Emisión colocada: +80M. Los analistas dudan; el mercado, no.';
    },
  } : null),
];

export function drawCards(state: GameState, rng: Rng, n = 3): QuickCard[] {
  const available = CARDS.map((f) => f(state)).filter((c): c is QuickCard => c !== null);
  return rng.shuffle('event', available).slice(0, n);
}

// ------------------------------ Simulación de un bienio ------------------------------

export type SeasonLine = {
  season: string;
  division: number;
  position: number;
  points: number;
  cup: string;
  titles: string[];
};

export type BienniumRecap = {
  seasons: SeasonLine[];
  moments: string[];
  headlines: string[];
  cashDelta: number;
  trustBefore: number;
  trustAfter: number;
  moodBefore: number;
  moodAfter: number;
  strengthBefore: number;
  strengthAfter: number;
  prestigeBefore: number;
  prestigeAfter: number;
  titlesWon: string[]; // "Copa de España 2031/32"
  objectiveMet: boolean | null; // null = todavía no evaluable
  warnings: string[];
  gameOver: boolean;
  gameOverReason: string | null;
};

function simulateOneSeason(state: GameState, rng: Rng, moments: string[]): void {
  startSeason(state);
  for (;;) {
    const out = stepRound(state);
    if (out.moment) {
      // auto-resolución: elige una opción al azar (el caos también es fútbol)
      const idx = rng.int('event', 0, out.moment.options.length - 1);
      const title = out.moment.title;
      const result = resolveMoment(state, idx);
      moments.push(`${title} → ${result}`);
    }
    if (out.seasonOver) break;
  }
  endSeasonProcessing(state);
}

/** Simula el bienio completo (2 temporadas + cierre) de forma síncrona. */
export function simulateBiennium(state: GameState): BienniumRecap {
  const rng = new Rng(state.rng);
  const me = state.clubs[state.clubId];
  const cashBefore = me.finances.cash;
  const trustBefore = state.boardTrust;
  const moodBefore = me.fanbase.mood;
  const strengthBefore = squadStrength(state);
  const prestigeBefore = me.prestige;
  const targetPos = state.objectives.sportiveTargetPos;
  const logBefore = state.log.length;
  const moments: string[] = [];

  if (state.phase === 'planificacion') state.phase = 'mercadoA';

  simulateOneSeason(state, rng, moments);
  if ((state.phase as string) !== 'despido') {
    if (state.phase === 'entretiempo') state.phase = 'mercadoA';
    simulateOneSeason(state, rng, moments);
    if (state.phase === 'cierre') closeBiennium(state);
  }

  const seasons: SeasonLine[] = me.history.slice(-2).map((r) => ({
    season: r.season,
    division: r.division,
    position: r.position,
    points: r.points,
    cup: r.cupResult,
    titles: r.titles,
  }));

  const newEntries = state.log.slice(0, Math.max(0, state.log.length - logBefore));
  const SKIP = ['Arranca el bienio', 'Balance del bienio', 'Premios de la liga', 'Novedades del plantel', 'Bienvenido'];
  const headlines = newEntries
    .filter((e) => (e.kind === 'prensa' || e.kind === 'hito') && !SKIP.some((s) => e.headline.startsWith(s)))
    .map((e) => e.headline)
    .slice(0, 3);

  const gameOver = (state.phase as string) === 'despido' || (state.phase as string) === 'legado';
  const gameOverReason = (state.phase as string) === 'despido'
    ? (newEntries.find((e) => e.headline.includes('DESPEDIDO') || e.headline.includes('DESCENSO ADMINISTRATIVO'))?.body ?? 'La junta te soltó la mano.')
    : null;

  const objectiveMet = seasons.length > 0
    ? seasons.some((s) => (me.division > 1 ? false : s.division === 1 && s.position <= targetPos + 1)) || seasons.some((s) => s.titles.length > 0)
    : null;

  const warnings: string[] = [];
  if (me.finances.cash < 0) warnings.push(`Caja en ROJO (${me.finances.cash.toFixed(0)}M): otra temporada así y hay venta forzada; a −80M interviene la justicia y te vas.`);
  if (state.boardTrust < 25 && !gameOver) warnings.push(`La junta está al límite (${state.boardTrust}/100): si el próximo bienio no cumplís "${state.objectives.sportive.toLowerCase()}", te echan.`);
  if (me.finances.ffpSanction >= 2) warnings.push(`Sanción FFP nivel ${me.finances.ffpSanction} por pérdidas acumuladas (nivel 3 = prohibido fichar).`);
  if (me.fanbase.mood < 30) warnings.push('La hinchada está furiosa: cae la recaudación y el clima pesa en el vestuario.');

  return {
    seasons,
    moments: moments.slice(0, 3),
    headlines,
    cashDelta: r1(me.finances.cash - cashBefore),
    trustBefore,
    trustAfter: state.boardTrust,
    moodBefore,
    moodAfter: me.fanbase.mood,
    strengthBefore,
    strengthAfter: squadStrength(state),
    prestigeBefore,
    prestigeAfter: me.prestige,
    titlesWon: seasons.flatMap((s) => s.titles.map((t) => `${t} ${s.season}`)),
    objectiveMet,
    warnings,
    gameOver,
    gameOverReason,
  };
}
