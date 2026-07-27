import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { EtlData } from '../domain/worldgen';
import {
  createCareer, chooseOption, computeCareerLegacy, clubLevel, flagEmoji,
  NATIONALITIES, POSITION_LIST,
  type CareerState, type CareerOption, type SeasonRow, type PlayerPosition, type Chip, type TurnResult,
} from '../domain/career';
import { loadAssetManifest, applyClubTheme } from './assets';
import { Crest, Trophy, AwardMark } from './Crest';
import { buildShareCard } from './sharecard';
import { getClubRivals } from '../domain/rivalries';

/** Número que "cuenta" hasta su valor (respeta prefers-reduced-motion). */
function useCountUp(target: number, ms = 650): number {
  const [shown, setShown] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function CountNum({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}

// Simulador de carrera: un evento por temporada, opciones comparables, trayectoria trazable.

// ------------------------------ Progreso persistente (como Copero) ------------------------------
// 1) La carrera EN CURSO se autoguarda: cerrás la pestaña y seguís donde estabas.
// 2) Cada carrera terminada entra al MUSEO con su ficha completa.
// 3) Récords globales acumulados entre todas tus carreras.

const SAVE_KEY = 'dinastia-career-save-v2';
const MUSEUM_KEY = 'dinastia-career-museum-v1';

// detecta títulos continentales (de club o de selección) por su nombre oficial
const CONTINENTAL_RE = /Champions League|Europa League|Conference League|Copa Libertadores|Copa Sudamericana|Concacaf Champions|Copa América|Eurocopa|Copa Oro|Copa Africana|Copa Asiática/;

type MuseumEntry = {
  name: string; position: string; nationality: string;
  tier: string; score: number;
  seasons: number; apps: number; goals: number; titles: number; dtSeasons: number; dtTitles: number;
  path: string; // "2026-2031 River · 2031-2040 Real Madrid 🏆🏆 · [DT] 2041-..."
  date: string;
};

function saveCurrent(career: CareerState | null): void {
  try {
    if (!career) localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify(career));
  } catch { /* sin storage: seguimos en memoria */ }
}
function loadCurrent(): CareerState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CareerState;
    return c?.seed && c.pendingEvent ? c : null;
  } catch { return null; }
}
function loadMuseum(): MuseumEntry[] {
  try { return JSON.parse(localStorage.getItem(MUSEUM_KEY) ?? '[]'); } catch { return []; }
}
function addToMuseum(entry: MuseumEntry): void {
  try {
    const all = [entry, ...loadMuseum()].slice(0, 30);
    localStorage.setItem(MUSEUM_KEY, JSON.stringify(all));
  } catch { /* memoria */ }
}

export default function CareerApp() {
  const [etl, setEtl] = useState<EtlData | null>(null);
  const [err, setErr] = useState('');
  const careerRef = useRef<CareerState | null>(null);
  const [, setTick] = useState(0);
  const activeClubId = (career: CareerState | null): string | null => {
    if (!career) return null;
    return career.clubId ?? career.stints[career.stints.length - 1]?.clubId ?? null;
  };
  const bump = () => {
    applyClubTheme(activeClubId(careerRef.current));
    setTick((t) => t + 1);
  };
  const [lastSeason, setLastSeason] = useState<SeasonRow | null>(null);
  const [lastCycle, setLastCycle] = useState<SeasonRow[] | null>(null);
  const [penaltyResult, setPenaltyResult] = useState<TurnResult['penalty'] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // interstitial de "sorteo": guardamos el resultado y lo revelamos tras la animación.
  // fases: 'sim' (se juega la temporada) → 'copa' (festejo, solo si ganaste algo) → revelar
  type SimInfo = {
    clubId: string; clubName: string; year: number; isDt: boolean; nationality: string;
    phase: 'riesgo' | 'sim' | 'copa'; titles: string[]; pos: number;
    keyMoment?: 'debut' | 'mundial';
    risk?: { ok: boolean; text: string };
  };
  const [simulating, setSimulating] = useState<SimInfo | null>(null);
  const simInfoRef = useRef<SimInfo | null>(null);
  const pendingRef = useRef<TurnResult | null>(null);
  const simTimerRef = useRef<number | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [sting, setSting] = useState(false);
  const [phaseTransition, setPhaseTransition] = useState<{ name: string; fame: number; skill: number; year: number } | null>(null);
  const transitionTimerRef = useRef<number | null>(null);

  useEffect(() => { applyClubTheme(null); }, []);

  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? '/';
    Promise.all([
      fetch(`${base}data/clubs.json`).then((r) => r.json()),
      fetch(`${base}data/leagues.json`).then((r) => r.json()),
      fetch(`${base}data/history.json`).then((r) => r.json()),
      loadAssetManifest(base),
    ]).then(([clubs, leagues, history]) => setEtl({ clubs, leagues, history }))
      .catch(() => setErr('No se pudieron cargar los datos. Corré `npm run etl` y recargá.'));
  }, []);

  // reanudar carrera en curso al volver
  useEffect(() => {
    if (!etl || careerRef.current) return;
    const resumed = loadCurrent();
    if (resumed && !resumed.retired) {
      careerRef.current = resumed;
      bump();
    }
  }, [etl]);

  const start = (name: string, nationality: string, position: PlayerPosition) => {
    if (!etl) return;
    const seed = `carrera-${Date.now() % 1e9}-${Math.floor(Math.random() * 1e6)}`;
    careerRef.current = createCareer(etl, { name, nationality, position, seed });
    setLastSeason(null);
    setFlash(null);
    setSaved(false);
    saveCurrent(careerRef.current);
    bump();
  };

  const setSim = (info: SimInfo | null) => {
    simInfoRef.current = info;
    setSimulating(info);
  };

  const reveal = (res: TurnResult) => {
    setLastSeason(res.season);
    setLastCycle(res.cycle && res.cycle.length > 1 ? res.cycle : null);
    setFlash(res.flash);
    setSim(null);
    setChosenId(null);
    // sting rojo cuando pasa algo feo: despido, doping, agravar la lesión
    const bad = (res.season?.note ?? '') + (res.flash ?? '');
    if (/echó|DOPING|agravó|Suspendido/i.test(bad)) {
      setSting(true);
      window.setTimeout(() => setSting(false), 1200);
    }
    bump();
  };

  const celebrationTier = (titles: string[]): 'liga' | 'continental' | 'mundial' => {
    if (titles.some((t) => t.startsWith('Copa del Mundo'))) return 'mundial';
    if (titles.some((t) => CONTINENTAL_RE.test(t))) return 'continental';
    return 'liga';
  };

  const finishSim = () => {
    if (simTimerRef.current) { window.clearTimeout(simTimerRef.current); simTimerRef.current = null; }
    const res = pendingRef.current;
    const info = simInfoRef.current;
    if (!res) return;
    // apuesta sorteada → sigue la temporada
    if (info?.phase === 'riesgo') {
      setSim({ ...info, phase: 'sim' });
      simTimerRef.current = window.setTimeout(finishSim, 1500);
      return;
    }
    // ¿ganaste algo? antes de revelar, festejo escalado según la magnitud del título
    // (en ciclos de DT se festejan juntos los títulos de las 3 temporadas)
    const wonTitles = (res.cycle ?? (res.season ? [res.season] : [])).flatMap((r) => r.titles);
    if (info?.phase === 'sim' && wonTitles.length > 0) {
      const tier = celebrationTier(wonTitles);
      setSim({ ...info, phase: 'copa', titles: wonTitles });
      simTimerRef.current = window.setTimeout(finishSim, tier === 'mundial' ? 2200 : tier === 'continental' ? 1800 : 1400);
      return;
    }
    pendingRef.current = null;
    reveal(res);
  };

  const runTurn = (opt: CareerOption) => {
    const c = careerRef.current;
    if (!c) return;
    const phaseBefore = c.phase;
    const res = chooseOption(c, opt.id);
    saveCurrent(c.retired ? null : c); // la partida viva se guarda sola

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (phaseBefore === 'jugador' && c.phase === 'dt') {
      reveal(res);
      if (!reduced) {
        if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
        setPhaseTransition({ name: c.name, fame: Math.round(c.fame), skill: c.dtSkill, year: c.year });
        transitionTimerRef.current = window.setTimeout(() => setPhaseTransition(null), 4300);
      }
      return;
    }
    if (!res.season || reduced) {
      reveal(res);
      return;
    }
    // suspenso: la temporada ya está jugada, pero se "sortea" ante tus ojos.
    // si la opción era una apuesta, primero se sortea la apuesta (SALE BIEN / SALE MAL).
    pendingRef.current = res;
    const turnTitles = (res.cycle ?? [res.season]).flatMap((row) => row?.titles ?? []);
    const keyMoment: SimInfo['keyMoment'] = turnTitles.some((t) => t.startsWith('Copa del Mundo'))
      ? 'mundial'
      : res.season.role !== 'Director técnico' && c.seasons.filter((s) => s.role !== 'Director técnico').length === 1
        ? 'debut'
        : undefined;
    const base: Omit<SimInfo, 'phase' | 'risk'> = {
      clubId: res.season.clubId,
      clubName: res.season.clubName,
      year: res.season.year,
      isDt: res.season.role === 'Director técnico',
      nationality: c.nationality,
      titles: [] as string[],
      pos: res.season.leaguePos,
      keyMoment,
    };
    if (res.risk) {
      setSim({ ...base, phase: 'riesgo', risk: res.risk });
      simTimerRef.current = window.setTimeout(finishSim, 1900);
    } else {
      setSim({ ...base, phase: 'sim' });
      simTimerRef.current = window.setTimeout(finishSim, 1500);
    }
  };

  const pick = (opt: CareerOption) => {
    const c = careerRef.current;
    if (!c || c.retired || simulating || chosenId) return;
    // la carta elegida se destaca y las otras se apagan antes del sorteo
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      runTurn(opt);
      return;
    }
    setChosenId(opt.id);
    window.setTimeout(() => runTurn(opt), 200);
  };

  const shootPenalty = (zone: number) => {
    const c = careerRef.current;
    if (!c || penaltyResult) return;
    const res = chooseOption(c, `pen:${zone}`);
    saveCurrent(c.retired ? null : c);
    pendingRef.current = res;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { reveal(res); return; }
    setPenaltyResult(res.penalty ?? null);
  };
  const finishPenalty = () => {
    const res = pendingRef.current;
    pendingRef.current = null;
    setPenaltyResult(null);
    if (res) reveal(res);
  };

  const reset = () => {
    careerRef.current = null;
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = null;
    setPhaseTransition(null);
    setLastSeason(null);
    setSaved(false);
    saveCurrent(null);
    bump();
  };

  if (err) return <Center><p style={{ color: 'var(--bad)' }}>{err}</p></Center>;
  if (!etl) return <Center><p className="font-display" style={{ color: 'var(--muted)' }}>Cargando el mundo del fútbol…</p></Center>;

  const career = careerRef.current;
  if (!career) return <StartScreen onStart={start} />;
  if (career.retired && !simulating) return <RetirementScreen career={career} onReset={reset} saved={saved} onSaved={() => setSaved(true)} />;
  if (career.pendingEvent.kind === 'penal') {
    return <PenaltyScene body={career.pendingEvent.body} competition={career.pendingEvent.title} nationality={career.nationality}
      result={penaltyResult} onShoot={shootPenalty} onDone={finishPenalty} />;
  }

  return (
    <div className="max-w-screen-xl mx-auto p-2 sm:p-4 flex flex-col gap-2 sm:gap-3 min-h-dvh">
      <PlayerCard career={career} />

      {flash && (
        <div className="panel p-2 sm:p-3 text-xs sm:text-sm slide-in" style={{ borderColor: 'var(--warn)' }}>⚡ {flash}</div>
      )}
      {lastCycle
        ? <CycleResult rows={lastCycle} />
        : lastSeason && <SeasonResult career={career} row={lastSeason} />}

      {/* El evento del año: opciones comparables */}
      <div className="decision-trajectory-layout">
        <section className="panel p-2 sm:p-4 slide-in decision-panel">
          <h2 className="font-display text-sm sm:text-base" style={{ color: 'var(--club-primary)' }}>{career.pendingEvent.title}</h2>
          <p className="text-xs sm:text-sm mt-0.5 sm:mt-1 mb-2 sm:mb-3" style={{ color: 'var(--muted)' }}>{career.pendingEvent.body}</p>
          <div className="decision-grid" style={decisionGridVars(career.pendingEvent.options.length)}>
            {career.pendingEvent.options.map((opt) => (
              <OptionCard key={opt.id} opt={opt} onPick={() => pick(opt)}
                chosen={chosenId === opt.id} faded={chosenId !== null && chosenId !== opt.id} />
            ))}
          </div>
        </section>

        <div className="trajectory-side">
          <Trajectory career={career} />
        </div>
      </div>

      <MomentsPanel career={career} />

      <button className="btn self-center !text-[10px] opacity-60" onClick={() => {
        if (window.confirm('¿Abandonar esta carrera? Se pierde el progreso actual (el museo no se toca).')) reset();
      }}>Abandonar carrera</button>

      {simulating && <SortingOverlay info={simulating} onSkip={finishSim} />}
      {phaseTransition && <SecondLifeOverlay info={phaseTransition} onDone={() => setPhaseTransition(null)} />}
      {sting && <div className="sting-red" aria-hidden />}
    </div>
  );
}

// ------------------------------ Penal decisivo: el arco y las 6 zonas ------------------------------

const PK_COL = (z: number) => (z === 1 || z === 2 ? 0 : z === 3 || z === 4 ? 1 : 2);
const PK_ROW = (z: number) => (z === 1 || z === 3 || z === 5 ? 0 : 1);
const PK_LABEL: Record<number, string> = {
  1: 'Ángulo sup. izq.', 3: 'Al medio, alto', 5: 'Ángulo sup. der.',
  2: 'Abajo, izq.', 4: 'Raso, al medio', 6: 'Abajo, der.',
};

type PenaltyResult = NonNullable<TurnResult['penalty']>;

function PenaltyScene({ body, competition, nationality, result, onShoot, onDone }: {
  body: string; competition: string; nationality: string;
  result: PenaltyResult | null | undefined;
  onShoot: (zone: number) => void; onDone: () => void;
}) {
  const shot = result != null;
  const isMundial = competition.startsWith('Copa del Mundo') || result?.titleName.startsWith('Copa del Mundo');
  useEffect(() => {
    if (!shot) return;
    const t = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(t);
  }, [shot]);

  // posición destino de la pelota y del arquero (en % dentro del arco)
  const colX = [16, 50, 84];
  const zoneStyle = (z: number) => ({ left: `${colX[PK_COL(z)]}%`, top: `${PK_ROW(z) === 0 ? 26 : 66}%` });
  const keeperStyle = result
    ? { left: `${[14, 44, 74][PK_COL(result.keeperZone)]}%`, top: `${PK_ROW(result.keeperZone) === 0 ? 8 : 46}%` }
    : {};
  const saved = result != null && !result.scored && !result.offTarget;
  const keeperCls = result
    ? `${PK_COL(result.keeperZone) === 0 ? 'dive-left' : PK_COL(result.keeperZone) === 2 ? 'dive-right' : ''} ${saved ? 'saved' : ''}`
    : 'idle';
  const ballStyle: React.CSSProperties = result
    ? (result.offTarget
      ? { left: `${colX[PK_COL(result.zone)]}%`, top: '-14%', opacity: 0 } // se va arriba
      : { ...zoneStyle(result.zone), opacity: 1 })
    : {};

  const verdict = !result ? null
    : result.scored ? { t: '¡GOOOL!', c: 'var(--good)' }
      : result.offTarget ? { t: 'AFUERA', c: 'var(--bad)' }
        : { t: 'LA ATAJÓ', c: 'var(--bad)' };

  return (
    <div className={`pitch-bg fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-4 overflow-hidden select-none ${result?.titleName.startsWith('Copa del Mundo') ? 'key-moment moment-mundial' : ''}`}>
      {isMundial && <span className="flag-wave text-5xl" aria-hidden>{flagEmoji(nationality)}</span>}
      <div className="font-display text-sm text-center" style={{ color: 'var(--club-primary)' }}>{competition}</div>
      {!shot && <p className="text-xs text-center max-w-sm" style={{ color: 'var(--muted)' }}>{body}</p>}

      <div className={`pk-goal ${result?.scored ? 'scored' : ''}`}>
        <div className={`pk-grid ${shot ? 'aim-done' : ''}`}>
          {[1, 3, 5, 2, 4, 6].map((z) => (
            <button key={z} className={`pk-zone ${shot ? 'aim-off' : ''} ${result?.zone === z ? 'picked' : ''}`}
              title={PK_LABEL[z]} aria-label={PK_LABEL[z]} onClick={() => !shot && onShoot(z)} />
          ))}
        </div>
        <div className={`pk-keeper ${keeperCls}`} style={keeperStyle} />
        <div className={`pk-ball ${shot ? 'spinning' : 'idle'}`} style={ballStyle} />
        <div className="pk-spot" />
      </div>

      {!shot
        ? <div className="font-display text-base text-center pulse-cta px-4 py-1 rounded" style={{ color: 'var(--club-primary)' }}>¿A DÓNDE LA MANDÁS?</div>
        : verdict && (
          <div className="flex flex-col items-center gap-1">
            <div className="font-display text-4xl sm:text-5xl gold-glow trophy-pop" style={{ color: verdict.c }}>{verdict.t}</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>tocá para seguir</div>
          </div>
        )}
      {shot && <div className="fixed inset-0" onClick={onDone} />}
    </div>
  );
}

// ------------------------------ Interstitial: "sorteando" la temporada ------------------------------

const SIM_LINES_PLAYER = [
  'Pretemporada: doble turno y amistosos…',
  'Arranca el torneo ⚽',
  'Fecha 6: el equipo se va acomodando…',
  'Fecha 12: golazo tuyo en el clásico…',
  'Mercado de invierno: rumores en la radio…',
  'Fecha 23: se aprieta la tabla…',
  'Fechas finales: se define TODO…',
];
const SIM_LINES_DT = [
  'Pretemporada: armás el plantel…',
  'Arranca el torneo desde el banco 📋',
  'Fecha 6: la prensa opina de tu esquema…',
  'Fecha 12: cambios que ganan partidos…',
  'Mercado de invierno: pedís refuerzos…',
  'Fecha 23: el vestuario te respalda…',
  'Fechas finales: la dirigencia mira de cerca…',
];

const CONFETTI_COLORS = ['#d4b062', '#4ade80', '#60a5fa', '#f87171', '#e879f9', '#fbbf24'];
const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  left: `${4 + ((i * 37) % 92)}%`,
  delay: `${(i % 7) * 0.12}s`,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
}));

// secuencia visual del "tambor" de la ruleta (solo display; el resultado ya está decidido)
const SLOT_CYCLE = [17, 4, 12, 1, 9, 20, 6, 15, 2, 11, 8, 18, 5, 14, 3, 19];

function SortingOverlay({ info, onSkip }: {
  info: {
    clubId: string; clubName: string; year: number; isDt: boolean; nationality: string;
    phase: 'riesgo' | 'sim' | 'copa'; titles: string[]; pos: number;
    keyMoment?: 'debut' | 'mundial';
    risk?: { ok: boolean; text: string };
  };
  onSkip: () => void;
}) {
  const [lineIdx, setLineIdx] = useState(0);
  const [slot, setSlot] = useState<{ v: number; settled: boolean }>({ v: SLOT_CYCLE[0], settled: false });
  const [bet, setBet] = useState<{ good: boolean; settled: boolean }>({ good: true, settled: false });
  const lines = info.isDt ? SIM_LINES_DT : SIM_LINES_PLAYER;

  // sorteo de la apuesta: SALE BIEN / SALE MAL alternando hasta clavarse en el resultado real
  useEffect(() => {
    if (info.phase !== 'riesgo' || !info.risk) return;
    let cancelled = false;
    const timers: number[] = [];
    let good = true;
    const flip = (t: number) => {
      if (cancelled) return;
      const delay = t < 500 ? 90 : t < 850 ? 150 : 230;
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        if (t >= 1050) { setBet({ good: info.risk!.ok, settled: true }); return; }
        good = !good;
        setBet({ good, settled: false });
        flip(t + delay);
      }, delay));
    };
    flip(0);
    return () => { cancelled = true; timers.forEach((t) => window.clearTimeout(t)); };
  }, [info.phase]);

  useEffect(() => {
    if (info.phase !== 'sim') return;
    const iv = window.setInterval(() => setLineIdx((i) => Math.min(i + 1, lines.length - 1)), 200);

    // ruleta de posición: gira rápido, frena, y se clava en la posición REAL
    let idx = 0;
    let cancelled = false;
    const timers: number[] = [];
    const spin = (t: number) => {
      if (cancelled) return;
      const delay = t < 650 ? 55 : t < 1000 ? 110 : 180; // desacelera
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        if (t >= 1200) { setSlot({ v: info.pos, settled: true }); return; }
        idx = (idx + 1) % SLOT_CYCLE.length;
        setSlot({ v: SLOT_CYCLE[idx], settled: false });
        spin(t + delay);
      }, delay));
    };
    spin(0);
    return () => { cancelled = true; window.clearInterval(iv); timers.forEach((t) => window.clearTimeout(t)); };
  }, [info.phase]);

  const tier = info.titles.some((t) => t.startsWith('Copa del Mundo')) ? 'mundial'
    : info.titles.some((t) => CONTINENTAL_RE.test(t)) ? 'continental' : 'liga';
  const confetti = tier === 'liga' ? CONFETTI : [...CONFETTI, ...CONFETTI.map((c, i) => ({ ...c, left: `${(8 + i * 29) % 95}%`, delay: `${0.5 + (i % 5) * 0.14}s` }))];

  return (
    <div
      className={`pitch-bg fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 cursor-pointer select-none overflow-hidden ${info.phase === 'copa' && tier === 'mundial' ? 'big-shake' : ''} ${info.keyMoment ? `key-moment moment-${info.keyMoment}` : ''}`}
      onClick={onSkip}
      role="status"
      aria-label={info.phase === 'copa' ? 'Festejo de campeonato' : 'Simulando la temporada'}
    >
      {info.phase === 'riesgo' && info.risk ? (
        <>
          <div className="font-display text-xs" style={{ color: 'var(--muted)' }}>
            TU APUESTA SE DEFINE…
          </div>
          <div className="text-6xl">🎲</div>
          <div
            key={bet.settled ? 'settled' : `flip-${bet.good}`}
            className={`font-display text-4xl text-center px-4 ${bet.settled ? 'slot-settle' : 'slot-spin'}`}
            style={{ color: bet.good ? 'var(--good)' : 'var(--bad)', minHeight: 48 }}
          >
            {bet.good ? '✔ SALE BIEN' : '✘ SALE MAL'}
          </div>
          <div className="text-sm text-center px-8" style={{ color: 'var(--muted)', minHeight: 40, opacity: bet.settled ? 1 : 0, transition: 'opacity 300ms' }}>
            {info.risk.text}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--muted)' }}>tocá para seguir</div>
        </>
      ) : info.phase === 'sim' ? (
        <>
          <div className="font-display text-xs" style={{ color: 'var(--muted)' }}>
            TEMPORADA {info.year}/{String((info.year + 1) % 100).padStart(2, '0')} · {info.clubName}
          </div>

          <div className="relative ball-bounce" style={{ width: 64, height: 64 }}>
            <div className="spin-ring" />
            <div className="w-full h-full flex items-center justify-center">
              <Crest clubId={info.clubId} name={info.clubName} size={64} />
            </div>
          </div>

          <div key={lineIdx} className="line-flip font-display text-base text-center px-6" style={{ color: 'var(--club-primary)', minHeight: 28 }}>
            {lines[lineIdx]}
          </div>

          {/* la ruleta: posición final girando hasta clavarse */}
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[10px]" style={{ color: 'var(--muted)' }}>POSICIÓN FINAL</span>
            <span
              key={slot.settled ? 'settled' : `spin-${slot.v}`}
              className={`font-num text-5xl font-bold ${slot.settled ? 'slot-settle' : 'slot-spin'}`}
              style={{ color: slot.settled ? (info.pos === 1 ? 'var(--club-primary)' : info.pos <= 4 ? 'var(--good)' : info.pos >= 17 ? 'var(--bad)' : 'var(--text)') : 'var(--muted)', minWidth: 76, textAlign: 'center', display: 'inline-block' }}>
              {slot.v}°
            </span>
          </div>

          <div className="meter w-56">
            <div style={{ background: 'var(--club-primary)', animation: 'fillBar 1.5s linear forwards' }} />
          </div>

          <div className="text-[10px]" style={{ color: 'var(--muted)' }}>tocá para saltar</div>
        </>
      ) : (
        <>
          {(tier === 'continental' || tier === 'mundial') && <div className="gold-flash" />}
          {confetti.map((c, i) => (
            <span key={i} className="confetti" style={{ left: c.left, animationDelay: c.delay, background: c.color }} />
          ))}
          {tier === 'mundial' ? (
            <>
              <div className="trophy-pop flex items-center justify-center gap-4">
                <span className="flag-wave text-7xl" aria-hidden>{flagEmoji(info.nationality)}</span>
                <Trophy title="Copa del Mundo" size={110} />
              </div>
              <div className="font-display text-3xl sm:text-4xl gold-glow text-center px-4" style={{ color: 'var(--club-primary)' }}>
                ¡¡CAMPEÓN DEL MUNDO!!
              </div>
              <div className="font-display text-lg text-center" style={{ color: 'var(--muted)' }}>{info.nationality}</div>
            </>
          ) : (
            <>
              <div className="trophy-pop flex gap-2 items-end justify-center flex-wrap">
                {(info.titles.length ? info.titles : ['']).slice(0, 3).map((t, i) => (
                  <Trophy key={i} title={t} size={tier === 'continental' ? 96 : 84} />
                ))}
              </div>
              <div className="font-display text-2xl sm:text-3xl gold-glow text-center px-4" style={{ color: 'var(--club-primary)' }}>
                {tier === 'continental' ? '¡GLORIA CONTINENTAL!' : '¡CAMPEÓN!'}
              </div>
            </>
          )}
          <div className="font-display text-base text-center px-6">
            {info.titles.join(' + ')}
          </div>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
            <Crest clubId={info.clubId} name={info.clubName} size={24} />
            {info.clubName} · {info.year}/{String((info.year + 1) % 100).padStart(2, '0')}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--muted)' }}>tocá para seguir</div>
        </>
      )}
    </div>
  );
}

/** Interstitial propio del salto de jugador a DT: la segunda vida tiene identidad visual propia. */
function SecondLifeOverlay({ info, onDone }: {
  info: { name: string; fame: number; skill: number; year: number };
  onDone: () => void;
}) {
  return (
    <div className="second-life-overlay fixed inset-0 z-[70] flex flex-col items-center justify-center px-5 text-center select-none"
      onClick={onDone} role="dialog" aria-label="Segunda vida como director técnico">
      <div className="second-life-grid" aria-hidden />
      <div className="second-life-kicker font-display">TRANSICIÓN DE CARRERA · {info.year}</div>
      <div className="second-life-rule" aria-hidden />
      <div className="second-life-title font-display">SEGUNDA VIDA</div>
      <div className="second-life-subtitle font-display">DEL VESTUARIO A LA PIZARRA</div>
      <div className="second-life-stats flex items-center gap-3 mt-8">
        <div className="second-life-stat">
          <span className="second-life-stat-label font-display">FAMA</span>
          <b className="font-num">{info.fame}</b>
        </div>
        <div className="second-life-arrow" aria-hidden>→</div>
        <div className="second-life-stat second-life-stat-dt">
          <span className="second-life-stat-label font-display">NIVEL DT</span>
          <b className="font-num">{info.skill}</b>
        </div>
      </div>
      <div className="second-life-name font-display mt-7">{info.name}</div>
      <div className="second-life-continue text-[10px] mt-8">TOCÁ PARA ENTRAR AL BANCO</div>
    </div>
  );
}

/** Los momentos que hacen a la historia: se acumulan solos, como en Copero. */
function MomentsPanel({ career, full }: { career: CareerState; full?: boolean }) {
  if (career.moments.length === 0) return null;
  const items = [...career.moments].reverse();
  const shown = full ? items : items.slice(0, 6);
  const body = (
    <div className="flex flex-col gap-1.5 mt-2">
      {shown.map((m, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span>{m.icon}</span>
          <span className="font-num" style={{ color: 'var(--muted)' }}>{m.year}</span>
          <span className="flex-1">{m.text}</span>
        </div>
      ))}
    </div>
  );
  return (
    <details className="panel p-3">
      <summary className="font-display text-[10px] cursor-pointer" style={{ color: 'var(--muted)' }}>
        {full ? 'LOS MOMENTOS DE TU CARRERA' : 'MOMENTOS DE TU CARRERA'} ({career.moments.length})
      </summary>
      {body}
      {!full && items.length > 6 && <div className="text-[10px] mt-1.5" style={{ color: 'var(--muted)' }}>…y {items.length - 6} más (los ves todos al final)</div>}
    </details>
  );
}

// ------------------------------ Piezas ------------------------------

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh flex items-center justify-center p-4">{children}</div>;
}

function ChipView({ chip }: { chip: Chip }) {
  const color = chip.tone === 'good' ? 'var(--good)' : chip.tone === 'bad' ? 'var(--bad)' : chip.tone === 'warn' ? 'var(--warn)' : 'var(--muted)';
  return (
    <span className="font-num text-[11px] px-1.5 py-0.5 rounded-sm border" style={{ color, borderColor: color }}>
      {chip.t}
    </span>
  );
}

/**
 * Columnas del grid de decisiones: en mobile van todas lado a lado salvo que sean
 * 4+ (ahí se ven aplastadas), en cuyo caso se arma una grilla de 2×2. En pantallas
 * más anchas siempre entran todas en una sola fila.
 */
function decisionGridVars(count: number): React.CSSProperties {
  // En mobile: si hay 3+ opciones, apilamos en 1 columna para que no se aplaste el texto.
  const colsMobile = count > 2 ? 1 : count;
  const colsWide = count >= 4 ? 2 : count;
  return { '--cols-mobile': String(colsMobile), '--cols-wide': String(colsWide) } as React.CSSProperties;
}

function OptionCard({ opt, onPick, chosen, faded }: { opt: CareerOption; onPick: () => void; chosen?: boolean; faded?: boolean }) {
  return (
    <button className={`panel opt-card p-1.5 sm:p-3 text-left cursor-pointer w-full ${chosen ? 'chosen' : ''} ${faded ? 'faded' : ''}`} onClick={onPick}>
      <div className="flex items-center gap-1.5 sm:gap-3">
        {opt.clubId && <Crest clubId={opt.clubId} name={opt.label} size={22} />}
        <div className="flex-1 min-w-0">
          <div className="font-display text-[11px] sm:text-sm" style={{ color: 'var(--club-primary)' }}>{opt.label}</div>
          <div className="text-[9px] sm:text-[11px]" style={{ color: 'var(--muted)' }}>{opt.sub}</div>
          {opt.badge && (
            <div className={`option-badge option-badge-${opt.badge.tone} mt-0.5 sm:mt-1`}>
              {opt.badge.icon && <span className="option-badge-icon">{opt.badge.icon}</span>}
              <span>{opt.badge.t}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 sm:gap-1.5 mt-1 sm:mt-2">
        {opt.chips.map((c, i) => (
          <span key={i} className="chip-in" style={{ '--d': `${i * 70}ms` } as React.CSSProperties}>
            <ChipView chip={c} />
          </span>
        ))}
      </div>
    </button>
  );
}

/** Marco de la carta según fama: bronce → plata → oro → leyenda (el DT tiene el suyo).
 *  LEYENDA exige además haber ganado de verdad: fama sola (jugar mucho) no alcanza. */
function fameFrame(career: CareerState): { key: string; label: string } {
  if (career.phase === 'dt') return { key: 'dt', label: 'DT' };
  if (career.fame >= 80 && career.titles.length >= 5) return { key: 'leyenda', label: 'LEYENDA' };
  if (career.fame >= 55) return { key: 'oro', label: 'ORO' };
  if (career.fame >= 30) return { key: 'plata', label: 'PLATA' };
  return { key: 'bronce', label: 'BRONCE' };
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 2).map((w) => w[0]).join('')).toUpperCase();
}

function PlayerCard({ career }: { career: CareerState }) {
  const club = career.clubId ? career.clubs[career.clubId] : null;
  const rivals = club ? getClubRivals(club, career.clubs) : [];
  const isDt = career.phase === 'dt';
  const frame = fameFrame(career);
  
  const rating = isDt ? career.dtSkill : career.ability;
  const tier = rating >= 85 ? 'elite' : rating >= 75 ? 'gold' : rating >= 65 ? 'silver' : 'bronze';

  return (
    <header className={`pcard frame-b-${frame.key} p-2 sm:p-4 relative overflow-hidden`}>
      {/* Decorative background glow based on rating tier */}
      <div className={`absolute -top-10 -left-10 w-40 h-40 rounded-full opacity-20 blur-2xl rating-bg-${tier}`} aria-hidden />

      <div className="flex items-center gap-2 sm:gap-4 relative z-10">

        {/* FUT-style massive rating badge */}
        <div className={`fut-badge fut-${tier} flex-shrink-0 flex flex-col items-center justify-center shadow-lg`}>
          <div className="text-base sm:text-3xl font-num font-bold leading-none tracking-tighter"><CountNum value={rating} /></div>
          <div className="text-[8px] sm:text-xs font-display font-bold mt-0.5 opacity-90">
            {/* abreviatura siempre: el nombre completo no entra en el hexágono */}
            {isDt ? 'DT' : (POS_META[career.position]?.abbr ?? career.position)}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-display text-sm sm:text-2xl leading-tight" style={{ color: 'var(--club-primary)', textShadow: '0 2px 4px rgba(0,0,0,0.4)' }}>
            <span className="truncate block">{career.name}</span>
            <span className={`inline-block mt-0.5 text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded-sm border align-middle frame-${frame.key} shadow-sm`}>{frame.label}</span>
          </div>
          <div className="text-[9px] sm:text-xs font-num mt-0.5 sm:mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5" style={{ color: 'var(--text)' }}>
            <span className="opacity-80">{career.nationality}</span>
            <span className="opacity-40">·</span>
            <span className="opacity-80 whitespace-nowrap">{career.age} años</span>
            <span className="opacity-40">·</span>
            <span className="opacity-80 whitespace-nowrap">Temp. {career.year}/{String((career.year + 1) % 100).padStart(2, '0')}</span>
          </div>
        </div>

        {club && (
          <div className="flex flex-col items-end gap-1 text-right ml-2 flex-shrink-0">
            <Crest clubId={club.id} name={club.name} size={30} />
            <div className="font-display text-[9px] sm:text-sm truncate w-16 sm:w-28" style={{ color: 'var(--text)' }}>{club.name}</div>
            <div className="hidden sm:block text-[10px] font-num opacity-60">Nivel {clubLevel(club)}</div>
          </div>
        )}
      </div>

      {club && rivals.length > 0 && (
        <div className="rival-strip hidden sm:flex items-center gap-2 mt-4 px-2.5 py-1.5 relative z-10">
          <span className="font-display text-[9px]" style={{ color: 'var(--warn)' }}>CLÁSICOS</span>
          <div className="flex items-center gap-2 min-w-0 overflow-x-auto no-scrollbar">
            {rivals.map((rival) => (
              <span key={rival.club.id} className="rival-chip flex-shrink-0 inline-flex items-center gap-1.5 bg-black/20 px-1.5 py-0.5 rounded" title={rival.label}>
                <Crest clubId={rival.club.id} name={rival.club.name} size={18} />
                <span className="text-[10px]">{rival.club.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mt-2 sm:mt-4 text-center relative z-10">
        <Kpi label="FAMA" num={Math.round(career.fame)} />
        {isDt
          ? <Kpi label="TÍT. DT" value={`${career.titles.filter((t) => t.as === 'dt').length}`} accent={career.titles.some((t) => t.as === 'dt')} />
          : <Kpi label="SELECCIÓN" value={`${career.caps} PJ`} accent={career.caps > 0} />}
        <Kpi label="TÍTULOS" num={career.titles.length} accent={career.titles.length > 0} />
      </div>
    </header>
  );
}

function Kpi({ label, value, num, accent }: { label: string; value?: string; num?: number; accent?: boolean }) {
  return (
    <div className="panel py-1 sm:py-2 px-1 bg-black/10 border-white/5">
      <div className="font-display text-[7px] sm:text-[9px] mb-0 sm:mb-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="font-num text-sm sm:text-2xl font-bold" style={{ color: accent ? 'var(--club-primary)' : 'var(--text)', textShadow: accent ? '0 0 10px rgba(var(--club-primary-rgb),0.3)' : 'none' }}>
        {num !== undefined ? <CountNum value={num} /> : value}
      </div>
    </div>
  );
}

/** Resultado de un ciclo de DT (hasta 3 temporadas en una sola decisión). */
function CycleResult({ rows }: { rows: SeasonRow[] }) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const matches = rows.reduce((a, r) => a + r.apps, 0);
  const d = (i: number) => ({ '--d': `${i * 150}ms` } as React.CSSProperties);
  return (
    <section className="panel p-2 sm:p-3 slide-in" key={`${first.year}-${first.clubId}`}>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Crest clubId={first.clubId} name={first.clubName} size={20} />
        <div className="font-display text-[10px] sm:text-xs truncate" style={{ color: 'var(--muted)' }}>
          CICLO {first.year}–{last.year + 1} · {first.clubName} · {matches} PJ dirigidos
        </div>
      </div>
      <div className="flex flex-col gap-0.5 sm:gap-1 mt-1 sm:mt-2">
        {rows.map((r, i) => {
          const posColor = r.leaguePos === 1 ? 'var(--club-primary)' : r.leaguePos <= 4 ? 'var(--good)' : r.leaguePos >= 17 ? 'var(--bad)' : 'var(--text)';
          return (
            <div key={r.year} className="reveal-item flex items-center gap-2 sm:gap-3 font-num text-xs sm:text-sm" style={d(i)}>
              <span className="font-display text-[9px] sm:text-[10px] w-12 sm:w-14" style={{ color: 'var(--muted)' }}>{r.year}/{String((r.year + 1) % 100).padStart(2, '0')}</span>
              <b style={{ color: posColor, width: 34 }}>{r.leaguePos}°</b>
              <span style={{ color: r.rating >= 7 ? 'var(--good)' : r.rating < 6 ? 'var(--bad)' : 'var(--text)' }}>nota {r.rating.toFixed(1)}</span>
              <span className="flex-1 text-right">
                {r.titles.length > 0
                  ? <span className="inline-flex items-center gap-1 flex-wrap justify-end" style={{ color: 'var(--club-primary)' }}>
                      {r.titles.map((t, j) => <TitleMark key={j} title={t} size={14} />)} {r.titles.join(' + ')}
                    </span>
                  : r.note ? <span style={{ color: 'var(--bad)' }}>{r.note}</span>
                    : <span style={{ color: 'var(--muted)' }}>—</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SeasonResult({ career, row }: { career: CareerState; row: SeasonRow }) {
  const posColor = row.leaguePos === 1 ? 'var(--club-primary)' : row.leaguePos <= 4 ? 'var(--good)' : row.leaguePos >= 17 ? 'var(--bad)' : 'var(--text)';
  // el resultado cae por etapas: PJ → goles → nota → posición → título
  const d = (i: number) => ({ '--d': `${i * 150}ms` } as React.CSSProperties);
  return (
    <section className="panel p-2 sm:p-3 slide-in" key={`${row.year}-${row.clubId}`}>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Crest clubId={row.clubId} name={row.clubName} size={20} />
        <div className="font-display text-[10px] sm:text-xs truncate" style={{ color: 'var(--muted)' }}>
          TEMPORADA {row.year}/{String((row.year + 1) % 100).padStart(2, '0')} · {row.clubName}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 sm:gap-2 mt-1 sm:mt-2 text-center font-num">
        <div className="reveal-item" style={d(0)}><div className="text-sm sm:text-lg font-bold">{row.apps}</div><div className="text-[7px] sm:text-[9px] font-display" style={{ color: 'var(--muted)' }}>{row.role === 'Director técnico' ? 'PJ DIRIGIDOS' : 'PARTIDOS'}</div></div>
        <div className="reveal-item" style={d(1)}><div className="text-sm sm:text-lg font-bold">{row.role === 'Director técnico' ? '—' : row.goals}</div><div className="text-[7px] sm:text-[9px] font-display" style={{ color: 'var(--muted)' }}>GOLES</div></div>
        <div className="reveal-item" style={d(2)}><div className="text-sm sm:text-lg font-bold" style={{ color: row.rating >= 7 ? 'var(--good)' : row.rating < 6 ? 'var(--bad)' : 'var(--text)' }}>{row.rating.toFixed(1)}</div><div className="text-[7px] sm:text-[9px] font-display" style={{ color: 'var(--muted)' }}>NOTA</div></div>
        <div className="reveal-item" style={d(3)}><div className="text-sm sm:text-lg font-bold" style={{ color: posColor }}>{row.leaguePos}°</div><div className="text-[7px] sm:text-[9px] font-display" style={{ color: 'var(--muted)' }}>EL EQUIPO</div></div>
      </div>
      <div className="text-[9px] sm:text-[11px] mt-1 sm:mt-1.5 font-num reveal-item" style={{ color: 'var(--muted)', ...d(4) }}>Rol: {row.role}{row.note ? ` · ${row.note}` : ''}</div>
      {row.titles.length > 0 && (
        <div className="panel p-1.5 sm:p-2 mt-1.5 sm:mt-2 text-center reveal-item" style={{ borderColor: 'var(--club-primary)', background: 'rgba(var(--club-primary-rgb),0.08)', ...d(5) }}>
          <span className="font-display text-xs sm:text-sm inline-flex items-center gap-1 flex-wrap justify-center" style={{ color: 'var(--club-primary)' }}>
            {row.titles.map((t, i) => <TitleMark key={i} title={t} size={16} />)} ¡CAMPEÓN! {row.titles.join(' + ')}
          </span>
        </div>
      )}
    </section>
  );
}

/** Marca de un título: imagen oficial/estilizada del trofeo; los ascensos usan una flecha (no son trofeo). */
function TitleMark({ title, size = 18 }: { title: string; size?: number }) {
  if (title.startsWith('Ascenso')) {
    return <span title={title} style={{ color: 'var(--good)', fontWeight: 800, fontSize: size * 0.85, lineHeight: 1 }}>↑</span>;
  }
  return <Trophy title={title} size={size} />;
}

/** La trazabilidad: tu carrera club por club, con línea de tiempo conectando escudos. */
function Trajectory({ career, full }: { career: CareerState; full?: boolean }) {
  if (career.stints.length === 0) return null;
  const stints = [...career.stints].reverse();
  const newest = stints[0];
  const newestIsFresh = career.seasons.length > 0 && newest.endYear >= career.year; // etapa en curso
  return (
    <section className="panel p-3">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-display text-[10px]" style={{ color: 'var(--muted)' }}>TU TRAYECTORIA</div>
        <div className="text-[9px] font-num" style={{ color: 'var(--muted)' }}>{stints.length} etapas · {career.seasons.length} temporadas</div>
      </div>
      <div className="flex flex-col timeline">
        {stints.map((s, i) => (
          <React.Fragment key={`${s.clubId}-${s.startYear}`}>
          {(i === 0 || stints[i - 1].as !== s.as) && (
            <div className={`timeline-phase-label font-display ${s.as === 'dt' ? 'timeline-phase-dt' : ''}`}>
              {s.as === 'dt' ? 'SEGUNDA VIDA · COMO DT' : 'PRIMERA VIDA · COMO JUGADOR'}
            </div>
          )}
          <div
            className={`timeline-row flex items-stretch gap-3 py-2 ${s.as === 'dt' ? 'timeline-row-dt' : ''} ${i === 0 && newestIsFresh ? 'stint-new' : ''}`}
            >
            <div className="timeline-marker" aria-hidden>
              <div className="timeline-crest"><Crest clubId={s.clubId} name={s.clubName} size={48} /></div>
              {i < stints.length - 1 && <div className="timeline-connector" />}
            </div>
            <div className="timeline-entry flex-1 min-w-0">
              <div className="text-sm font-display truncate">
                {s.clubName}
                {s.as === 'dt' && <span className="text-[10px] ml-1.5 px-1 rounded-sm border" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>DT</span>}
                {s.loan && <span className="text-[10px] ml-1.5" style={{ color: 'var(--warn)' }}>PRÉSTAMO</span>}
              </div>
              <div className="text-[11px] font-num" style={{ color: 'var(--muted)' }}>
                {s.startYear}–{s.endYear} · {s.apps} PJ · {s.goals} goles
              </div>
              <div className="timeline-titles flex flex-wrap items-center gap-1 mt-1.5">
                {s.titles.length === 0
                  ? <span className="text-[11px]" style={{ color: 'var(--muted)' }}>—</span>
                  : <>
                    <span className="font-num text-[10px]" style={{ color: s.as === 'dt' ? '#86efac' : 'var(--club-primary)' }}>
                      {s.titles.length} {s.titles.length === 1 ? 'título' : 'títulos'}
                    </span>
                    {s.titles.slice(0, full ? 99 : 6).map((t, j) => (
                    <span key={`${t}-${j}`} title={t}
                      className={`inline-flex align-middle ${i === 0 ? 'trophy-drop' : ''}`}
                      style={i === 0 ? ({ '--d': `${j * 120}ms` } as React.CSSProperties) : undefined}>
                      <TitleMark title={t} size={22} />
                    </span>
                    ))}
                  </>}
              </div>
            </div>
          </div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}

// ------------------------------ Inicio ------------------------------

// Código FIFA por país: badge de selección legible en cualquier plataforma (mejor que la bandera-emoji).
const NAT_CODE: Record<string, string> = {
  Argentina: 'ARG', Brasil: 'BRA', Uruguay: 'URU', Colombia: 'COL', Chile: 'CHI', Perú: 'PER', Paraguay: 'PAR', Ecuador: 'ECU', Bolivia: 'BOL', Venezuela: 'VEN',
  Francia: 'FRA', España: 'ESP', Inglaterra: 'ENG', Alemania: 'GER', Portugal: 'POR', Italia: 'ITA', 'Países Bajos': 'NED', Bélgica: 'BEL', Croacia: 'CRO', Dinamarca: 'DEN',
  Suiza: 'SUI', Serbia: 'SRB', Austria: 'AUT', Turquía: 'TUR', Ucrania: 'UKR', Suecia: 'SWE', Noruega: 'NOR', Polonia: 'POL', 'República Checa': 'CZE', Rusia: 'RUS',
  Escocia: 'SCO', Grecia: 'GRE', Gales: 'WAL', Irlanda: 'IRL',
  México: 'MEX', 'Estados Unidos': 'USA', Canadá: 'CAN', 'Costa Rica': 'CRC', Jamaica: 'JAM', Honduras: 'HON',
  Marruecos: 'MAR', Senegal: 'SEN', Nigeria: 'NGA', 'Costa de Marfil': 'CIV', Argelia: 'ALG', Camerún: 'CMR', Egipto: 'EGY', Ghana: 'GHA', Malí: 'MLI', Sudáfrica: 'RSA',
  Japón: 'JPN', 'Corea del Sur': 'KOR', Irán: 'IRN', Australia: 'AUS', 'Arabia Saudita': 'KSA', Qatar: 'QAT',
};
const NAT_ISO: Record<string, string> = {
  Argentina: 'ar', Brasil: 'br', Uruguay: 'uy', Colombia: 'co', Chile: 'cl', Perú: 'pe', Paraguay: 'py', Ecuador: 'ec', Bolivia: 'bo', Venezuela: 've',
  Francia: 'fr', España: 'es', Inglaterra: 'gb', Alemania: 'de', Portugal: 'pt', Italia: 'it', 'Países Bajos': 'nl', Bélgica: 'be', Croacia: 'hr', Dinamarca: 'dk',
  Suiza: 'ch', Serbia: 'rs', Austria: 'at', Turquía: 'tr', Ucrania: 'ua', Suecia: 'se', Noruega: 'no', Polonia: 'pl', 'República Checa': 'cz', Rusia: 'ru',
  Escocia: 'gb', Grecia: 'gr', Gales: 'gb', Irlanda: 'ie',
  México: 'mx', 'Estados Unidos': 'us', Canadá: 'ca', 'Costa Rica': 'cr', Jamaica: 'jm', Honduras: 'hn',
  Marruecos: 'ma', Senegal: 'sn', Nigeria: 'ng', 'Costa de Marfil': 'ci', Argelia: 'dz', Camerún: 'cm', Egipto: 'eg', Ghana: 'gh', Malí: 'ml', Sudáfrica: 'za',
  Japón: 'jp', 'Corea del Sur': 'kr', Irán: 'ir', Australia: 'au', 'Arabia Saudita': 'sa', Qatar: 'qa',
};
// banderas locales (public/data/flags/): runtime 100% offline, sin CDN
const flagUrl = (n: string) => {
  const iso = NAT_ISO[n];
  return iso ? `${import.meta.env.BASE_URL ?? '/'}data/flags/${iso}.svg` : undefined;
};
// Agrupación por confederación para estructurar el selector (en vez de una pared plana).
const NAT_GROUPS: { label: string; nats: string[] }[] = [
  { label: 'Sudamérica', nats: ['Argentina', 'Brasil', 'Uruguay', 'Colombia', 'Chile', 'Perú', 'Paraguay', 'Ecuador', 'Bolivia', 'Venezuela'] },
  { label: 'Europa', nats: ['Francia', 'España', 'Inglaterra', 'Alemania', 'Portugal', 'Italia', 'Países Bajos', 'Bélgica', 'Croacia', 'Dinamarca', 'Suiza', 'Serbia', 'Austria', 'Turquía', 'Ucrania', 'Suecia', 'Noruega', 'Polonia', 'República Checa', 'Rusia', 'Escocia', 'Grecia', 'Gales', 'Irlanda'] },
  { label: 'Norteamérica', nats: ['México', 'Estados Unidos', 'Canadá', 'Costa Rica', 'Jamaica', 'Honduras'] },
  { label: 'África', nats: ['Marruecos', 'Senegal', 'Nigeria', 'Costa de Marfil', 'Argelia', 'Camerún', 'Egipto', 'Ghana', 'Malí', 'Sudáfrica'] },
  { label: 'Asia y Oceanía', nats: ['Japón', 'Corea del Sur', 'Irán', 'Australia', 'Arabia Saudita', 'Qatar'] },
];
// Posición: abreviatura + línea del campo (color).
const POS_META: Record<string, { abbr: string; line: 'arco' | 'def' | 'med' | 'del' }> = {
  Arquero: { abbr: 'POR', line: 'arco' }, 'Defensa central': { abbr: 'DFC', line: 'def' }, Lateral: { abbr: 'LAT', line: 'def' },
  'Mediocampista defensivo': { abbr: 'MCD', line: 'med' }, Mediocampista: { abbr: 'MC', line: 'med' }, Mediapunta: { abbr: 'MP', line: 'med' },
  Extremo: { abbr: 'EXT', line: 'del' }, Delantero: { abbr: 'DC', line: 'del' },
};

function StartScreen({ onStart }: { onStart: (name: string, nat: string, pos: PlayerPosition) => void }) {
  const [name, setName] = useState('');
  const [nat, setNat] = useState('Argentina');
  const [pos, setPos] = useState<PlayerPosition>('Delantero');
  const [showNatDropdown, setShowNatDropdown] = useState(false);
  const natDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showNatDropdown) return;
    const onDown = (event: MouseEvent) => {
      if (!natDropdownRef.current?.contains(event.target as Node)) {
        setShowNatDropdown(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [showNatDropdown]);

  const museum = loadMuseum();
  const records = museum.length === 0 ? null : {
    careers: museum.length,
    best: Math.max(...museum.map((m) => m.score)),
    bestName: museum.reduce((a, b) => (b.score > a.score ? b : a)).name,
    titles: museum.reduce((a, m) => a + m.titles + m.dtTitles, 0),
    goals: museum.reduce((a, m) => a + m.goals, 0),
  };

  return (
    <div className="max-w-xl mx-auto p-3 sm:p-4 flex flex-col gap-3 sm:gap-4 min-h-dvh justify-start sm:justify-center">
      <header className="create-hero px-5 pt-4 pb-4 sm:pt-6 sm:pb-5 text-center">
        <div className="field-label" style={{ opacity: 0.8 }}>Dinastía FC · Simulador de carrera</div>
        <h1 className="font-display text-4xl sm:text-6xl mt-1 leading-none" style={{ color: 'var(--club-primary)' }}>CARRERA</h1>
        <p className="mt-2 sm:mt-3 text-xs sm:text-sm mx-auto" style={{ color: 'var(--muted)', maxWidth: '38ch' }}>
          De la cantera al retiro, un club a la vez. Tomá decisiones, asumí consecuencias y construí tu leyenda.
        </p>
      </header>

      <div className="panel p-3 sm:p-4 flex flex-col gap-3 sm:gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Tu nombre</span>
          <input className="panel px-3 py-2.5 text-base" value={name} maxLength={26} placeholder="Ej: Juan Cruz Ledesma" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="relative" ref={natDropdownRef}>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="field-label">Nacionalidad</span>
            <span className="font-display text-xs flex items-center gap-1.5" style={{ color: 'var(--club-primary)' }}>
              <span className="code sel-code">{NAT_CODE[nat] ?? '—'}</span>{nat}
            </span>
          </div>
          <button
            type="button"
            className="btn nationality-trigger w-full justify-between"
            onClick={() => setShowNatDropdown((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={showNatDropdown}
          >
            <span className="flex items-center gap-3">
              <img className="flag-icon" src={flagUrl(nat)} alt={`${nat} flag`} />
              <span>{nat}</span>
            </span>
            <span className="nat-code">{NAT_CODE[nat] ?? '—'}</span>
          </button>

          {showNatDropdown && (
            <div className="nationality-dropdown-panel panel" role="listbox">
              {NAT_GROUPS.map((g) => (
                <div key={g.label} className="nationality-group">
                  <div className="nationality-group-name">{g.label}</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {g.nats.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`nationality-option ${nat === n ? 'sel' : ''}`}
                        onClick={() => {
                          setNat(n);
                          setShowNatDropdown(false);
                        }}
                      >
                        <img className="flag-icon" src={flagUrl(n)} alt={`${n} flag`} />
                        <span className="nat-name">{n}</span>
                        <span className="nat-code">{NAT_CODE[n] ?? n.slice(0, 3).toUpperCase()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="field-label mb-2">Posición</div>
          <div className="flex flex-wrap gap-1.5">
            {POSITION_LIST.map((p) => {
              const m = POS_META[p] ?? { abbr: '?', line: 'del' as const };
              return (
                <button key={p} className={`pick ${pos === p ? 'sel' : ''}`} onClick={() => setPos(p)}>
                  <span className={`posb ${m.line}`}>{m.abbr}</span>{p}
                </button>
              );
            })}
          </div>
        </div>

        <button className="btn btn-primary pulse-cta text-base w-full sm:w-auto sm:self-center px-8 py-3 justify-center" disabled={!name.trim()}
          onClick={() => onStart(name.trim(), nat, pos)}>
          Empezar mi carrera →
        </button>
      </div>

      {records && (
        <section className="panel p-3">
          <div className="font-display text-xs mb-2 text-center" style={{ color: 'var(--club-primary)' }}>TU HISTORIA COMO FUTBOLISTA VIRTUAL</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <Kpi label="CARRERAS" value={String(records.careers)} />
            <Kpi label="MEJOR PUNTAJE" value={String(records.best)} accent />
            <Kpi label="TÍTULOS TOTALES" value={String(records.titles)} />
            <Kpi label="GOLES TOTALES" value={String(records.goals)} />
          </div>
          <details className="mt-3">
            <summary className="font-display text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
              MUSEO — tus {museum.length} carreras terminadas
            </summary>
            <div className="flex flex-col gap-2 mt-2 max-h-64 overflow-y-auto pr-1">
              {museum.map((m, i) => (
                <div key={i} className="panel p-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-display text-sm">{m.name} <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{m.position} · {m.nationality}</span></span>
                    <span className="font-num text-sm"><b style={{ color: 'var(--club-primary)' }}>{m.score}</b> · {m.tier}</span>
                  </div>
                  <div className="text-[11px] font-num mt-1" style={{ color: 'var(--muted)' }}>
                    {m.seasons} temporadas · {m.apps} PJ · {m.goals} goles · {m.titles} títulos{m.dtSeasons > 0 ? ` · DT: ${m.dtSeasons} temp., ${m.dtTitles} títulos` : ''} · {m.date}
                  </div>
                  <div className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>{m.path}</div>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}
      <p className="text-center text-[11px]" style={{ color: 'var(--muted)' }}>
        Clubes y niveles reales de las 5 grandes ligas europeas · cada carrera es única
      </p>
    </div>
  );
}

// ------------------------------ Retiro ------------------------------

function RetirementScreen({ career, onReset, saved, onSaved }: { career: CareerState; onReset: () => void; saved: boolean; onSaved: () => void }) {
  const legacy = useMemo(() => computeCareerLegacy(career), [career]);
  const [copied, setCopied] = useState(false);
  const [building, setBuilding] = useState(false);
  const [sharing, setSharing] = useState(false);

  const cardFileName = `carrera-${career.name.replace(/\s+/g, '-').toLowerCase()}.png`;

  const downloadCard = async () => {
    if (building) return;
    setBuilding(true);
    try {
      const blob = await buildShareCard(career, legacy);
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = cardFileName;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } finally {
      setBuilding(false);
    }
  };

  const shareCard = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const blob = await buildShareCard(career, legacy);
      const file = blob ? new File([blob], cardFileName, { type: 'image/png' }) : null;
      const canShareFile = !!file && typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
      if (canShareFile && file) {
        // hoja nativa de compartir (WhatsApp, Instagram, etc.) con la tarjeta como imagen adjunta
        await navigator.share({ files: [file], title: 'Dinastía FC', text: shareText });
      } else {
        // sin soporte para adjuntar imágenes (típico en desktop): manda el resumen directo a WhatsApp
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
      }
    } catch {
      // el usuario cerró la hoja de compartir: no hacer nada
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => {
    if (saved) return;
    addToMuseum({
      name: career.name, position: career.position, nationality: career.nationality,
      tier: legacy.tier, score: legacy.score,
      seasons: career.seasons.length, apps: legacy.totalApps, goals: legacy.totalGoals,
      titles: career.titles.length, dtSeasons: legacy.dtSeasons, dtTitles: legacy.dtTitles,
      path: career.stints.map((s) => `${s.as === 'dt' ? '[DT] ' : ''}${s.clubName} ${s.startYear}-${s.endYear}${s.titles.length ? ' ×' + s.titles.length : ''}`).join(' · '),
      date: new Date().toLocaleDateString('es-AR'),
    });
    saveCurrent(null); // la carrera terminada sale del autosave y entra al museo
    onSaved();
  }, [saved]);

  const shareText = `⚽ ${career.name} — ${legacy.tier} (${legacy.score}/1000)\n` +
    `${career.seasons.length} temporadas · ${legacy.totalApps} PJ · ${legacy.totalGoals} goles · ${career.titles.length} títulos\n` +
    (legacy.awards.length > 0 ? `${legacy.awards.map((a) => a.award).join(' · ')}\n` : '') +
    career.stints.map((s) => `${s.startYear}-${s.endYear} ${s.as === 'dt' ? '[DT] ' : ''}${s.clubName}${s.titles.length ? ' ×' + s.titles.length : ''}`).join('\n') +
    `\n¿Cómo sería tu carrera? — Dinastía FC`;

  return (
    <div className="max-w-xl mx-auto p-3 sm:p-4 flex flex-col gap-3 min-h-dvh justify-start sm:justify-center">
      <header className="text-center">
        <p className="font-display text-xs" style={{ color: 'var(--muted)' }}>FIN DE LA CARRERA · {career.year}</p>
        <h1 className="font-display text-3xl sm:text-4xl mt-1" style={{ color: 'var(--club-primary)' }}>{legacy.tier}</h1>
        <p className="mt-1 text-sm">{career.name} · {career.position} · {career.nationality}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{legacy.tagline}</p>
        <div className="mt-3 inline-block panel px-8 py-3">
          <div className="font-display text-[10px]" style={{ color: 'var(--muted)' }}>PUNTAJE DE LEYENDA</div>
          <div className="font-num text-4xl font-bold" style={{ color: legacy.score >= 550 ? 'var(--good)' : legacy.score >= 220 ? 'var(--warn)' : 'var(--bad)' }}>
            {legacy.score}<span className="text-base" style={{ color: 'var(--muted)' }}>/1000</span>
          </div>
        </div>
        {career.retirementNote && <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{career.retirementNote}</p>}
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <Kpi label="TEMPORADAS" value={String(career.seasons.length)} />
        <Kpi label="PARTIDOS" value={String(legacy.totalApps)} />
        <Kpi label="GOLES" value={String(legacy.totalGoals)} />
        <Kpi label="TÍTULOS" value={String(career.titles.length)} accent={career.titles.length > 0} />
      </div>

      {legacy.dtSeasons > 0 && (
        <div className="panel p-3">
          <div className="font-display text-[10px] mb-2 text-center" style={{ color: 'var(--warn)' }}>SEGUNDA VIDA: DIRECTOR TÉCNICO</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Kpi label="TEMP. DIRIGIDAS" value={String(legacy.dtSeasons)} />
            <Kpi label="PJ EN EL BANCO" value={String(legacy.dtMatches)} />
            <Kpi label="TÍTULOS COMO DT" value={String(legacy.dtTitles)} accent={legacy.dtTitles > 0} />
          </div>
        </div>
      )}

      {career.titles.length > 0 && (
        <section className="panel p-3">
          <div className="font-display text-[10px] mb-2 text-center" style={{ color: 'var(--muted)' }}>PALMARÉS</div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {career.titles.map((t, i) => (
              <span key={i} className="font-num text-xs inline-flex items-center gap-1">
                <TitleMark title={t.title} size={16} /> {t.title}{t.as === 'dt' ? ' (DT)' : ''} <b style={{ color: 'var(--club-primary)' }}>{t.year}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      {legacy.awards.length > 0 && (
        <section className="panel p-3">
          <div className="font-display text-[10px] mb-2 text-center" style={{ color: 'var(--muted)' }}>PREMIOS INDIVIDUALES</div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {legacy.awards.map((a, i) => (
              <span key={i} className="font-num text-xs inline-flex items-center gap-1">
                <AwardMark award={a.award} size={16} /> {a.award}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="flex justify-center gap-2 flex-wrap">
        <button className="btn" disabled={sharing} onClick={shareCard}>
          {sharing ? 'Preparando…' : 'Compartir 📲'}
        </button>
        <button className="btn" disabled={building} onClick={downloadCard}>
          {building ? 'Generando…' : 'Descargar tarjeta 🖼'}
        </button>
        <button className="btn" onClick={async () => {
          try { await navigator.clipboard.writeText(shareText); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* sin permiso */ }
        }}>{copied ? '✓ Copiado' : 'Copiar resumen 📋'}</button>
        <button className="btn btn-primary pulse-cta" onClick={onReset}>Otra carrera 🔁</button>
      </div>

      <Trajectory career={career} full />
      <MomentsPanel career={career} full />

      <details className="panel p-3 text-xs">
        <summary className="font-display cursor-pointer" style={{ color: 'var(--muted)' }}>¿De dónde sale el puntaje?</summary>
        <ul className="font-num mt-2 flex flex-col gap-0.5">
          {legacy.breakdown.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </details>
    </div>
  );
}
