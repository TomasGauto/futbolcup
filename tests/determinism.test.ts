import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, startSeason, stepRound, resolveMoment, endSeasonProcessing, closeBiennium } from '../src/domain/engine';
import { setDoctrine } from '../src/domain/decisions';
import type { EtlData } from '../src/domain/worldgen';
import type { GameState } from '../src/domain/types';

const dataDir = join(__dirname, '..', 'public', 'data');
const etl: EtlData = {
  clubs: JSON.parse(readFileSync(join(dataDir, 'clubs.json'), 'utf8')),
  leagues: JSON.parse(readFileSync(join(dataDir, 'leagues.json'), 'utf8')),
  history: JSON.parse(readFileSync(join(dataDir, 'history.json'), 'utf8')),
};

function runSeasons(seed: string, seasons: number): GameState {
  const state = createGame(etl, {
    seed,
    clubId: etl.clubs[3].id,
    manager: { name: 'Det', nationality: 'AR', background: 'datos', reputation: 50 },
    difficulty: 'Realista',
  });
  for (let s = 0; s < seasons; s++) {
    if ((state.phase as string) === 'despido') break;
    if (state.phase === 'planificacion') { setDoctrine(state, ['cantera', 'proyecto']); state.phase = 'mercadoA'; }
    startSeason(state);
    for (;;) {
      const out = stepRound(state);
      if (out.moment) resolveMoment(state, 1);
      if (out.seasonOver) break;
    }
    endSeasonProcessing(state);
    if (state.phase === 'cierre') closeBiennium(state);
    else if (state.phase === 'entretiempo') state.phase = 'mercadoA';
  }
  return state;
}

function fingerprint(s: GameState): string {
  const clubs = Object.values(s.clubs).map((c) => [c.id, Math.round(c.elo), c.finances.cash, c.squad.length, c.division]);
  return JSON.stringify({ clubs, trust: s.boardTrust, season: s.currentSeason, annals: s.annals, market: s.marketIndex });
}

describe('Determinismo de partida completa (§13)', () => {
  test('misma seed + mismas decisiones = estado idéntico tras 3 temporadas', () => {
    const a = runSeasons('repro-42', 3);
    const b = runSeasons('repro-42', 3);
    expect(fingerprint(a)).toBe(fingerprint(b));
  }, 30000);

  test('seed distinta produce otra historia', () => {
    const a = runSeasons('repro-42', 2);
    const b = runSeasons('otra-seed', 2);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  }, 30000);
});
