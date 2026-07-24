import { Rng } from './rng';
import type { GameState, Moment, Player } from './types';
import { sortTable } from './season';

// Motor de "momentos": interrupciones con decisión durante la temporada simulada.

function star(state: GameState): Player {
  const me = state.clubs[state.clubId];
  return [...me.squad].sort((a, b) => b.value - a.value)[0];
}

function myPosition(state: GameState): { pos: number; n: number } {
  const me = state.clubs[state.clubId];
  const table = sortTable(state.seasonLive!.tables[me.leagueId] ?? []);
  const pos = table.findIndex((r) => r.clubId === me.id) + 1;
  return { pos: pos || 10, n: table.length || 20 };
}

type MomentBuilder = (state: GameState, rng: Rng) => Moment | null;

const BUILDERS: MomentBuilder[] = [
  // Oferta millonaria por tu figura
  (state, rng) => {
    const p = star(state);
    if (!p || p.overall < 74) return null;
    const amount = Number((p.value * (1.3 + rng.next('event') * 0.6)).toFixed(1));
    const isIdol = p.traits.includes('ídolo');
    return {
      id: 'oferta-figura',
      title: `Oferta de ${amount}M por ${p.name}`,
      body: `Un gigante europeo puso ${amount}M sobre la mesa por ${p.name}, tu mejor jugador${isIdol ? ' y el ídolo de la gente' : ''}. El agente presiona. La ventana cierra en 48 horas.`,
      options: [
        {
          label: 'Vender ya',
          detail: `+${amount}M de caja ahora. La hinchada ${isIdol ? 'te lo va a hacer pagar' : 'va a protestar'} y el plantel pierde nivel.`,
          effects: { cash: amount, sellPlayerId: p.id, sellPrice: amount, fanMood: isIdol ? -20 : -9, squadMorale: -8, boardTrust: 5 },
        },
        {
          label: 'Rechazar y blindar',
          detail: 'Cero plata, la hinchada lo celebra, el jugador renueva caro (−8M en salarios futuros).',
          effects: { cash: -8, fanMood: 8, squadMorale: 4, note: 'Blindaste a tu figura con una renovación cara.' },
        },
        {
          label: 'Pedir el doble',
          detail: '30% de que paguen el doble. Si se cae, el jugador queda resentido.',
          effects: { riskyChance: 0.3, cash: amount * 2, sellPlayerId: p.id, sellPrice: amount * 2, fanMood: -15, boardTrust: 10, failEffects: { squadMorale: -10, fanMood: -3, note: 'La venta se cayó y el jugador quedó con la cabeza afuera.' } },
        },
      ],
    };
  },
  // Crisis de vestuario
  (state, rng) => {
    const me = state.clubs[state.clubId];
    const conflictive = me.squad.find((p) => p.traits.includes('polémico') && p.morale < 60);
    const leader = me.squad.find((p) => p.traits.includes('líder'));
    if (!conflictive) return null;
    return {
      id: 'crisis-vestuario',
      title: `Pelea en el vestuario: ${conflictive.name} explotó`,
      body: `${conflictive.name} se cruzó a gritos con ${leader ? leader.name : 'el cuerpo técnico'} tras el último partido. La prensa ya tiene el audio.`,
      options: [
        { label: 'Castigarlo: afuera del equipo 3 fechas', detail: 'Autoridad ante el grupo (+moral plantel), el jugador se querrá ir.', effects: { squadMorale: 6, note: `${conflictive.name} apartado. Pidió ser transferido.` } },
        { label: 'Bancarlo en público', detail: 'El jugador te lo agradece; el resto murmura. La prensa te castiga.', effects: { squadMorale: -4, fanMood: -4, formBoost: 0.01 } },
        { label: 'Multa en silencio y a otra cosa', detail: 'Solución tibia: nadie contento, nadie furioso.', effects: { squadMorale: -1 } },
      ],
    };
  },
  // Joya de la cantera pide debutar
  (state, rng) => {
    const me = state.clubs[state.clubId];
    const gem = me.squad.find((p) => p.age <= 19 && p.potential >= 82 && p.seasonStats.apps < 3);
    if (!gem) return null;
    return {
      id: 'joya-cantera',
      title: `${gem.name} (${gem.age}) rompe todo en la reserva`,
      body: `Tu juvenil estrella lleva 14 goles en la reserva. Su agente insinúa que hay clubes mirando. El técnico duda de meterlo en un momento caliente del torneo.`,
      options: [
        { label: 'Titular ya', detail: 'Se acelera su desarrollo. Riesgo 25% de que el salto le quede grande este año (forma del equipo −).', effects: { riskyChance: 0.75, formBoost: 0.015, squadMorale: 3, fanMood: 6, note: `${gem.name} se adueñó del puesto.`, failEffects: { formBoost: -0.015, note: `${gem.name} sintió el peso de Primera: bajón de rendimiento.` } } },
        { label: 'Minutos de a poco', detail: 'Sin riesgo, desarrollo moderado, la hinchada quiere más.', effects: { fanMood: 2 } },
        { label: 'Que espere al año que viene', detail: 'Cero riesgo hoy. 20% de que pida irse (cláusula baja).', effects: { riskyChance: 0.8, failEffects: { note: `${gem.name} se hartó de esperar: su agente negocia con otros clubes.`, squadMorale: -2 } } },
      ],
    };
  },
  // Ultimátum de la junta
  (state) => {
    const { pos, n } = myPosition(state);
    if (state.boardTrust > 40 || pos < n * 0.6) return null;
    return {
      id: 'ultimatum',
      title: 'La junta pide explicaciones',
      body: `Reunión de urgencia: el equipo va ${pos}° y la confianza está en ${state.boardTrust}/100. Te piden un plan.`,
      options: [
        { label: 'Prometer resultados ya', detail: 'Si no levantás en lo inmediato, la caída será peor (apuesta de confianza).', effects: { riskyChance: 0.5, boardTrust: 12, formBoost: 0.012, failEffects: { boardTrust: -15, note: 'Prometiste y no cumpliste. La junta tomó nota.' } } },
        { label: 'Pedir paciencia con datos', detail: 'Moderado: +5 confianza, sin milagros.', effects: { boardTrust: 5 } },
        { label: 'Plantarte: "el proyecto es este"', detail: 'La hinchada valora la firmeza; la junta no tanto.', effects: { boardTrust: -6, fanMood: 6, squadMorale: 5 } },
      ],
    };
  },
  // Sponsor polémico golpea la puerta
  (state, rng) => {
    const me = state.clubs[state.clubId];
    if (me.sponsors.some((s) => s.toxic)) return null;
    const amount = Number((6 + me.prestige * 0.25 + rng.next('event') * 8).toFixed(1));
    return {
      id: 'sponsor-toxico',
      title: `BetMaxx ofrece ${amount}M por temporada`,
      body: `Una casa de apuestas quiere la manga de la camiseta: ${amount}M anuales por 3 años, muy por encima del mercado. Las agrupaciones de hinchas ya avisaron que no la quieren ver.`,
      options: [
        { label: 'Firmar', detail: `+${amount}M/año por 3 años. Humor de hinchada −8, y la prensa te lo recuerda cada derrota.`, effects: { addToxicSponsor: amount, fanMood: -8, note: 'Sponsor de apuestas firmado por 3 años.' } },
        { label: 'Rechazar', detail: 'Cero plata. La hinchada lo celebra como un triunfo.', effects: { fanMood: 6 } },
      ],
    };
  },
  // Lesión grave / crisis médica
  (state, rng) => {
    const me = state.clubs[state.clubId];
    const p = [...me.squad].filter((x) => !x.injury && x.overall >= 72).sort((a, b) => b.overall - a.overall)[rng.int('event', 0, 2)];
    if (!p) return null;
    return {
      id: 'lesion-grave',
      title: `${p.name} sale en camilla`,
      body: `Rotura de ligamentos. Entre 6 y 9 meses afuera. El mercado invernal está abierto y el médico sugiere no apurar la vuelta.`,
      options: [
        { label: 'Salir al mercado de urgencia', detail: 'Reemplazo caro (−12M) pero el equipo no se cae.', effects: { cash: -12, formBoost: 0.005, note: 'Refuerzo de urgencia fichado.' } },
        { label: 'Confiar en la cantera', detail: 'Gratis. 40% de que el pibe responda; si no, el equipo lo siente.', effects: { riskyChance: 0.4, formBoost: 0.008, fanMood: 5, note: 'El canterano respondió con creces.', failEffects: { formBoost: -0.012, note: 'El reemplazo juvenil quedó en evidencia.' } } },
        { label: 'Apurar la recuperación', detail: 'Vuelve antes, 50% de recaída con secuelas permanentes.', effects: { riskyChance: 0.5, formBoost: 0.004, failEffects: { note: 'Recaída: la lesión se agravó y perdió nivel para siempre.', formBoost: -0.008 } } },
      ],
    };
  },
  // Banderazo / presión de la hinchada
  (state) => {
    const me = state.clubs[state.clubId];
    if (me.fanbase.mood > 35) return null;
    return {
      id: 'protesta',
      title: 'Banderazo en la puerta del club',
      body: `Miles de hinchas protestan contra la dirigencia. El clima es hostil y los jugadores lo sienten.`,
      options: [
        { label: 'Dar la cara ante los hinchas', detail: '60% de calmarlos (+10 humor); si sale mal, escrache.', effects: { riskyChance: 0.6, fanMood: 10, failEffects: { fanMood: -6, squadMorale: -4, note: 'El escrache fue tapa de todos los diarios.' } } },
        { label: 'Bajar precios de entradas 15%', detail: 'Cuesta recaudación (−4M) pero descomprime.', effects: { cash: -4, fanMood: 9 } },
        { label: 'Silencio y a trabajar', detail: 'Gratis. El malestar sigue latente.', effects: { fanMood: -3 } },
      ],
    };
  },
];

export function maybeBuildMoment(state: GameState, rng: Rng): Moment | null {
  const sl = state.seasonLive!;
  const remainingRounds = sl.totalRounds - sl.round;
  const targetMoments = 5;
  const remainingMoments = targetMoments - sl.momentsFired;
  if (remainingMoments <= 0 || remainingRounds <= 0) return null;
  if (!rng.chance('event', remainingMoments / remainingRounds)) return null;

  const shuffled = rng.shuffle('event', [...BUILDERS]);
  for (const b of shuffled) {
    const m = b(state, rng);
    if (m) return m;
  }
  return null;
}

// ------------------------------ Prensa ------------------------------

export function seasonHeadline(state: GameState, position: number, division: number): string {
  const me = state.clubs[state.clubId];
  const league = state.leagues.find((l) => l.clubIds.includes(me.id));
  const n = league?.clubIds.length ?? 20;
  if (position === 1 && division === 1) return `"${me.name} CAMPEÓN: la era ${state.manager.name} toca el cielo"`;
  if (position === 1) return `"${me.name} arrasa en ${league?.name}: el ascenso es una fiesta"`;
  if (position <= 4 && division === 1) return `"${me.name} vuelve a Europa: noche de copas en ${me.stadium.name}"`;
  if (position >= n - 2 && division === 1) return `"Alarma roja en ${me.name}: el descenso respira en la nuca"`;
  if (position > n / 2) return `"Temporada gris de ${me.name}: la paciencia con ${state.manager.name} se agota"`;
  return `"${me.name} cumple sin brillar: mitad de tabla y muchas preguntas"`;
}
