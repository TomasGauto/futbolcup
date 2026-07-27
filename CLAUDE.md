# FutbolCup — Plataforma y reglas de diseño

## Descripción general
El repo `FutbolCup` (paquete `dinastia-fc`) contiene una webapp de fútbol offline y determinista. **La experiencia que está montada y en vivo es "Mi carrera profesional" (ex "Dinastía FC"): un simulador de CARRERA DE JUGADOR**, no de gestión de club. El jugador es un futbolista al que dirige desde la cantera hasta el retiro, tomando una decisión clave por temporada (ofertas de clubes, préstamos, mercado, selección, riesgos) y viendo cómo evoluciona su leyenda. Al colgar los botines puede empezar una **segunda vida como director técnico**.

> **Importante:** el motor de *gestión de club* (finanzas, junta, mercado, FFP) existe en `src/domain/` pero solo lo usa `QuickApp.tsx`, que **no está montado** en `main.tsx`. La app viva es `CareerApp.tsx`. Cualquier descripción de "dirigir un club" aplica a ese modo dormido, no a lo que ve el usuario hoy.

## Stack técnico
- Frontend: React 18 + TypeScript
- Bundler: Vite
- UI: Tailwind CSS (con importación directa en `src/index.css`)
- Estado: Zustand
- Gráficos: Recharts
- Tests: Vitest
- Scripts del proyecto: `tsx`

## Estructura principal
- `src/main.tsx` → punto de entrada; **monta únicamente `CareerApp`** (no importa `QuickApp`).
- `src/ui/` → vistas y componentes de interfaz
  - `CareerApp.tsx` → **la app viva**: creación del jugador, decisión por temporada, resultado de temporada, penales decisivos, trayectoria, retiro, museo y segunda vida como DT.
  - `Crest.tsx` → escudos (`Crest`), trofeos por título (`Trophy`/`TitleMark`) y premios individuales (`AwardMark`). Todo con fallback propio, nunca a emoji para copas.
  - `assets.ts` → carga el manifiesto y resuelve rutas: `crestSrc`, `trophySrcByTitlePrefix`, `awardSrc` (Balón de Oro). Aplica también el tema cromático del club.
  - `sharecard.ts` → genera la tarjeta de fin de carrera en canvas (sigue usando emojis; ver "Assets").
  - `QuickApp.tsx` → modo gestión de club, **no montado** (usa el motor de `engine.ts`).
- `src/domain/` → dominio puro y motores
  - **Modo carrera (lo vivo):** `career.ts` (motor de carrera de jugador + DT), `legacy.ts` (puntaje de leyenda), `rivalries.ts` (clásicos), más `rng.ts`, `worldgen.ts`, `playergen.ts`.
  - **Modo gestión (dormido, vía QuickApp):** `engine.ts`, `economy.ts`, `board.ts`, `decisions.ts`, `market.ts`, `valuation.ts`, `events.ts`, `quick.ts`.
  - **Compartidos:** `match.ts` (Dixon-Coles), `season.ts`, `calendar.ts`, `development.ts`, `ai.ts`, `constants.ts`, `types.ts`.
- `scripts/` → `etl.ts` (ETL a JSON estático), `validate.ts` (validación headless), `fetch-*.mjs` / `*.mjs` (fuentes y assets).
- `public/data/` → datos y assets cargados en runtime (`clubs.json`, `leagues.json`, `history.json`, `crests/`, `trophies/`, `assets-manifest.json`).

## Características clave (modo carrera)
- **Experiencia offline:** no hay llamadas externas en runtime; solo lee JSON/assets estáticos desde `public/data/`.
- **Determinismo:** cada partida parte de una seed y sub-streams RNG por subsistema; reproducible y testeable.
- **Una decisión por temporada:** el bucle central es elegir entre 2–3 opciones comparables (ofertas de club, préstamos, mercado, selección, momentos de riesgo con probabilidad declarada).
- **Fama y tiers de carta:** la fama (0–100) define el marco de la carta estilo FUT: BRONCE → PLATA → ORO → **LEYENDA**. LEYENDA exige `fama ≥ 80` **y** `≥ 5 títulos` (no se llega solo por acumular temporadas). Ver [career.ts](src/domain/career.ts) `fameFrame` y el cálculo de fama por temporada.
- **Títulos como imágenes:** las copas se renderizan con su imagen (`Trophy`/`TitleMark`), con fallback a un "pip" dorado — **nunca** emoji.
- **Premios individuales:** MVP de liga (⭐) y **Balón de Oro** (SVG propio en `public/data/trophies/award-ballon-dor.svg`, vía `AwardMark`). Se muestran en el retiro.
- **Selección nacional y penales:** convocatorias, eliminatorias/torneos, y **penales decisivos** interactivos (elegís el palo, 6 zonas).
- **Segunda vida como DT:** al retirarse, el jugador puede hacer el curso de DT y dirigir por ciclos; su nivel DT arranca desde su chapa de ex jugador.
- **Museo + tarjeta para compartir:** las carreras terminadas quedan en un museo (localStorage) y se puede generar/compartir una tarjeta-resumen.
- **Autosave + persistencia:** guarda el progreso en `localStorage`; el museo se conserva aparte.
- **Interfaz mobile-first:** el bucle de juego (carta + resumen de temporada + decisión) está diseñado para **entrar en una sola pantalla de móvil sin scroll**.

## Diseño actual de UI
- `src/index.css` contiene variables de color, tipografía y componentes globales (`.pcard`, `.fut-badge`, `.decision-grid`, etc.).
- El layout de carrera usa un contenedor centrado con ancho extendido en escritorio (`max-w-screen-xl`).
- **Compresión mobile (importante):** `PlayerCard`, el resumen de temporada y el panel de decisión reducen tamaños/paddings en móvil (badge FUT 42px, KPIs y tipografías menores, tira de "CLÁSICOS" oculta en móvil, posición mostrada como abreviatura `DC`/`MCD`/…). Objetivo: que la decisión sea visible sin scroll en pantallas de ~360–670px de alto útil.
- El flujo de decisiones y trayectoria se agrupa en `.decision-trajectory-layout`.
- `.decision-grid` (columnas por `--cols-mobile`/`--cols-wide`, seteadas por `decisionGridVars`):
  - Móvil: 1–2 opciones lado a lado; **3+ opciones se apilan en 1 columna** (para que no se aplaste el texto).
  - Desde `640px`: todas las opciones en una fila (`--cols-wide`).
- El panel `.trajectory-side` es sticky y limitado a `360px` en pantallas grandes.
- **Verificación visual:** los cambios de UI se validaron manejando el juego real con Playwright en viewport móvil (capturas + chequeo de overflow horizontal a 360/393px). Preferir ese método antes que asumir que "se ve bien".

## Datos y ETL
- El ETL consume datos históricos de fútbol real y los convierte en JSON estático para la app.
- El proyecto utiliza datos de ligas principales y reconstruye:
  - Elo histórico y ratings de ataque/defensa
  - Prestigio de club, palmarés y reputación
  - Perfil de estilo de juego y ventaja de localía
- Los datos faltantes (jugadores, finanzas, estadios) se generan procedimentalmente en función de las características del club.

## Validación y testeo
- `npm test` ejecuta pruebas unitarias con Vitest.
- `npm run validate` corre simulaciones headless de larga duración para verificar realismo y estabilidad.
- `npx tsc --noEmit` valida tipado TypeScript.
- La reproducibilidad está cubierta por `tests/determinism.test.ts`.

## Assets (escudos, trofeos, premios)
- Viven en `public/data/`: `crests/` (escudos), `trophies/` (copas de liga/continental/nacional + `award-ballon-dor.svg`). El `assets-manifest.json` mapea títulos y clubes a archivos.
- **Regla:** las copas y el Balón de Oro se muestran con imagen (SVG/PNG). Si falta el asset, el fallback es un pip dorado (trofeos) o el emoji del premio (`AwardMark`) — nunca un emoji de copa `🏆` suelto en la UI.
- **Excepción conocida:** `sharecard.ts` dibuja la tarjeta en canvas y todavía usa emojis (🌍🏆🥇⭐); convertirla a imágenes reales implica cargar y rasterizar los assets sobre el canvas (pendiente).
- Los "momentos de carrera" (timeline) usan un emoji por evento por diseño (no son visualización de copas).

## Reglas importantes de la plataforma
- El modo vivo es una **carrera de jugador** (no gestión de club): la atención está en la decisión por temporada y en construir la leyenda.
- El runtime debe ser 100% local y determinista según seed.
- La UI es móvil primero: el bucle de juego debe entrar en una sola pantalla sin scroll; mejorar progresivamente en desktop.
- Las decisiones se muestran lado a lado cuando entran; en móvil con 3+ opciones se apilan.
- El panel de trayectoria debe ser visible y compacto en desktop sin romper el layout principal.
- No se usan recursos externos en runtime; todo lo necesario debe estar en `public/data`.

## Repositorio y despliegue
- **Repo:** [github.com/TomasGauto/futbolcup](https://github.com/TomasGauto/futbolcup) (público, cuenta `TomasGauto` en `gh` CLI).
- **Hosting:** GitHub Pages, gratis, servido desde la rama `gh-pages` (`build_type: legacy`, no GitHub Actions).
- **URL en vivo:** https://tomasgauto.github.io/futbolcup/
- **Por qué no hay workflow de CI/CD:** el token de `gh` para esta cuenta no tiene el scope `workflow`, así que no se puede pushear a `.github/workflows/`. El deploy es manual pero determinista (ver pasos abajo).
- **`base` de Vite:** `vite.config.ts` define `base: process.env.GH_PAGES ? '/futbolcup/' : '/'` — así el dev local (`npm run dev`) sigue sirviendo en `/` y el build de Pages usa el subpath del repo. Todos los `fetch` a `public/data/*` ya usan `import.meta.env.BASE_URL`, por lo que no hace falta tocar código para que esto funcione.

### Cómo publicar una actualización
```bash
# 1) build de producción con el base de GitHub Pages
GH_PAGES=1 npm run build

# 2) publicar dist/ como commit único en la rama gh-pages
cd dist
git init -q
git add -A
git commit -q -m "deploy: <descripción breve>"
git branch -M gh-pages
git remote add origin https://github.com/TomasGauto/futbolcup.git
git push -f origin gh-pages
cd ..
```
GitHub Pages reconstruye automáticamente al recibir el push a `gh-pages` (usualmente <1 min). Verificar con:
```bash
gh api repos/TomasGauto/futbolcup/pages --jq '.status'   # debe decir "built"
```

### Notas sobre el token de gh CLI
- Hay 3 cuentas logueadas en `gh` en esta máquina (`ingenieriagit`, `tomasgauto-telco`, `TomasGauto`). Este repo usa **`TomasGauto`** — si `gh auth status` muestra otra cuenta activa, correr `gh auth switch --user TomasGauto` antes de operar sobre este repo.
- Si en el futuro se quiere automatizar el deploy con GitHub Actions, hay que agregar el scope `workflow` al token (`gh auth refresh -h github.com -s workflow`, requiere login interactivo del usuario) o usar la cuenta `tomasgauto-telco`, que ya tiene ese scope.

## Comandos principales
```bash
npm install
npm run etl
npm run dev
npm run build
npm test
npm run validate
```

## Dependencias clave
- `react`, `react-dom`
- `vite`, `@vitejs/plugin-react`
- `tailwindcss`, `@tailwindcss/vite`
- `zustand`
- `recharts`
- `vitest`

## Observaciones de implementación
- El dominio `src/domain/` está separado de la UI para facilitar pruebas y validación.
- El proyecto usa `TypeScript` con `module` ES y Vite para carga rápida.
- La UI actual incluye animaciones y efectos con preferencia por reducción de movimiento.
- El contenedor principal se amplió a `max-w-screen-xl` para evitar que la vista de carrera quede demasiado estrecha en PC.

## Estado actual del UI
- La pantalla de carrera muestra el player card, los resultados recientes y la sección de decisiones.
- El grid de decisiones está diseñado para mantener tarjetas una al lado de la otra en desktop.
- El panel de trayectoria está integrado como sidebar en pantallas grandes y sigue accesible en móvil.

## Consideraciones futuras
- Ampliar la vista de trayectoria con más detalle histórico.
- Añadir filtros y tabs en la interfaz de decisiones.
- Mejorar la separación visual entre decisiones y trayectoria en desktop.
