# PROMPT MAESTRO — Webapp "Dinastía FC": manager de fútbol de 30 años, avanzando de 2 en 2

> Copiá todo lo que sigue y pegáselo a la IA que va a construir la app.

---

La idea es un juego simple, solo clicando, a modo de pagina para pasar el rato

## 0. VARIABLES DE CONFIGURACIÓN (editá esto antes de enviar)

```
IDIOMA_UI            = Español (Argentina), voseo, tono de relato deportivo
STACK                = [A] Proyecto Vite + React + TypeScript + Tailwind + Zustand
                       [B] Un solo archivo React (artifact/canvas, sin build)
                       → Elegido: A
TEMPORADA_INICIAL    = 2026/27
BIENIOS              = 15 (30 temporadas: 2026/27 → 2055/56)
LIGAS_JUGABLES       = Premier League, La Liga, Serie A, Bundesliga, Ligue 1 (+ divisiones inferiores generadas)
tambien ligas sudamericanas, portuguesa, holandesa, etc. 
DIFICULTAD_DEFECTO   = Realista (opciones: Sandbox / Realista / Leyenda)
PERSISTENCIA         = Export/Import JSON + autosave en memoria (ver §12)
ALCANCE_ENTREGA      = Implementación completa por fases (ver §15)
```

---

## 1. ROL Y OBJETIVO

Actuá como **líder técnico + diseñador de sistemas de juego + economista deportivo**. Vas a construir una webapp jugable, completa y balanceada llamada **Dinastía FC**: un simulador de dirección de club de fútbol donde el jugador elige un club real y lo dirige durante **30 temporadas, avanzando en bloques de 2 temporadas ("bienios")**.

No es un juego de partidos: es un juego de **decisiones estructurales de largo plazo**. Cada bienio el jugador toma entre 15 y 30 decisiones (fichajes, renovaciones, estadio, sponsors, cantera, deuda, técnico, precios de entradas, política institucional) y después ve cómo se resuelven dos temporadas completas de forma simulada, con tablas, copas, ascensos, descensos, títulos, crisis y titulares de prensa.

El objetivo emocional del juego: **"agarré un club de mitad de tabla en 2026 y en 2056 lo dejé como potencia europea… o lo fundí"**. Todo el diseño debe apuntar a que las decisiones se sientan pesadas, con consecuencias visibles 10 años después.

**Reglas de oro del diseño:**

1. Cada decisión debe tener un costo de oportunidad real (plata, tiempo, reputación o riesgo).
2. Nada de decisiones "obvias": si una opción siempre es la mejor, está mal balanceada.
3. Las consecuencias deben ser legibles: el jugador tiene que poder reconstruir *por qué* pasó lo que pasó.
4. El azar existe pero nunca decide solo: la varianza modula resultados, no los determina.
5. La app debe ser jugable de punta a punta en 45–90 minutos y rejugable con otro club.

---

## 2. FUENTE DE DATOS REAL

### 2.1 Repositorio base

`https://github.com/datasets/football-datasets` — datos abiertos (PDDL 1.0), actualizados a diario, derivados de football-data.co.uk.

Rutas RAW exactas (usalas para el ETL):

```
https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/premier-league/season-XXYY.csv
https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/la-liga/season-XXYY.csv
https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/serie-a/season-XXYY.csv
https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/bundesliga/season-XXYY.csv
https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/ligue-1/season-XXYY.csv
https://raw.githubusercontent.com/datasets/football-datasets/main/datasets/worldcup/...
```

`XXYY` va de `9394` hasta `2526` (ej: `season-2425.csv`, `season-2526.csv`). Hay ~33–37 temporadas por liga.

**Esquema real de cada CSV** (verificado):

```
Date, HomeTeam, AwayTeam, FTHG, FTAG, FTR, HTHG, HTAG, HTR, Referee,
HS, AS, HST, AST, HF, AF, HC, AC, HY, AY, HR, AR
```

(goles finales/entretiempo, resultado, árbitro, remates, remates al arco, faltas, córners, amarillas, rojas)

### 2.2 Lo que el dataset NO tiene (crítico — no lo inventes en runtime)

No hay jugadores, ni valores de mercado, ni salarios, ni finanzas, ni estadios, ni divisiones de ascenso. Por lo tanto:

- **Lo que se deriva de datos reales:** identidad y nombres de clubes, fuerza histórica y actual, estilo estadístico de cada club (goleador/defensivo, agresivo por faltas y tarjetas, dominador por remates y córners), ventaja de localía por liga, distribución realista de goles.
- **Lo que se genera proceduralmente pero *anclado* a esos datos:** plantillas de jugadores, edades, valores, salarios, presupuestos, estadios, hinchada, prestigio, sponsors. La generación debe ser **determinista por seed** y **coherente**: un club con Elo 1900 recibe plantilla, presupuesto y estadio de potencia; uno con Elo 1500 no.

### 2.3 Ampliaciones opcionales (implementalas como fuentes enchufables)

- **football-data.co.uk** tiene además segundas y terceras divisiones (E1/E2/E3, SP2, D2, I2, F2) y más países (Países Bajos, Portugal, Bélgica, Escocia, Turquía, Grecia). Si el ETL las encuentra, se usan como pirámide real de ascensos/descensos; si no, se generan divisiones inferiores sintéticas.
- **openfootball** (github.com/openfootball) para ligas de Sudamérica (Argentina, Brasil) si se quiere un modo "global".
- Diseñá el ETL con un `sources.config.json` para agregar ligas sin tocar el código del juego.

### 2.4 ETL obligatorio (offline, no en runtime)

Escribí un script (`scripts/etl.ts` o `scripts/etl.py`) que se corre una vez y produce archivos estáticos en `/public/data/`. **La app en runtime no debe hacer ni una sola llamada de red.**

El ETL debe:

1. Descargar todas las temporadas de cada liga configurada.
2. Normalizar nombres de clubes (mapa de alias: `Man United / Manchester United`, `Ath Madrid / Atlético de Madrid`, `Espanol / Espanyol`, `Vallecano / Rayo Vallecano`, `Nott'm Forest`, `Sociedad / Real Sociedad`, etc.). Entregá un `aliases.json` editable.
3. Calcular **Elo histórico** partido a partido desde 1993 (§7.1).
4. Calcular **ratings ataque/defensa** tipo Dixon-Coles sobre las últimas 3 temporadas, con decaimiento temporal (§7.2).
5. Calcular **perfil de estilo** por club: xG proxy desde remates al arco, agresividad (faltas + tarjetas por partido), dominio (córners y remates), localía propia.
6. Calcular **palmarés histórico** reconstruido desde las tablas de cada temporada (campeón, top-4, descensos) → alimenta el prestigio inicial.
7. Emitir:
   - `clubs.json` (un registro por club con todos los ratings derivados)
   - `leagues.json` (estructura, cupos continentales, cantidad de descensos, multiplicadores de TV)
   - `history.json` (campeones por temporada, para la sección "Historia")
   - `meta.json` (fecha del ETL, hash, versión de esquema)
8. Loguear un reporte de calidad: clubes sin alias resuelto, temporadas con partidos faltantes, outliers.

---

## 3. MODELO DE DATOS

Definí tipos TypeScript estrictos. Esquemas mínimos:

```ts
type Club = {
  id: string; name: string; shortName: string; country: string; leagueId: string;
  colors: { primary: string; secondary: string };
  elo: number;                       // derivado del ETL
  attack: number; defense: number;   // ratings Dixon-Coles
  style: { aggression: number; dominance: number; homeAdv: number };
  prestige: number;                  // 1–100, derivado de palmarés + Elo
  fanbase: { size: number; loyalty: number; expectation: number; mood: number };
  stadium: Stadium;
  facilities: Facilities;
  finances: Finances;
  squad: Player[]; staff: Staff;
  board: Board; sponsors: Sponsor[]; debt: DebtItem[];
  history: SeasonRecord[];
};

type Player = {
  id: string; name: string; nationality: string; age: number;
  position: 'GK'|'CB'|'LB'|'RB'|'DM'|'CM'|'AM'|'LW'|'RW'|'ST';
  overall: number;      // 40–95
  potential: number;    // >= overall
  traits: string[];     // 'cantera', 'líder', 'frágil', 'mercenario', 'ídolo', 'polémico'
  form: number; morale: number; fitness: number; injury?: Injury;
  contract: { yearsLeft: number; wage: number; releaseClause?: number; bonuses: Bonus[] };
  value: number; wantsToLeave: boolean; homegrown: boolean;
  seasonStats: { apps: number; goals: number; assists: number; rating: number };
  careerStats: {...};
};

type Stadium = {
  name: string; capacity: number; quality: number;   // 1–100
  namingRights?: { sponsor: string; annual: number; yearsLeft: number };
  ticketPrice: number; hospitalitySeats: number;
  maintenanceDebt: number;                            // se acumula si no invertís
  worksInProgress?: { type: string; endsInSeasons: number; capacityDelta: number };
};

type Facilities = {
  academy: 1|2|3|4|5; medical: 1|2|3|4|5; training: 1|2|3|4|5;
  scouting: 1|2|3|4|5; dataDept: 1|2|3|4|5; womensTeam: boolean; bTeam: boolean;
};

type Finances = {
  cash: number; transferBudget: number; wageBudget: number;
  revenue: RevenueBreakdown; costs: CostBreakdown;
  ppl: ProfitAndLoss[];        // por temporada
  ffpWindow: number[];         // pérdidas de las últimas 3 temporadas
  creditRating: 'AAA'|'AA'|'A'|'BBB'|'BB'|'B'|'CCC';
};

type GameState = {
  seed: string; version: string;
  clubId: string; managerProfile: Manager;
  currentBiennium: number;      // 1..15
  currentSeason: number;        // 1..30
  phase: Phase;
  world: { clubs: Record<string, Club>; leagues: League[]; marketIndex: number };
  pendingDecisions: Decision[];
  log: NarrativeEvent[];
  rng: RngState;                // ver §13
};
```

Toda mutación de estado pasa por reducers puros y auditables (`applyDecision(state, decision) → state'`).

---

## 4. FLUJO DE JUEGO

### 4.1 Onboarding

1. **Perfil de mánager:** nombre, nacionalidad, foto/avatar generado, y **trasfondo** que da modificadores iniciales:
   - *Ex jugador ídolo*: +15 relación con hinchada, −10 con la junta.
   - *Entrenador de cantera*: +2 nivel academia efectivo, −10% presupuesto.
   - *Ejecutivo financiero*: +20% ingresos comerciales, −10 reputación deportiva.
   - *Tacticista de datos*: +5% rendimiento en partido, la hinchada tarda en quererte.
   - *Recomendado por el agente*: presupuesto extra, junta impaciente (objetivos +1 nivel).
2. **Elección de club:** buscador con filtros (liga, presupuesto, prestigio, dificultad estimada 1–5 estrellas). Cada club muestra ficha con datos reales derivados: Elo, posición promedio últimas 5 temporadas, mejor y peor campaña histórica, estilo, hinchada, estadio, deuda.
3. **Contrato inicial:** duración (1, 2 o 3 bienios), objetivos de la junta, cláusula de salida, salario del mánager.

### 4.2 El bucle del bienio (se repite 15 veces)

Cada bienio tiene **6 fases**. Mostrá siempre una barra de progreso `Bienio 4/15 · Fase 2/6 · Temporada 2033/34`.

**FASE 1 — Planificación estratégica (decisiones pesadas, una vez por bienio)**

- Fijar la **doctrina del bienio**: elegí 2 de 6 ejes (Cantera / Fichajes estelares / Estadio e infraestructura / Expansión comercial / Saneamiento financiero / Proyecto deportivo a largo plazo). El eje elegido abarata un 25% las acciones de esa categoría y encarece un 15% las demás. Cambiar de doctrina cada bienio penaliza la "identidad del club".
- Obras de estadio, infraestructura, contratos de sponsors, reestructuración de deuda, política de precios, cuerpo técnico.

**FASE 2 — Mercado de pases (temporada A)**

- Ventana completa: altas, bajas, renovaciones, préstamos, promoción de juveniles, cláusulas.

**FASE 3 — Temporada A simulada**

- Se juegan las 38 (o 34) fechas + copa nacional + competición continental, **jornada a jornada, animadas y saltables**.
- Entre 4 y 7 **"momentos"** interrumpen la simulación pidiendo decisiones rápidas: crisis de vestuario, oferta millonaria por tu 9, lesión grave, escándalo, oportunidad de mercado invernal, ultimátum de la junta, presión de la hinchada.

**FASE 4 — Entretiempo del bienio**

- Balance de la temporada A, evaluación parcial de la junta, renovaciones urgentes, ajustes tácticos y de plantilla, mercado de pases de la temporada B.

**FASE 5 — Temporada B simulada**

- Igual que la Fase 3, con eventos distintos.

**FASE 6 — Cierre del bienio**

- Balance financiero de dos años (P&L, deuda, FFP), evaluación de objetivos, posible despido o renovación, envejecimiento global de todas las plantillas del mundo, inflación del mercado, evolución de clubes rivales, ascensos/descensos, resumen narrativo tipo "así se vivieron estos dos años", entrada al libro de historia del club y guardado automático.

### 4.3 Final (tras el bienio 15)

Pantalla de **Legado**: título de la era ("La Era Dorada", "Los Años del Descenso", "El Milagro Financiero"), gráfico de 30 años (posición, ingresos, valor de plantilla, prestigio), palmarés total, once ideal de la era, jugadores emblema, comparación contra un "universo control" (qué hubiera pasado sin vos: simulación del club con IA neutra desde 2026), puntaje final 0–1000 y ranking de mánagers.

---

## 5. CATÁLOGO DE DECISIONES (implementá TODAS)

### 5.1 Mercado de pases

- Fichar con transferencia, a préstamo (con o sin cargo, con opción/obligación de compra), libres, jugadores en último año con descuento, canje de jugadores.
- Negociación real: oferta inicial → contraoferta → estructura de pago (contado, en cuotas, bonus por partidos/goles/títulos, % de futura venta), competencia de otros clubes, agente que pide comisión, jugador que decide por proyecto/salario/ciudad/liga.
- Vender: escuchar ofertas, subastar, forzar salida (con costo de moral), rescindir contrato pagando.
- Cláusulas de rescisión: ponerlas altas encarece la renovación; bajas invitan ofertas.
- Ventana invernal reducida.

### 5.2 Plantilla y contratos

- Renovar (salario, duración, bonus, cláusula, rol prometido: titular indiscutido / rotación / promesa).
- Roles y jerarquía del plantel: capitán, referentes, promesas, descontentos.
- Promover juveniles, cederlos para que crezcan, integrar el equipo B.
- Política salarial: techo salarial, escala por rendimiento, primas por objetivo.
- Manejo de descontentos: charla, castigo, venta, ascenso de rol (cada uno con probabilidades).

### 5.3 Cuerpo técnico y método

- Contratar/despedir entrenador (si el jugador es Presidente/Director Deportivo) **o** dirigir vos mismo (elegí el modo en el onboarding).
- Asistentes, preparador físico, analista de datos, psicólogo, jefe de captación, médico.
- Filosofía de juego (posesión, presión alta, contragolpe, bloque bajo, juego directo) → afecta rendimiento según perfil de la plantilla, y cambiarla cuesta una temporada de adaptación.
- Módulo táctico base y plan de partido por tipo de rival.

### 5.4 Estadio e infraestructura

- Ampliar capacidad (por tramos: +5.000 / +15.000 / +30.000), con costo, deuda, y **1 o 2 temporadas de obra** que reducen aforo y recaudación.
- Estadio nuevo (proyecto de 2 bienios, gigantesco, puede hundir al club o transformarlo).
- Remodelar: palcos VIP, hospitality, techo, césped híbrido, pantallas, accesibilidad, museo y tienda.
- Mantenimiento anual: si no invertís, se acumula `maintenanceDebt` y baja la calidad, la asistencia y la seguridad (riesgo de clausura parcial).
- Ciudad deportiva, centro médico (menos lesiones y recuperaciones más cortas), centro de entrenamiento (más desarrollo), academia (más y mejores canteranos), departamento de datos (mejores scouting reports y menos "fichajes fantasma").
- Alquilar el estadio para recitales y otros eventos (ingreso extra, castiga el césped).

### 5.5 Comercial e institucional

- Sponsor principal de camiseta, manga, pantalón corto, entrenamiento, naming rights del estadio: negociación con 3–5 ofertas por ciclo, cada una con duración, monto fijo, variables por título y cláusulas (algunas tóxicas: sponsors de apuestas o de dudosa reputación dan más plata y bajan el humor de la hinchada).
- Proveedor de indumentaria (fijo alto vs. royalty por ventas).
- Precios de entradas y abonos, cantidad de socios, política de hinchada visitante, membresías internacionales.
- Giras de pretemporada (Asia/EE.UU./Medio Oriente): ingreso alto, costo en descanso y lesiones.
- Merchandising, tienda oficial, canal del club, e-sports, fútbol femenino (costo ahora, prestigio y sponsors después).
- Estructura societaria: club de socios vs. venta a inversor privado / fondo / jeque. La venta trae plata y expectativas brutales, y puede costar la identidad y parte del apoyo popular.
- Emisión de deuda: préstamo bancario, bono a 10 años, venta anticipada de derechos de TV (hipoteca el futuro).
- Relación con prensa: conferencias, defender al plantel, atacar al árbitro, hablar de mercado (cada elección mueve moral, presión y reputación).

### 5.6 Decisiones de riesgo (con probabilidad de salir mal)

- Apostar todo el presupuesto a una figura de 30 años.
- Ascender a 5 pibes de la cantera de golpe.
- Vender al ídolo por una fortuna.
- Refinanciar deuda con tasa variable.
- Contratar a un técnico brillante y conflictivo.
- Amistad/enemistad con la junta y con otros clubes (afecta futuras negociaciones).

Cada decisión debe declarar en la UI: **costo, plazo, efecto esperado, riesgo y quién se pone contento o se enoja** (junta, hinchada, plantel, prensa, sponsors).

---

## 6. COMPETICIONES

- **Liga doméstica** de la división actual, con calendario ida y vuelta generado (round-robin, algoritmo de Berger), tabla con criterios de desempate reales por país.
- **Pirámide de 3 divisiones** por país: ascensos directos + repechaje, descensos directos. Las divisiones inferiores se pueblan con clubes reales si el ETL los tiene, si no con clubes generados persistentes.
- **Copa nacional**: eliminación directa con sorteo, posibilidad de batacazo, ingreso a competición continental.
- **Copa de la Liga** (solo Inglaterra y Francia).
- **Competiciones continentales** en 3 niveles (elite / segunda / tercera) con fase de liga + eliminatorias, plazas asignadas por **coeficiente de club y de liga** que se recalcula cada temporada según resultados (esto genera dinámica de largo plazo: tu liga puede ganar o perder cupos).
- **Supercopas** y **Mundial de Clubes** cada 4 años.
- **Selecciones**: convocatorias que causan lesiones y fatiga; y un Mundial cada 4 años que sube el valor de tus internacionales.
- **Premios**: campeón, goleador, mejor jugador, mejor joven, mejor entrenador, once ideal.

---

## 7. MOTOR DE SIMULACIÓN (fórmulas concretas)

### 7.1 Elo (calculado en el ETL y actualizado en juego)

```
E_local = 1 / (1 + 10^((Elo_visita - Elo_local - VL) / 400))
K = K0 * (1 + 0.5 * |diferencia_goles| ) ,  K0 = 20 (liga), 25 (copa), 30 (continental)
Elo' = Elo + K * (S - E)          S ∈ {1, 0.5, 0}
VL = ventaja de localía por liga, calculada del ETL (típicamente 55–75 puntos)
```

Al final de cada temporada, regresión a la media del 15% hacia la media de la división (evita divergencia en 30 años).

### 7.2 Resultado de partido (Dixon-Coles bivariado)

```
λ_local   = exp( ataque_L - defensa_V + γ_localía + ajuste_táctico + forma_L + fatiga_L )
λ_visita  = exp( ataque_V - defensa_L + ajuste_táctico + forma_V + fatiga_V )
Goles ~ Poisson(λ), con corrección de baja anotación τ(x,y,λ,μ,ρ) para 0-0, 1-0, 0-1, 1-1 (ρ ≈ -0.05)
```

- `ataque` y `defensa` del club se recalculan cada jornada como **media ponderada del once titular** (peso 0.45 al ataque de delanteros/mediapuntas, 0.35 a mediocampo, etc.) más química, moral y forma.
- Ajustes tácticos: matriz estilo-vs-estilo (presión alta pierde contra contragolpe, bloque bajo neutraliza posesión, etc.), techo del ±8% para que la táctica importe sin romper el modelo.
- Generá también estadísticas de partido coherentes con el marcador (remates, posesión, tarjetas) usando los perfiles de estilo reales del ETL.
- Asigná goleadores y asistentes por probabilidad según posición, overall y minutos.

### 7.3 Jugadores: desarrollo, decadencia, lesiones

```
Curva de edad:  16–21 crecimiento fuerte, 22–25 crecimiento medio, 26–29 meseta (pico),
                30–32 caída leve, 33+ caída fuerte.
Δoverall = base_edad
         * (1 + 0.10*(nivel_entrenamiento-3))
         * (1 + 0.08*(minutos_jugados/2500 - 1))
         * (1 + 0.05*(moral-50)/50)
         * factor_potencial   // se frena al acercarse al potencial
         + ruido N(0, 1.2)
```

- Lesiones: riesgo por partido = `base(0.028) * (1 + fatiga) * (1 - 0.12*(nivel_medico-3)) * (1 + rasgo_frágil)`. Tipos con duración (1 semana a 12 meses) y riesgo de recaída y de pérdida permanente de nivel.
- Moral: función de minutos vs. rol prometido, resultados, títulos, ventas de compañeros, promesas incumplidas del mánager.
- Química de plantel: penaliza rotación masiva; los canteranos y los jugadores con muchos años en el club la suben.

### 7.4 Valor de mercado y salario

```
valor_base = f(overall) exponencial:  v = 0.045 * e^(0.115 * overall)   [millones]
valor = valor_base
      * mult_edad(age)                       // 21→1.45, 26→1.30, 30→0.75, 34→0.28
      * (1 + 0.02*(potencial - overall))
      * mult_posición(pos)                   // ST 1.20, GK 0.80
      * mult_contrato(añosRestantes)         // 1 año → 0.45, 4+ años → 1.15
      * mult_forma_y_visibilidad
      * indice_mercado_global                // inflación, ver 7.6
salario_anual ≈ valor * 0.13 * mult_liga * mult_prestigio_club
```

### 7.5 IA de los clubes rivales (fundamental para 30 años)

Cada club no jugador tiene un "cerebro" con perfil (`ambicioso`, `conservador`, `formador`, `mecenas`, `en crisis`) que:

- Ficha, vende y renueva con la misma economía que el jugador (no hace trampa, salvo en dificultad Leyenda: +8% de presupuesto).
- Invierte en estadio y cantera con probabilidad según perfil y caja.
- Puede tener un cambio de dueño, una inyección de capital, un descenso, una quiebra o una era dorada.
- Los "grandes" pueden decaer si acumulan malas decisiones: en 30 años el mapa de poder tiene que cambiar de verdad. Verificá esto en el testing: **tras 30 temporadas simuladas sin jugador, al menos 3 clubes deben haber cambiado de estrato**.

### 7.6 Mundo económico

- `indice_mercado_global` crece ~5% por temporada con ruido, y salta con nuevos ciclos de TV (cada 3 temporadas se renegocian los derechos por liga: ±10–35%).
- Shocks históricos aleatorios (probabilidad baja por bienio): crisis económica global (−20% ingresos comerciales 2 temporadas), boom de streaming, nueva superliga continental que te puede invitar (decisión moral con consecuencias fuertes), cambio de reglas de FFP, pandemia (partidos sin público).

---

## 8. MODELO ECONÓMICO (tiene que cerrar contablemente)

**Ingresos por temporada:**

- **Día de partido** = Σ por partido de `asistencia * precio_promedio + gasto_per_cápita(comida, tienda) + hospitality`
  ```
  asistencia = capacidad * min(1, demanda)
  demanda = 0.55 + 0.30*(prestigio/100) + 0.25*(humor_hinchada-50)/50 + 0.15*(forma_reciente)
          + 0.10*(atractivo_rival) - elasticidad_precio*(precio/precio_referencia - 1)
  elasticidad_precio ≈ 0.45  (subir precios 20% baja la asistencia ~9% y el humor 4 puntos)
  ```
- **Derechos de TV** = base de liga * (posición final) * (partidos televisados) * ciclo vigente.
- **Comercial** = sponsors + indumentaria + merchandising + giras + naming rights.
- **Premios por competición** (liga, copa, continental por ronda).
- **Ventas de jugadores** (con su plusvalía contable).

**Egresos:**

- Salarios de plantel y staff (el rubro más grande: apuntá a que un club sano gaste 50–65% de ingresos en salarios; >75% dispara alertas).
- Amortización de fichajes (`monto / años de contrato`), que es lo que rompe a los clubes reales.
- Mantenimiento e infraestructura, obras en curso.
- Intereses y amortización de deuda; impuestos.
- Costos operativos, cantera, giras, agentes.

**Reglas financieras:**

- **Fair play financiero**: pérdidas acumuladas de 3 temporadas > umbral → sanciones escalonadas (advertencia → multa → limitación de plantilla en competición continental → prohibición de fichar → quita de puntos).
- **Insolvencia**: caja negativa dos temporadas seguidas → venta forzada de figuras, quita de puntos, y en el peor caso descenso administrativo (final de partida "alternativo", muy memorable).
- Rating crediticio que define la tasa de interés de nuevos préstamos.
- Mostrá siempre un **P&L legible en 6 líneas** y un balance detallado desplegable.

---

## 9. JUNTA, HINCHADA Y PRESIÓN

- La junta fija por bienio: **objetivo deportivo** (posición o título), **objetivo financiero** (balance, deuda), **objetivo institucional** (estadio, cantera, marca) y un **deseo blando** (ganarle al clásico rival, mantener al ídolo).
- Medidor de **confianza de la junta** (0–100) y de **humor de la hinchada** (0–100), cada uno con historia visible en gráfico.
- Confianza <20 al cierre de una temporada → ultimátum; <10 → despido y **fin de partida** (con opción de "ofertas de otros clubes": podés seguir la carrera en otro club, y el contador de 30 años sigue corriendo — decidí si lo activás como modo "Carrera" opcional).
- La hinchada reacciona a: precios, ventas de ídolos, identidad de juego, clásicos, canteranos en cancha, sponsors polémicos, obras del estadio.
- Prensa: titulares generados proceduralmente con plantillas + variables del estado. Deben leerse como diario deportivo real, con nombres, cifras y contexto ("Tercer bienio sin Champions: la paciencia se agota en el Cid Campeador").

---

## 10. NARRATIVA Y EVENTOS

Motor de eventos con: condiciones de disparo, peso, cooldown, y consecuencias ramificadas (2–4 opciones, cada una con efectos inmediatos y diferidos hasta 2 bienios después).

Categorías obligatorias: mercado (ofertas, agentes, cláusulas activadas), vestuario (peleas, liderazgos, motines), lesiones y salud, institucional (elecciones, inversores, auditorías), estadio (obras retrasadas, incidentes, clausuras), hinchada (banderazos, protestas, homenajes), prensa y escándalos, oportunidades únicas (una joya de 17 años que aparece en la cantera, un crack venido a menos que quiere revancha), y eventos de mundo (§7.6).

Llevá un **diario del club**: cada temporada deja 5–10 líneas de crónica que se pueden releer al final. Es lo que convierte 15 bienios en una historia.

---

## 11. UI / UX

**Estructura de pantallas:**

1. Portada / Nueva partida
2. Selección de mánager y club
3. **Escritorio** (dashboard): tarjetas con caja, próxima fecha, tabla, moral, objetivos, alertas, y el "qué hacer ahora" siempre visible
4. Plantilla (tabla ordenable + ficha de jugador con gráfico de evolución)
5. Mercado (buscador con filtros, comparador, negociación paso a paso)
6. Táctica y once (drag & drop sobre la cancha)
7. Estadio e infraestructura (con vista de mejoras y obras en curso)
8. Finanzas (P&L, balance, proyección a 5 años, deuda, FFP)
9. Comercial (sponsors, precios, giras, merchandising)
10. Junta y objetivos
11. Competiciones (tablas, fixtures, resultados, palmarés, coeficientes)
12. Prensa y eventos
13. Historia / Legado (línea de tiempo de 30 años)
14. Ajustes (velocidad de simulación, guardado, seed, exportar)

Que sea simple, sin estructura persistente de datos ni sesiones, que juegues asi todo en una sesion nomas, como fast & easy play

**Requisitos de UX:**

- **Simulación visible**: la temporada avanza con animación de jornadas, tabla que se reordena, y botones `Jornada`, `Mes`, `Fin de temporada`, `Saltar todo`.
- Nunca dejar al jugador sin saber qué hacer: siempre un CTA primario claro por fase.
- Tooltips que expliquen cada número derivado ("¿por qué mi valor de plantilla bajó?").
- Panel de "**Por qué pasó esto**": para cualquier resultado importante, mostrar los 3–5 factores que más pesaron. Esto es lo que hace confiable a un simulador.
- Comparativas siempre presentes: vos vs. la liga, vs. tu propio pasado, vs. el club que eras en 2026.
- Responsive real (mobile-first para las pantallas de decisión, tablas con scroll horizontal), teclado navegable, `prefers-reduced-motion`, contraste AA.
- Gráficos con Recharts: evolución de posición, ingresos, valor de plantilla, prestigio, masa salarial.

**Dirección de arte:** estética de terminal deportiva moderna — oscura, tipografía condensada para números, acentos con los colores del club elegido, densidad de información alta pero jerarquizada. Nada de plantilla genérica con degradés violetas y tarjetas redondeadas por defecto: buscá una identidad propia (pensá en un tablero de sala de reuniones de club cruzado con Football Manager).

---

## 12. PERSISTENCIA

- **Autosave** al final de cada fase, en memoria + `IndexedDB` si el entorno lo permite.
- **Exportar/Importar partida** como archivo JSON (siempre disponible, es el mecanismo confiable).
- Si la app corre en un entorno tipo artifact/canvas donde `localStorage` y `sessionStorage` no están disponibles, **no los uses**: estado en memoria + export/import.
- Versioná el save (`saveVersion`) con migraciones.
- Modo espectador/replay: volver a ver cualquier temporada pasada.

---

## 13. DETERMINISMO Y RNG

- Un único generador `mulberry32` sembrado con `seed` de la partida; **prohibido `Math.random()` en cualquier parte del dominio**.
- Sub-streams separados por subsistema (partidos, lesiones, mercado, eventos) para que un cambio en uno no descoloque a los otros.
- Guardar el estado del RNG en el save.
- Con la misma seed y las mismas decisiones, la partida debe reproducirse **idéntica**. Incluí un test que lo verifique.

---

## 14. BALANCE Y CALIDAD (criterios de aceptación)

La entrega solo se considera terminada si se cumple todo esto:

1. Se puede jugar de 2026/27 a 2055/56 sin errores, sin `NaN`, sin valores negativos imposibles.
2. Simular 30 temporadas completas (con IA en todos los clubes) tarda **menos de 20 segundos** en una notebook común.
3. **Realismo estadístico**: en una liga simulada, el campeón promedia 78–92 puntos; promedio de goles por partido 2.5–3.0; el equipo local gana entre 42% y 48% de los partidos; el descendido promedia 20–30 puntos. Incluí un script de validación que corra 50 temporadas y reporte estas métricas.
4. **Movilidad**: en 30 temporadas simuladas sin jugador, cambian al menos 4 campeones distintos y al menos 3 clubes cambian de estrato.
5. **Economía coherente**: ningún club puede tener caja infinita; la masa salarial promedio de la liga se mantiene entre 50% y 70% de los ingresos; al menos un club de la liga entra en crisis financiera cada 10 temporadas.
6. **Sin decisiones dominantes**: documentá en un `BALANCE.md` por qué cada gran decisión tiene su contra.
7. Tests unitarios de: Elo, Poisson/Dixon-Coles, amortización, asistencia por precio, curva de edad, ascensos/descensos, determinismo.
8. Accesibilidad: navegación por teclado completa en las pantallas de decisión.
9. `README.md` con: cómo correr el ETL, cómo correr la app, arquitectura, y **glosario de todas las fórmulas**.

---

## 15. PLAN DE ENTREGA POR FASES

Entregá en este orden, y al final de cada fase mostrame qué quedó funcionando y qué falta. **No resumas ni dejes funciones con `// TODO`: cada fase se entrega andando.**

- **Fase 0 — Andamiaje:** repo, tipos, RNG determinista, estructura de carpetas, tests base.
- **Fase 1 — ETL y datos:** script completo, `clubs.json`, `leagues.json`, `history.json`, reporte de calidad, alias resueltos.
- **Fase 2 — Generación del mundo:** plantillas, finanzas, estadios, sponsors, divisiones inferiores, todo determinista desde seed.
- **Fase 3 — Motor de temporada:** calendario, simulación de partidos, tablas, copas, continental, ascensos/descensos, premios. Validación estadística.
- **Fase 4 — Economía y evolución:** finanzas completas, FFP, mercado con IA, desarrollo de jugadores, envejecimiento, 30 temporadas simuladas sin UI.
- **Fase 5 — Capa de decisiones:** todo el §5, junta, hinchada, eventos, narrativa.
- **Fase 6 — UI completa:** las 14 pantallas, animación de temporada, gráficos, responsive.
- **Fase 7 — Pulido:** balance, tooltips, "por qué pasó esto", pantalla de Legado, guardado/exportación, `README.md` y `BALANCE.md`.

---

## 16. CÓMO QUIERO QUE ME RESPONDAS

1. Arrancá con un **plan de arquitectura de máximo 40 líneas** y una lista de las 5 decisiones de diseño más riesgosas, con tu recomendación para cada una.
2. Después empezá por la Fase 0 y seguí en orden, entregando código completo y ejecutable en cada fase.
3. Si algo del pedido es ambiguo, **elegí la opción más divertida y más realista, dejá constancia del supuesto en una línea, y seguí adelante**. No frenes a preguntarme salvo que sea imprescindible.
4. Priorizá siempre: que funcione > que sea realista > que sea completo > que sea lindo. Pero apuntá a los cuatro.
5. Al final de cada fase, decime en 3 líneas qué probar para verificar que está bien.
