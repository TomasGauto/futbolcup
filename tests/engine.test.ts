import { describe, expect, test } from 'vitest';
import { Rng, initRngState, hashSeed } from '../src/domain/rng';
import { bergerFixtures } from '../src/domain/calendar';
import { sampleScore } from '../src/domain/match';
import { ageCurveBase } from '../src/domain/development';
import { ageMult, contractMult, playerValue } from '../src/domain/valuation';
import { emptyTable, applyResultToTable, sortTable } from '../src/domain/season';
import { PRICE_ELASTICITY, demand } from '../src/domain/economy';
import type { Club, Player } from '../src/domain/types';

describe('RNG determinista', () => {
  test('misma seed produce la misma secuencia', () => {
    const a = new Rng(initRngState('test-123'));
    const b = new Rng(initRngState('test-123'));
    for (let i = 0; i < 100; i++) expect(a.next('match')).toBe(b.next('match'));
  });

  test('sub-streams independientes: consumir uno no descoloca al otro', () => {
    const a = new Rng(initRngState('test-123'));
    const b = new Rng(initRngState('test-123'));
    for (let i = 0; i < 50; i++) a.next('injury'); // stream distinto
    expect(a.next('match')).toBe(b.next('match'));
  });

  test('seeds distintas divergen', () => {
    expect(hashSeed('uno')).not.toBe(hashSeed('dos'));
  });

  test('normal y poisson dentro de rangos razonables', () => {
    const r = new Rng(initRngState('stats'));
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += r.poisson('match', 1.4);
    const mean = sum / 2000;
    expect(mean).toBeGreaterThan(1.25);
    expect(mean).toBeLessThan(1.55);
  });
});

describe('Elo', () => {
  test('expectativa y actualización según §7.1', () => {
    const eloL = 1600; const eloV = 1500; const vl = 65;
    const e = 1 / (1 + Math.pow(10, (eloV - eloL - vl) / 400));
    expect(e).toBeGreaterThan(0.5); // local favorito
    const k = 20 * (1 + 0.5 * 2); // ganó por 2
    const nuevo = eloL + k * (1 - e);
    expect(nuevo).toBeGreaterThan(eloL);
    expect(nuevo - eloL).toBeLessThan(k);
  });
});

describe('Dixon-Coles', () => {
  test('promedio de goles coherente con lambdas', () => {
    const r = new Rng(initRngState('dc'));
    let goals = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const { hg, ag } = sampleScore(r, 1.45, 1.15);
      goals += hg + ag;
    }
    const avg = goals / N;
    expect(avg).toBeGreaterThan(2.35);
    expect(avg).toBeLessThan(2.85);
  });

  test('nunca produce marcadores imposibles', () => {
    const r = new Rng(initRngState('dc2'));
    for (let i = 0; i < 500; i++) {
      const { hg, ag } = sampleScore(r, 0.2, 4.4);
      expect(hg).toBeGreaterThanOrEqual(0);
      expect(ag).toBeGreaterThanOrEqual(0);
      expect(hg).toBeLessThanOrEqual(8);
      expect(ag).toBeLessThanOrEqual(8);
    }
  });
});

describe('Calendario Berger', () => {
  test('20 equipos: 38 rondas, cada equipo juega 38 partidos, 19 de local', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const fx = bergerFixtures(ids);
    expect(fx.length).toBe(38);
    const played = new Map<string, number>();
    const home = new Map<string, number>();
    for (const round of fx) {
      expect(round.matches.length).toBe(10);
      for (const m of round.matches) {
        played.set(m.homeId, (played.get(m.homeId) ?? 0) + 1);
        played.set(m.awayId, (played.get(m.awayId) ?? 0) + 1);
        home.set(m.homeId, (home.get(m.homeId) ?? 0) + 1);
      }
    }
    for (const id of ids) {
      expect(played.get(id)).toBe(38);
      expect(home.get(id)).toBe(19);
    }
  });

  test('sin partidos repetidos con la misma localía', () => {
    const ids = Array.from({ length: 18 }, (_, i) => `c${i}`);
    const fx = bergerFixtures(ids);
    const seen = new Set<string>();
    for (const round of fx) for (const m of round.matches) {
      const key = `${m.homeId}-${m.awayId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('Curva de edad y valuación', () => {
  test('curva de edad: crece de joven, cae de viejo', () => {
    expect(ageCurveBase(18)).toBeGreaterThan(0);
    expect(ageCurveBase(27)).toBeCloseTo(0.1, 5);
    expect(ageCurveBase(34)).toBeLessThan(0);
  });

  test('multiplicadores de edad y contrato según §7.4', () => {
    expect(ageMult(21)).toBeCloseTo(1.45);
    expect(ageMult(30)).toBeCloseTo(0.75);
    expect(ageMult(34)).toBeCloseTo(0.28);
    expect(contractMult(1)).toBeCloseTo(0.45);
    expect(contractMult(4)).toBeCloseTo(1.15);
  });

  test('el valor crece exponencialmente con el overall', () => {
    const mk = (overall: number): Player => ({
      id: 'x', name: 'X', nationality: 'X', age: 25, position: 'ST', overall, potential: overall,
      traits: [], form: 0, morale: 60, fitness: 100, contract: { yearsLeft: 3, wage: 1 },
      value: 0, wantsToLeave: false, homegrown: false, promisedRole: 'titular',
      seasonStats: { apps: 0, goals: 0, assists: 0, rating: 6.5 }, careerGoals: 0, careerApps: 0, yearsAtClub: 0,
    });
    const v70 = playerValue(mk(70), 1);
    const v80 = playerValue(mk(80), 1);
    const v90 = playerValue(mk(90), 1);
    expect(v80 / v70).toBeGreaterThan(2.5);
    expect(v90 / v80).toBeGreaterThan(2.5);
  });
});

describe('Tabla de posiciones', () => {
  test('puntos y desempate por diferencia de gol', () => {
    const table = emptyTable(['a', 'b', 'c']);
    applyResultToTable(table, { homeId: 'a', awayId: 'b', hg: 3, ag: 0, scorersHome: [], scorersAway: [] });
    applyResultToTable(table, { homeId: 'c', awayId: 'b', hg: 1, ag: 0, scorersHome: [], scorersAway: [] });
    const sorted = sortTable(table);
    expect(sorted[0].clubId).toBe('a'); // mismo 3 pts que c, mejor DG
    expect(sorted[1].clubId).toBe('c');
    expect(sorted[2].points).toBe(0);
  });
});

describe('Economía: asistencia y elasticidad', () => {
  const clubMock = (price: number): Club => ({
    id: 'x', name: 'X', shortName: 'X', country: 'España', leagueId: 'ESP1', division: 1,
    colors: { primary: '#fff', secondary: '#000' }, elo: 1600, attack: 0, defense: 0,
    style: { aggression: 50, dominance: 50, homeAdv: 0.5 }, prestige: 60,
    fanbase: { size: 100000, loyalty: 60, expectation: 60, mood: 50 },
    stadium: { name: 'X', capacity: 40000, quality: 70, ticketPrice: price, maintenanceDebt: 0 },
    facilities: { academy: 3, medical: 3, training: 3, scouting: 3, dataDept: 3, womensTeam: true },
    finances: { cash: 10, wageBudget: 50, ffpWindow: [], creditRating: 'A', lastPnL: null, ffpSanction: 0 },
    squad: [], sponsors: [], debt: [], aiProfile: 'conservador', philosophy: 'posesión',
    coachQuality: 70, identity: 60, history: [], amortPool: [], continentalCoeff: 10,
  });

  test('subir precios baja la demanda (elasticidad 0.45)', () => {
    const ref = 25 + 60 * 0.35;
    const base = demand(clubMock(ref), 0.5);
    const caro = demand(clubMock(ref * 1.2), 0.5);
    expect(base - caro).toBeCloseTo(PRICE_ELASTICITY * 0.2, 2);
  });
});
