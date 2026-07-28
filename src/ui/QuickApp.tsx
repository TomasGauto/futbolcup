import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Difficulty, GameState } from '../domain/types';
import type { EtlData, EtlClub } from '../domain/worldgen';
import { createGame } from '../domain/engine';
import { computeLegacy } from '../domain/legacy';
import { Rng } from '../domain/rng';
import { drawCards, simulateBiennium, squadStrength, type BienniumRecap, type QuickCard } from '../domain/quick';
import { loadAssetManifest } from './assets';
import { Crest, LeagueTrophy, Trophy } from './Crest';

// ElGoat.online — modo único "partida rápida": 15 decisiones, una por bienio.
// Un clic = un bienio simulado. Una partida completa dura ~5 minutos.

type BestRun = { club: string; score: number; title: string; titles: number; date: string };

function loadBest(): BestRun[] {
  try { return JSON.parse(localStorage.getItem('dinastia-quick-best') ?? '[]'); } catch { return []; }
}
function saveBest(runs: BestRun[]): void {
  try { localStorage.setItem('dinastia-quick-best', JSON.stringify(runs.slice(0, 10))); } catch { /* memoria */ }
}

export default function QuickApp() {
  const [etl, setEtl] = useState<EtlData | null>(null);
  const [err, setErr] = useState('');
  const gameRef = useRef<GameState | null>(null);
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const [cards, setCards] = useState<QuickCard[]>([]);
  const [recap, setRecap] = useState<{ note: string; data: BienniumRecap } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const base = import.meta.env.BASE_URL ?? '/';
    Promise.all([
      fetch(`${base}data/clubs.json`).then((r) => r.json()),
      fetch(`${base}data/leagues.json`).then((r) => r.json()),
      fetch(`${base}data/history.json`).then((r) => r.json()),
      loadAssetManifest(base), // escudos + trofeos (no bloquea si falta)
    ]).then(([clubs, leagues, history]) => setEtl({ clubs, leagues, history }))
      .catch(() => setErr('No se pudieron cargar los datos. Corré `npm run etl` y recargá.'));
  }, []);

  const start = (club: EtlClub, difficulty: Difficulty) => {
    if (!etl) return;
    const seed = `quick-${Date.now() % 1e9}-${Math.floor(Math.random() * 1e6)}`;
    const game = createGame(etl, {
      seed, clubId: club.id,
      manager: { name: 'El Míster', nationality: 'Argentina', background: 'datos', reputation: 40 },
      difficulty,
    });
    gameRef.current = game;
    setRecap(null);
    setSaved(false);
    setCards(drawCards(game, new Rng(game.rng)));
    bump();
  };

  const choose = (card: QuickCard) => {
    const game = gameRef.current;
    if (!game) return;
    const rng = new Rng(game.rng);
    const note = card.apply(game, rng);
    const data = simulateBiennium(game);
    setRecap({ note, data });
    setCards([]);
    bump();
  };

  const nextBiennium = () => {
    const game = gameRef.current;
    if (!game) return;
    setRecap(null);
    setCards(drawCards(game, new Rng(game.rng)));
    bump();
  };

  const reset = () => { gameRef.current = null; setRecap(null); setCards([]); setSaved(false); bump(); };

  if (err) return <Center><p style={{ color: 'var(--bad)' }}>{err}</p></Center>;
  if (!etl) return <Center><p className="font-display" style={{ color: 'var(--muted)' }}>Cargando 30 años de historia…</p></Center>;

  const game = gameRef.current;
  if (!game) return <StartScreen etl={etl} onStart={start} />;

  const finished = game.phase === 'legado' || game.phase === 'despido';
  if (finished && recap === null) {
    return <EndScreen game={game} onReset={reset} saved={saved} onSaved={() => setSaved(true)} />;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 flex flex-col gap-4 min-h-screen">
      <Header game={game} />
      {recap ? (
        <RecapPanel game={game} note={recap.note} data={recap.data}
          onNext={recap.data.gameOver ? () => { setRecap(null); bump(); } : nextBiennium}
          isLast={recap.data.gameOver} />
      ) : (
        <>
          <p className="font-display text-center text-sm" style={{ color: 'var(--club-primary)' }}>
            DECISIÓN {game.currentBiennium} DE 15 — elegí una carta y se simulan 2 temporadas
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {cards.map((c) => (
              <button key={c.id} className="panel p-4 text-left cursor-pointer hover:brightness-125 transition-all flex flex-col gap-2"
                onClick={() => choose(c)}>
                <span className="text-3xl">{c.icon}</span>
                <span className="font-display text-sm" style={{ color: 'var(--club-primary)' }}>{c.title}</span>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{c.desc}</span>
                <span className="flex flex-col gap-1 mt-auto pt-1">
                  {c.chips.map((ch, i) => {
                    const color = ch.tone === 'good' ? 'var(--good)' : ch.tone === 'bad' ? 'var(--bad)' : 'var(--warn)';
                    return (
                      <span key={i} className="font-num text-[11px] px-1.5 py-0.5 rounded-sm border self-start"
                        style={{ color, borderColor: color }}>
                        {ch.tone === 'good' ? '▲' : ch.tone === 'bad' ? '▼' : '⚠'} {ch.t}
                      </span>
                    );
                  })}
                </span>
              </button>
            ))}
          </div>
          <p className="text-center text-[11px]" style={{ color: 'var(--muted)' }}>
            Objetivo de la junta: {game.objectives.sportive.toLowerCase()} · confianza {game.boardTrust}/100
          </p>
        </>
      )}
    </div>
  );
}

// ------------------------------ Piezas ------------------------------

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-4">{children}</div>;
}

/** Todos los títulos ganados, en orden: [{season, title}] */
function trophies(game: GameState): { season: string; title: string }[] {
  return game.clubs[game.clubId].history.flatMap((r) => r.titles.map((t) => ({ season: r.season, title: t })));
}

function Header({ game }: { game: GameState }) {
  const me = game.clubs[game.clubId];
  document.documentElement.style.setProperty('--club-primary', me.colors.primary === '#ffffff' ? me.colors.secondary : me.colors.primary);
  const won = trophies(game);
  const strength = squadStrength(game);
  return (
    <header className="panel p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Crest clubId={game.clubId} name={me.name} size={32} />
        <h1 className="font-display text-lg" style={{ color: 'var(--club-primary)' }}>{me.name}</h1>
        <span className="font-num text-xs" style={{ color: 'var(--muted)' }}>
          Bienio {Math.min(game.currentBiennium, 15)}/15 · {me.division === 1 ? 'Primera' : `División ${me.division}`}
        </span>
        <div className="ml-auto flex gap-4 font-num text-xs">
          <span title="Fuerza del plantel (media de los 14 mejores)">⚽ <b style={{ color: 'var(--club-primary)' }}>{strength}</b></span>
          <span title="Prestigio del club">✨ {me.prestige}</span>
          <span title="Caja">💰 <b style={{ color: me.finances.cash < 0 ? 'var(--bad)' : 'var(--good)' }}>{me.finances.cash.toFixed(0)}M</b></span>
          <span title="Confianza de la junta">🏛 {game.boardTrust}</span>
          <span title="Humor de la hinchada">📣 {me.fanbase.mood}</span>
        </div>
      </div>

      {/* Vitrina de trofeos: crece a medida que ganás */}
      <div className="mt-2 flex items-center gap-1 flex-wrap min-h-6" aria-label="Vitrina de trofeos">
        <span className="font-display text-[10px] mr-1" style={{ color: 'var(--muted)' }}>VITRINA</span>
        {won.length === 0 && <span className="text-[11px]" style={{ color: 'var(--muted)' }}>vacía… por ahora</span>}
        {won.map((t, i) => (
          <Trophy key={i} title={`${t.title} — ${t.season}`} size={22} className="cursor-default" />
        ))}
      </div>

      <BienniumTimeline game={game} />
    </header>
  );
}

/** 15 casilleros: dorado = título, verde = arriba, gris = mitad, rojo = abajo/descenso. */
function BienniumTimeline({ game }: { game: GameState }) {
  const cells = Array.from({ length: 15 }, (_, i) => {
    const a = game.annals[i * 2];
    const b = game.annals[i * 2 + 1];
    if (!a) return { color: 'var(--line)', label: `Bienio ${i + 1}: por jugar`, icon: '' };
    const pair = [a, b].filter(Boolean) as typeof game.annals;
    const hasTitle = pair.some((x) => x.note.length > 0);
    const bestPos = Math.min(...pair.map((x) => (x.division === 1 ? x.position : x.position + 20)));
    const worstPos = Math.max(...pair.map((x) => (x.division === 1 ? x.position : x.position + 20)));
    const label = pair.map((x) => `${x.season}: ${x.position}°${x.division > 1 ? ` (div ${x.division})` : ''}${x.note ? ' · ' + x.note : ''}`).join('  |  ');
    if (hasTitle) return { color: 'var(--club-primary)', label, icon: '' };
    if (bestPos <= 6) return { color: 'var(--good)', label, icon: '' };
    if (worstPos >= 18) return { color: 'var(--bad)', label, icon: '' };
    return { color: 'var(--muted)', label, icon: '' };
  });
  return (
    <div className="mt-2 grid grid-cols-15 gap-1" style={{ gridTemplateColumns: 'repeat(15, 1fr)' }} aria-label="Recorrido de los 15 bienios">
      {cells.map((c, i) => (
        <div key={i} title={c.label}
          className="h-4 rounded-sm flex items-center justify-center text-[9px] cursor-default"
          style={{
            background: c.color,
            opacity: game.annals[i * 2] ? 1 : 0.35,
            outline: i === game.currentBiennium - 1 ? '2px solid var(--text)' : 'none',
          }}>
          {c.icon}
        </div>
      ))}
    </div>
  );
}

function PositionsSpark({ game }: { game: GameState }) {
  if (game.annals.length < 2) return null;
  const pts = game.annals.map((a) => (a.division === 1 ? a.position : a.position + 20));
  const w = 560; const h = 36;
  const x = (i: number) => (i / Math.max(1, pts.length - 1)) * w;
  const y = (p: number) => ((p - 1) / 39) * h;
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full mt-2" style={{ height: 36 }} aria-label="Posiciones por temporada (arriba = mejor)">
      <line x1="0" y1={y(20.5)} x2={w} y2={y(20.5)} stroke="var(--line)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="var(--club-primary)" strokeWidth="2" />
      {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p)} r="2.4" fill={p === 1 ? 'var(--good)' : 'var(--club-primary)'} />)}
    </svg>
  );
}

function ProgressBox({ label, before, after }: { label: string; before: number; after: number }) {
  const d = after - before;
  const color = d > 0 ? 'var(--good)' : d < 0 ? 'var(--bad)' : 'var(--muted)';
  return (
    <div className="panel p-3 text-center">
      <div className="font-display text-[10px]" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="font-num text-2xl font-bold mt-0.5">
        {before} <span style={{ color }}>{d > 0 ? '↗' : d < 0 ? '↘' : '→'}</span> {after}
      </div>
      <div className="font-num text-[11px]" style={{ color }}>{d > 0 ? `+${d}` : d < 0 ? d : 'sin cambios'}</div>
    </div>
  );
}

function Delta({ before, after }: { before: number; after: number }) {
  const d = after - before;
  const color = d > 0 ? 'var(--good)' : d < 0 ? 'var(--bad)' : 'var(--muted)';
  return <b className="font-num" style={{ color }}>{before}→{after} ({d >= 0 ? '+' : ''}{d})</b>;
}

function RecapPanel({ game, note, data, onNext, isLast }: {
  game: GameState; note: string; data: BienniumRecap; onNext: () => void; isLast: boolean;
}) {
  return (
    <div className="panel p-4 slide-in flex flex-col gap-3">
      {/* Banner de campeón: que se sienta */}
      {data.titlesWon.length > 0 && (
        <div className="panel p-4 text-center" style={{ borderColor: 'var(--club-primary)', background: 'rgba(212,176,98,0.08)' }}>
          <div className="flex justify-center items-end gap-2 flex-wrap">
            {data.titlesWon.map((t, i) => <Trophy key={i} title={t} size={44} />)}
          </div>
          <div className="font-display text-lg mt-1" style={{ color: 'var(--club-primary)' }}>
            ¡CAMPEÓN!
          </div>
          <div className="text-sm mt-1">{data.titlesWon.join(' · ')}</div>
        </div>
      )}

      <p className="text-sm"><b style={{ color: 'var(--club-primary)' }}>Tu decisión:</b> {note}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {data.seasons.map((s, i) => (
          <div key={i} className="panel p-3">
            <div className="font-display text-xs" style={{ color: 'var(--muted)' }}>{s.season} · {s.division === 1 ? 'Primera' : `División ${s.division}`}</div>
            <div className="font-num text-2xl font-bold mt-1" style={{ color: s.position <= 4 && s.division === 1 ? 'var(--good)' : s.position >= 18 ? 'var(--bad)' : 'var(--text)' }}>
              {s.position}° <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>· {s.points} pts</span>
            </div>
            <div className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>{s.cup}</div>
            {s.titles.length > 0 && (
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {s.titles.map((t, i) => <Trophy key={i} title={t} size={16} />)}
                <span className="text-xs" style={{ color: 'var(--good)' }}>{s.titles.join(' + ')}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* El club progresó (o no): fuerza y prestigio bien grandes */}
      <div className="grid grid-cols-2 gap-2">
        <ProgressBox label="⚽ FUERZA DEL PLANTEL" before={data.strengthBefore} after={data.strengthAfter} />
        <ProgressBox label="✨ PRESTIGIO" before={data.prestigeBefore} after={data.prestigeAfter} />
      </div>

      {/* Por qué: estado del club en dos líneas */}
      <div className="panel p-3 text-xs flex flex-col gap-1.5">
        <div className="font-display text-[10px]" style={{ color: 'var(--muted)' }}>CÓMO QUEDASTE</div>
        <span>
          🏛 Junta: <Delta before={data.trustBefore} after={data.trustAfter} />
          {data.objectiveMet !== null && (
            <span style={{ color: data.objectiveMet ? 'var(--good)' : 'var(--warn)' }}>
              {' '}— objetivo "{game.objectives.sportive.toLowerCase()}" {data.objectiveMet ? 'CUMPLIDO ✓' : 'incumplido ✗'}
            </span>
          )}
        </span>
        <span>📣 Hinchada: <Delta before={data.moodBefore} after={data.moodAfter} /></span>
        <span>💰 Caja del bienio: <b className="font-num" style={{ color: data.cashDelta >= 0 ? 'var(--good)' : 'var(--bad)' }}>{data.cashDelta >= 0 ? '+' : ''}{data.cashDelta}M</b> (ahora {game.clubs[game.clubId].finances.cash.toFixed(0)}M)</span>
      </div>

      {data.warnings.length > 0 && (
        <div className="panel p-3 text-xs flex flex-col gap-1" style={{ borderColor: 'var(--warn)' }}>
          <div className="font-display text-[10px]" style={{ color: 'var(--warn)' }}>⚠ PELIGRO</div>
          {data.warnings.map((w, i) => <span key={i} style={{ color: 'var(--warn)' }}>{w}</span>)}
        </div>
      )}

      {data.gameOverReason && (
        <div className="panel p-3 text-sm" style={{ borderColor: 'var(--bad)', color: 'var(--bad)' }}>
          ⛔ {data.gameOverReason}
        </div>
      )}

      {data.moments.length > 0 && (
        <div className="text-[11px] flex flex-col gap-1" style={{ color: 'var(--muted)' }}>
          <span className="font-display text-[10px]">SUCESOS QUE SE RESOLVIERON SOLOS</span>
          {data.moments.map((m, i) => <span key={i}>⚡ {m}</span>)}
        </div>
      )}
      {data.headlines.length > 0 && (
        <div className="text-xs flex flex-col gap-1">
          {data.headlines.map((h, i) => <span key={i}>📰 <i>{h}</i></span>)}
        </div>
      )}
      <button className="btn btn-primary pulse-cta self-center mt-1" onClick={onNext}>
        {isLast ? 'Ver el veredicto final →' : `Bienio ${game.currentBiennium}/15 →`}
      </button>
    </div>
  );
}

function StartScreen({ etl, onStart }: { etl: EtlData; onStart: (c: EtlClub, d: Difficulty) => void }) {
  const [query, setQuery] = useState('');
  const [league, setLeague] = useState('todas');
  const [difficulty, setDifficulty] = useState<Difficulty>('Realista');
  const best = loadBest();

  const clubs = useMemo(() => etl.clubs
    .filter((c) => c.division === 1)
    .filter((c) => league === 'todas' || c.leagueId === league)
    .filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.elo - a.elo), [etl, query, league]);

  const stars = (c: EtlClub) => c.elo > 1750 ? 1 : c.elo > 1620 ? 2 : c.elo > 1540 ? 3 : c.elo > 1480 ? 4 : 5;
  const random = () => onStart(clubs[Math.floor(Math.random() * clubs.length)], difficulty);

  return (
    <div className="max-w-3xl mx-auto p-4 flex flex-col gap-4 min-h-screen">
      <header className="text-center pt-8 pb-2">
        <h1 className="font-display text-5xl" style={{ color: 'var(--club-primary)' }}>DINASTÍA FC</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          Partida rápida: <b>15 decisiones, 30 años, un legado.</b> Elegí un club y jugá en 5 minutos.
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-center gap-x-4 gap-y-2" aria-label="Trofeos de las ligas">
          {etl.leagues.map((l) => (
            <span key={l.id} className="flex flex-col items-center gap-1" title={l.name} style={{ width: 62 }}>
              <LeagueTrophy leagueId={l.id} title={l.name} size={36} />
              <span className="font-num text-[9px] text-center leading-tight" style={{ color: 'var(--muted)' }}>{l.name}</span>
            </span>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <input className="panel px-3 py-2 flex-1 min-w-40" placeholder="Buscar club…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="panel px-2 py-2" value={league} onChange={(e) => setLeague(e.target.value)}>
          <option value="todas">Todas las ligas</option>
          {etl.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select className="panel px-2 py-2" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
          <option value="Sandbox">Sandbox</option>
          <option value="Realista">Realista</option>
          <option value="Leyenda">Leyenda</option>
        </select>
        <button className="btn btn-primary" onClick={random}>🎲 Club al azar</button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-[46vh] overflow-y-auto pr-1">
        {clubs.map((c) => (
          <button key={c.id} className="panel p-3 text-left cursor-pointer hover:brightness-125" onClick={() => onStart(c, difficulty)}>
            <div className="flex items-center gap-2">
              <Crest clubId={c.id} name={c.name} size={30} />
              <span className="font-display text-sm truncate flex-1">{c.name}</span>
              <span className="font-num text-[10px]" style={{ color: 'var(--club-primary)' }} title="Dificultad">{'★'.repeat(stars(c))}</span>
            </div>
            <div className="text-[11px] mt-1 font-num" style={{ color: 'var(--muted)' }}>
              {etl.leagues.find((l) => l.id === c.leagueId)?.name} · Elo {c.elo} · {c.titles} títulos desde 1993
            </div>
          </button>
        ))}
      </div>

      {best.length > 0 && (
        <section className="panel p-3">
          <div className="font-display text-xs mb-2" style={{ color: 'var(--muted)' }}>TUS MEJORES ERAS</div>
          <ol className="text-xs font-num flex flex-col gap-1">
            {best.map((r, i) => (
              <li key={i}>{i + 1}. <b style={{ color: 'var(--club-primary)' }}>{r.score}</b> — {r.club} · «{r.title}» · {r.titles} títulos <span style={{ color: 'var(--muted)' }}>({r.date})</span></li>
            ))}
          </ol>
        </section>
      )}
      <p className="text-center text-[11px] pb-4" style={{ color: 'var(--muted)' }}>
        Datos reales de Premier, La Liga, Serie A, Bundesliga y Ligue 1 desde 1993 · cada partida es distinta
      </p>
    </div>
  );
}

function EndScreen({ game, onReset, saved, onSaved }: { game: GameState; onReset: () => void; saved: boolean; onSaved: () => void }) {
  const me = game.clubs[game.clubId];
  const legacy = useMemo(() => computeLegacy(game), [game]);
  const isFired = game.phase === 'despido';

  useEffect(() => {
    if (saved) return;
    const runs = loadBest();
    runs.push({ club: me.name, score: legacy.score, title: legacy.eraTitle, titles: legacy.titles.length, date: new Date().toLocaleDateString('es-AR') });
    runs.sort((a, b) => b.score - a.score);
    saveBest(runs);
    onSaved();
  }, [saved]);

  const firedReason = isFired
    ? game.log.find((e) => e.headline.includes('DESPEDIDO') || e.headline.includes('DESCENSO ADMINISTRATIVO'))?.body ?? null
    : null;

  return (
    <div className="max-w-3xl mx-auto p-4 flex flex-col gap-4 min-h-screen justify-center">
      <header className="text-center">
        <p className="font-display text-xs" style={{ color: 'var(--muted)' }}>
          {isFired ? '⛔ TE ECHARON ANTES DE TIEMPO' : '30 AÑOS DESPUÉS — EL VEREDICTO'}
        </p>
        {firedReason && <p className="text-xs mt-1" style={{ color: 'var(--bad)' }}>{firedReason}</p>}
        <h1 className="font-display text-4xl mt-2" style={{ color: 'var(--club-primary)' }}>«{legacy.eraTitle}»</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>{me.name} · {game.annals.length} temporadas dirigidas</p>
        <div className="mt-4 inline-block panel px-10 py-4">
          <div className="font-display text-xs" style={{ color: 'var(--muted)' }}>PUNTAJE DE LEGADO</div>
          <div className="font-num text-5xl font-bold" style={{ color: legacy.score >= 600 ? 'var(--good)' : legacy.score >= 350 ? 'var(--warn)' : 'var(--bad)' }}>
            {legacy.score}<span className="text-lg" style={{ color: 'var(--muted)' }}>/1000</span>
          </div>
        </div>
      </header>

      <div className="panel p-3"><PositionsSpark game={game} /></div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <Kpi label="Títulos" value={String(legacy.titles.length)} good={legacy.titles.length > 0} />
        <Kpi label="Posición prom." value={String(legacy.avgPosition)} good={legacy.avgPosition <= game.baseline.expectedPos} />
        <Kpi label="Prestigio" value={`${game.baseline.prestige}→${me.prestige}`} good={legacy.prestigeDelta >= 0} />
        <Kpi label="Caja final" value={`${legacy.finalCash.toFixed(0)}M`} good={legacy.finalCash >= 0} />
      </div>

      <p className="text-sm text-center">{legacy.baselineVerdict}</p>

      <section className="panel p-3">
        <div className="font-display text-xs mb-2 text-center" style={{ color: 'var(--muted)' }}>VITRINA DE LA ERA</div>
        {legacy.titles.length === 0
          ? <p className="text-center text-sm" style={{ color: 'var(--muted)' }}>Vacía. Las vitrinas no cuentan toda la historia… pero ayudan.</p>
          : (
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
              {trophies(game).map((t, i) => (
                <span key={i} className="font-num text-xs flex items-center gap-1">
                  <Trophy title={`${t.title} — ${t.season}`} size={26} />
                  {t.title} <b style={{ color: 'var(--club-primary)' }}>{t.season}</b>
                </span>
              ))}
            </div>
          )}
      </section>

      <div className="panel p-3">
        <div className="font-display text-[10px] mb-1" style={{ color: 'var(--muted)' }}>LOS 15 BIENIOS</div>
        <BienniumTimeline game={game} />
      </div>
      {legacy.topLegend && (
        <p className="text-center text-xs" style={{ color: 'var(--muted)' }}>
          Leyenda de la era: <b style={{ color: 'var(--club-primary)' }}>{legacy.topLegend.name}</b> ({legacy.topLegend.apps} PJ, {legacy.topLegend.goals} goles)
        </p>
      )}

      <details className="panel p-3 text-xs">
        <summary className="font-display cursor-pointer" style={{ color: 'var(--muted)' }}>¿De dónde sale el puntaje?</summary>
        <ul className="font-num mt-2 flex flex-col gap-0.5">
          {legacy.breakdown.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </details>

      <button className="btn btn-primary pulse-cta self-center" onClick={onReset}>Jugar otra era 🔁</button>
    </div>
  );
}

function Kpi({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="panel p-3">
      <div className="font-display text-[10px]" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="font-num text-xl font-bold" style={{ color: good ? 'var(--good)' : 'var(--warn)' }}>{value}</div>
    </div>
  );
}
