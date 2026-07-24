import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame } from '../src/domain/engine';
import { drawCards, simulateBiennium } from '../src/domain/quick';
import { computeLegacy } from '../src/domain/legacy';
import { Rng } from '../src/domain/rng';
import type { EtlData } from '../src/domain/worldgen';

const dataDir = join(__dirname, '..', 'public', 'data');
const etl: EtlData = {
  clubs: JSON.parse(readFileSync(join(dataDir, 'clubs.json'), 'utf8')),
  leagues: JSON.parse(readFileSync(join(dataDir, 'leagues.json'), 'utf8')),
  history: JSON.parse(readFileSync(join(dataDir, 'history.json'), 'utf8')),
};

describe('Partida rápida: 15 decisiones de punta a punta', () => {
  test('una partida completa termina con veredicto y sin NaN', () => {
    const state = createGame(etl, {
      seed: 'quick-test-1',
      clubId: etl.clubs[8].id,
      manager: { name: 'Q', nationality: 'AR', background: 'datos', reputation: 40 },
      difficulty: 'Sandbox', // sin despidos para recorrer los 15 bienios
    });

    let decisions = 0;
    while (state.phase !== 'legado' && (state.phase as string) !== 'despido' && decisions < 20) {
      const cards = drawCards(state, new Rng(state.rng));
      expect(cards.length).toBeGreaterThanOrEqual(3);
      const note = cards[decisions % cards.length].apply(state, new Rng(state.rng));
      expect(note.length).toBeGreaterThan(0);
      const recap = simulateBiennium(state);
      expect(recap.seasons.length).toBeGreaterThan(0);
      decisions++;
    }

    expect(decisions).toBeLessThanOrEqual(15);
    expect(state.phase).toBe('legado');
    expect(state.annals.length).toBe(30);

    const legacy = computeLegacy(state);
    expect(legacy.score).toBeGreaterThanOrEqual(0);
    expect(legacy.score).toBeLessThanOrEqual(1000);
    expect(Number.isNaN(legacy.avgPosition)).toBe(false);
    expect(legacy.eraTitle.length).toBeGreaterThan(0);

    for (const c of Object.values(state.clubs)) {
      expect(Number.isNaN(c.finances.cash)).toBe(false);
      for (const p of c.squad) expect(Number.isNaN(p.overall)).toBe(false);
    }
  }, 60000);

  test('en Realista te pueden echar (el despido corta la partida)', () => {
    // no asertamos que SIEMPRE echen, solo que el flujo tolera ambos finales
    const state = createGame(etl, {
      seed: 'quick-test-2',
      clubId: etl.clubs[2].id,
      manager: { name: 'Q', nationality: 'AR', background: 'agente', reputation: 40 },
      difficulty: 'Leyenda',
    });
    let guard = 0;
    while (state.phase !== 'legado' && (state.phase as string) !== 'despido' && guard < 20) {
      const cards = drawCards(state, new Rng(state.rng));
      cards[0].apply(state, new Rng(state.rng));
      simulateBiennium(state);
      guard++;
    }
    expect(['legado', 'despido']).toContain(state.phase);
  }, 60000);
});
