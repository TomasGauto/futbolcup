import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCareer, chooseOption, computeCareerLegacy, continentalName } from '../src/domain/career';
import { getClubRivals } from '../src/domain/rivalries';
import type { EtlData } from '../src/domain/worldgen';

const dataDir = join(__dirname, '..', 'public', 'data');
const etl: EtlData = {
  clubs: JSON.parse(readFileSync(join(dataDir, 'clubs.json'), 'utf8')),
  leagues: JSON.parse(readFileSync(join(dataDir, 'leagues.json'), 'utf8')),
  history: JSON.parse(readFileSync(join(dataDir, 'history.json'), 'utf8')),
};

describe('Carrera de jugador: de la cantera al retiro', () => {
  test('los clásicos se resuelven por ciudad/liga y tienen 1–2 rivales', () => {
    const c = createCareer(etl, { name: 'Clásico', nationality: 'Argentina', position: 'Delantero', seed: 'rival-test' });
    const united = Object.values(c.clubs).find((club) => club.name === 'Manchester United');
    expect(united).toBeDefined();
    const rivals = getClubRivals(united!, c.clubs);
    expect(rivals.length).toBeGreaterThanOrEqual(1);
    expect(rivals.length).toBeLessThanOrEqual(2);
    expect(rivals[0].club.name).toBe('Manchester City');
    expect(rivals[0].cityBased).toBe(true);
  });

  test('cada confederación usa su copa continental correcta', () => {
    expect(continentalName({ confed: 'AFC' } as any)).toBe('AFC Champions League');
    expect(continentalName({ confed: 'CAF' } as any)).toBe('CAF Champions League');
  });

  test('una carrera completa termina en retiro con trayectoria coherente', () => {
    const c = createCareer(etl, { name: 'Test Uno', nationality: 'Argentina', position: 'Delantero', seed: 'carrera-test-1' });
    expect(c.pendingEvent.kind).toBe('academia');
    expect(c.pendingEvent.options.length).toBe(3);

    let guard = 0;
    while (!c.retired && guard++ < 90) {
      const opt = c.pendingEvent.options[guard % c.pendingEvent.options.length];
      expect(opt.chips.length).toBeGreaterThan(0); // toda opción declara sus efectos
      chooseOption(c, opt.id);
    }
    expect(c.retired).toBe(true);
    expect(c.age).toBeGreaterThanOrEqual(31);
    expect(c.stints.length).toBeGreaterThanOrEqual(1);
    expect(c.seasons.length).toBeGreaterThan(10);

    // trazabilidad: cada temporada pertenece a un club de la trayectoria
    for (const s of c.seasons) {
      expect(c.stints.some((st) => st.clubId === s.clubId)).toBe(true);
      expect(Number.isNaN(s.rating)).toBe(false);
      expect(s.apps).toBeGreaterThanOrEqual(0);
    }
    // los totales de los tramos cuadran con las temporadas
    const stintApps = c.stints.reduce((a, s) => a + s.apps, 0);
    const seasonApps = c.seasons.reduce((a, s) => a + s.apps, 0);
    expect(stintApps).toBe(seasonApps);

    const legacy = computeCareerLegacy(c);
    expect(legacy.score).toBeGreaterThanOrEqual(0);
    expect(legacy.score).toBeLessThanOrEqual(1000);
    expect(legacy.tier.length).toBeGreaterThan(0);

    // el progreso queda registrado como momentos: debut, cantera, fichajes…
    expect(c.moments.length).toBeGreaterThan(4);
    expect(c.moments.some((m) => m.text.includes('cantera'))).toBe(true);
    expect(c.moments.some((m) => m.text.includes('Debut profesional'))).toBe(true);
  }, 30000);

  test('al retirarte podés seguir como DT hasta el retiro definitivo', () => {
    const c = createCareer(etl, { name: 'Míster', nationality: 'Argentina', position: 'Defensa central', seed: 'dt-test-1' });
    let guard = 0;
    let sawDtDecision = false;
    let dtSeasons = 0;
    while (!c.retired && guard++ < 80) {
      const ev = c.pendingEvent;
      let optId = ev.options[0].id;
      if (ev.kind === 'dt-decision') {
        sawDtDecision = true;
        optId = 'dt:start'; // siempre elegimos el banco
      } else if (c.phase === 'dt') {
        // preferí seguir dirigiendo mientras haya banco
        const join = ev.options.find((o) => o.id.startsWith('dtjoin') || o.id === 'dtstay');
        optId = join ? join.id : ev.options[0].id;
      }
      const res = chooseOption(c, optId);
      if (res.cycle) dtSeasons += res.cycle.length; // ciclos de DT: hasta 3 temporadas por decisión
      else if (res.season?.role === 'Director técnico') dtSeasons++;
    }
    expect(sawDtDecision).toBe(true);
    expect(c.retired).toBe(true);
    expect(c.phase).toBe('dt');
    expect(dtSeasons).toBeGreaterThan(3);
    expect(c.stints.some((s) => s.as === 'dt')).toBe(true);
    expect(c.age).toBeLessThanOrEqual(66);

    const legacy = computeCareerLegacy(c);
    expect(legacy.dtSeasons).toBe(dtSeasons);
    expect(legacy.score).toBeLessThanOrEqual(1000);
  }, 30000);

  test('elegir no ser DT cierra la carrera normalmente', () => {
    const c = createCareer(etl, { name: 'Sillón', nationality: 'Italia', position: 'Arquero', seed: 'dt-test-2' });
    let guard = 0;
    while (!c.retired && guard++ < 60) {
      const ev = c.pendingEvent;
      const optId = ev.kind === 'dt-decision' ? 'dt:no' : ev.options[0].id;
      chooseOption(c, optId);
    }
    expect(c.retired).toBe(true);
    expect(c.phase).toBe('jugador');
    expect(c.stints.every((s) => s.as === 'jugador')).toBe(true);
  }, 30000);

  test('misma seed y mismas decisiones = misma carrera', () => {
    const run = () => {
      const c = createCareer(etl, { name: 'Repro', nationality: 'Brasil', position: 'Mediocampista', seed: 'repro-carrera' });
      let guard = 0;
      while (!c.retired && guard++ < 90) chooseOption(c, c.pendingEvent.options[0].id);
      return JSON.stringify({ seasons: c.seasons, titles: c.titles, ability: c.ability, dt: c.dtSkill });
    };
    expect(run()).toBe(run());
  }, 30000);

  test('las ofertas siempre son opciones comparables (club + rol + proyecto)', () => {
    const c = createCareer(etl, { name: 'Ofertas', nationality: 'Francia', position: 'Delantero', seed: 'ofertas-test' });
    chooseOption(c, c.pendingEvent.options[2].id); // cantera chica → debut asegurado
    let sawOffers = false;
    let guard = 0;
    while (!c.retired && guard++ < 90) {
      if (c.pendingEvent.kind === 'ofertas' && c.pendingEvent.options.length >= 2) {
        sawOffers = true;
        for (const o of c.pendingEvent.options) {
          expect(o.chips.length).toBeGreaterThanOrEqual(1);
        }
      }
      chooseOption(c, c.pendingEvent.options[0].id);
    }
    expect(sawOffers).toBe(true);
  }, 30000);
});
