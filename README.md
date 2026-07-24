# Dinastía FC

Simulador de dirección de club de fútbol: elegís un club real y lo dirigís durante **30 temporadas (2026/27 → 2055/56), avanzando en bienios**. No es un juego de partidos: es un juego de decisiones estructurales de largo plazo — fichajes, estadio, sponsors, deuda, cantera, precios — con consecuencias visibles diez años después.

Webapp React + TypeScript + Tailwind + Zustand, jugable en una sola sesión (45–90 min), 100% offline en runtime.

## Cómo correr

```bash
npm install
npm run etl        # una sola vez: descarga y procesa los datos reales → public/data/
npm run dev        # abre la app en http://localhost:5173
```

Otros comandos:

```bash
npm test           # 16 tests unitarios (RNG, Elo, Dixon-Coles, calendario, economía, determinismo)
npm run validate   # simula 30 temporadas sin UI y verifica los criterios de realismo (§14)
npm run build      # bundle de producción en dist/
```

## Datos reales

El ETL (`scripts/etl.ts`) descarga los CSVs de [datasets/football-datasets](https://github.com/datasets/football-datasets) (PDDL 1.0, derivado de football-data.co.uk): **Premier League, La Liga, Serie A, Bundesliga y Ligue 1 desde 1993/94**. De ahí deriva:

- **Elo histórico** partido a partido (~33 temporadas por liga), con regresión del 15% a la media por temporada.
- **Ratings ataque/defensa** (log-ratio de goles vs. promedio de liga, últimas 3 temporadas con decaimiento exponencial).
- **Perfil de estilo**: agresividad (faltas + tarjetas), dominancia (remates + córners), localía propia.
- **Ventaja de localía por liga** en puntos Elo (calculada: 59–72 según liga).
- **Palmarés reconstruido** (campeones, top-4) → prestigio inicial.
- Los clubes históricos que ya no están en primera pueblan las **divisiones inferiores reales**; se completan con clubes sintéticos persistentes.

Lo que el dataset no tiene (jugadores, plata, estadios) se **genera proceduralmente anclado a esos datos**: un club de Elo 1900 recibe plantilla, presupuesto y estadio de potencia; uno de 1500, no. `scripts/sources.config.json` permite enchufar más ligas sin tocar el código del juego. Los alias de nombres se editan en `public/data/aliases.json` (se regenera con el ETL desde `scripts/etl.ts`).

En runtime la app **no hace ninguna llamada de red externa**: solo lee los JSON estáticos de `public/data/`.

## Arquitectura

```
scripts/etl.ts          ETL offline (descarga, Elo, ratings, palmarés → public/data/*.json)
scripts/validate.ts     Validación estadística: 30 temporadas headless con reporte OK/FAIL
src/domain/             Motor puro (sin React):
  rng.ts                mulberry32 con sub-streams (match/injury/market/event/dev/world)
  types.ts              Modelo de datos completo
  worldgen.ts           Generación determinista del mundo desde el ETL + seed
  playergen.ts          Plantillas, juveniles, nombres por nacionalidad
  valuation.ts          Valor de mercado y salarios (§ fórmulas abajo)
  calendar.ts           Round-robin de Berger, ida y vuelta
  match.ts              Motor Dixon-Coles bivariado + fuerza de once + táctica + Elo
  season.ts             Temporada: ligas, copas nacionales, 3 copas continentales, ascensos
  economy.ts            P&L, asistencia con elasticidad, TV, FFP, rating crediticio, shocks
  development.ts        Curva de edad, moral por rol, retiros, contratos, camadas
  ai.ts                 Cerebro de los 245+ clubes rivales (perfiles, mercado, inversión, crisis)
  market.ts             Mercado del jugador: scouting, negociación, ventas, renovaciones
  decisions.ts          Decisiones de planificación: doctrina, obras, sponsors, deuda, DT
  events.ts             "Momentos" con opciones y riesgo + titulares de prensa
  board.ts              Junta: objetivos por bienio, evaluación, humor de hinchada
  engine.ts             Orquestador del bucle de bienio y fases
  legacy.ts             Puntaje 0–1000, título de era, once ideal, universo control
src/state/store.ts      Zustand: acciones de UI sobre el estado del juego + autosave
src/ui/                 14 pantallas (escritorio, plantilla, mercado, táctica, estadio,
                        finanzas, comercial, junta, competencias, prensa, historia, ajustes,
                        onboarding y legado) + modal de momentos
tests/                  Vitest: unitarios + determinismo de partida completa
```

**Nota de diseño**: el árbol de estado es grande (≈250 clubes × 25 jugadores) y el dominio lo muta in-place por performance (30 temporadas completas simulan en <3 s). La inmutabilidad se garantiza donde importa: los saves son snapshots JSON, y el determinismo está cubierto por RNG con seed + test de reproducibilidad.

## Persistencia

- Autosave al final de cada fase en `localStorage` (si el entorno lo permite; si no, memoria).
- **Exportar/Importar JSON** siempre disponible en Ajustes (mecanismo confiable).
- `saveVersion` incluido para futuras migraciones.

## Determinismo

Un único `mulberry32` sembrado con la seed de la partida, con sub-streams por subsistema (partidos, lesiones, mercado, eventos, desarrollo) para que un cambio en uno no descoloque a los demás. `Math.random()` está prohibido en `src/domain/`. El estado del RNG viaja en el save. Test: `tests/determinism.test.ts`.

## Glosario de fórmulas

**Elo (§7.1)** — `E = 1/(1+10^((Elo_v − Elo_l − VL)/400))`, `K = K0·(1+0.5·|dif|)` con K0 = 20 liga / 25 copa / 30 continental; VL por liga desde el ETL; regresión 15% a la media divisional por temporada.

**Resultado (§7.2)** — Dixon-Coles bivariado: `λ_local = 1.18·exp(0.042·(atk_L − def_V) + 0.2·estiloETL + táctica ± coach)·(1+localía)`, goles ~ Poisson con corrección τ (ρ = −0.05) para 0-0/1-0/0-1/1-1. La fuerza del once es media ponderada por posición (delanteros pesan 0.45 al ataque…), con química, moral, forma y fitness. Táctica: matriz estilo-vs-estilo, techo ±8%.

**Desarrollo (§7.3)** — `Δoverall = base_edad · (1+0.10·(entrenamiento−3)) · (1+0.08·(minutos/esperados−1)) · (1+0.05·(moral−50)/50) + N(0,1.2)`, frenado al acercarse al potencial. Curva: 16–21 fuerte, 26–29 meseta, 33+ caída fuerte.

**Lesiones** — riesgo/jornada `0.028·(1+fatiga)·(1−0.12·(médico−3))·(frágil:1.5)`; 1–40 semanas; las graves pueden dejar secuela permanente.

**Valor (§7.4)** — `v = 0.0042·e^(0.115·overall) · mult_edad · (1+0.02·(pot−ov)) · mult_posición · mult_contrato · mult_forma · índice_mercado` (calibrado: 80 ≈ 42M, 85 ≈ 75M, 90 ≈ 133M). Salario ≈ `v·0.13·mult_liga·mult_prestigio`.

**Asistencia (§8)** — `demanda = 0.55 + 0.30·prestigio/100 + 0.25·(humor−50)/50 + 0.15·forma − 0.45·(precio/precio_ref − 1)`; obras reducen aforo al 80%; calidad <40 castiga.

**FFP** — pérdidas acumuladas de 3 temporadas > umbral (−30 − prestigio·0.6) → sanción escalonada: advertencia → multa → prohibición de fichar → quita de puntos. Insolvencia: caja negativa 2 temporadas → venta forzada; caja < −80M → descenso administrativo (fin de partida).

**Mundo (§7.6)** — índice de mercado +5%/año con ruido; ciclos de TV cada 3 temporadas (±10–35%); shocks: crisis global (3%/año), boom de streaming (2.5%/año).

## Supuestos documentados

- Ascensos/descensos directos sin repechaje (simplificación).
- Desempates por diferencia de gol en todas las ligas (sin head-to-head).
- Copa de la Liga, Supercopas, Mundial de Clubes y selecciones no implementados en v1 (el diseño de copas soporta agregarlos).
- El "universo control" del Legado usa una línea base estadística (ranking Elo inicial) en lugar de una segunda simulación completa.
- El once se selecciona automáticamente (mejores disponibles): el juego es de gestión estructural, no de pizarra.
