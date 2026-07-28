# FutbolCup — Plataforma y reglas de diseño

## Descripción general
El repo `FutbolCup` (paquete `dinastia-fc`) contiene una webapp de fútbol offline y determinista. **La experiencia que está montada y en vivo es "ElGoat.online" (ex "Mi carrera profesional" / "Dinastía FC"): un simulador de CARRERA DE JUGADOR**, no de gestión de club. La marca (wordmark "ELGOAT.online" + logo de cabra `GoatMark` en `CareerApp.tsx`, favicon SVG inline en `index.html`) se muestra en el hero de creación y en el texto de la tarjeta compartible. El jugador es un futbolista al que dirige desde la cantera hasta el retiro, tomando una decisión clave por temporada (ofertas de clubes, préstamos, mercado, selección, riesgos) y viendo cómo evoluciona su leyenda. Al colgar los botines puede empezar una **segunda vida como director técnico**.

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
  - `sharecard.ts` → genera la tarjeta de fin de carrera en canvas: dibuja los **trofeos reales** (vía `trophySrcByTitlePrefix`, tolera el sufijo de año), el **Nivel de GOAT** (`drawGoatMeter`: cabra pintada hasta el %), el **PRIME** (valoración pico) y los títulos de selección por etapa. Usa DM Sans (constante `COND`) con `await document.fonts.load(...)` antes de dibujar. Solo quedan en emoji los premios individuales (🥇/⭐), el meme y las banderas.
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
- **Fama y tiers de carta:** la fama (0–100) define el marco de la carta estilo FUT: BRONCE → PLATA → ORO → **LEYENDA**. LEYENDA exige `fama ≥ 80` **y** `≥ 5 títulos` (no se llega solo por acumular temporadas). Ver [career.ts](src/domain/career.ts) `fameFrame` y el cálculo de fama por temporada. **El material del badge hexagonal (`fut-*`) sigue el marco de FAMA, no la valoración** (así el badge y el chip hablan el mismo idioma: badge bronce ↔ chip BRONCE). Ver `FRAME_TO_TIER` en `PlayerCard`.
- **Nivel de GOAT:** el puntaje de carrera (0–1000, `computeCareerLegacy` en `career.ts`) se muestra como **"Nivel de GOAT"** con una **cabra que se pinta de oro de abajo hacia arriba según el %** (`GoatMeter` en la UI / `drawGoatMeter` en la carta; `%` = `score/10`). La silueta de la cabra (`GOAT_PATHS`) es la misma del logo `GoatMark`.
- **Títulos como imágenes:** las copas se renderizan con su imagen (`Trophy`/`TitleMark`), con fallback a un "pip" dorado — **nunca** emoji.
- **Premios individuales:** MVP de liga (⭐) y **Balón de Oro** (SVG propio en `public/data/trophies/award-ballon-dor.svg`, vía `AwardMark`). Se muestran en el retiro.
- **Selección nacional y penales:** convocatorias, eliminatorias/torneos, y **penales decisivos** interactivos (elegís el palo, 6 zonas).
- **Segunda vida como DT:** al retirarse, el jugador puede hacer el curso de DT y dirigir por ciclos; su nivel DT arranca desde su chapa de ex jugador.
- **Museo + tarjeta para compartir:** las carreras terminadas quedan en un museo (localStorage) y se puede generar/compartir una tarjeta-resumen.
- **Autosave + persistencia:** guarda el progreso en `localStorage`; el museo se conserva aparte.
- **Interfaz mobile-first:** el bucle de juego (carta + resumen de temporada + decisión) está diseñado para **entrar en una sola pantalla de móvil sin scroll**.

## Diseño actual de UI
- `src/index.css` contiene variables de color, tipografía y componentes globales (`.pcard`, `.fut-badge`, `.decision-grid`, etc.).
- **Tipografías (auto-hospedadas, runtime offline):** títulos/display = **DM Sans** (`--font-cond`), cuerpo = **Manrope** (`--font-body`), números = DM Sans con `tabular-nums`. Los woff2 (fuentes variables, 1 archivo por familia+subset latin/latin-ext) viven en `src/fonts/` y se cargan vía `@import "./fonts/fonts.css"` en `index.css` — Vite los bundlea con hash y base correcta. **No se usa Google Fonts CDN.** La carta canvas (`sharecard.ts`, constante `COND`) usa DM Sans y hace `await document.fonts.load(...)` antes de dibujar (el canvas necesita la fuente lista). Para actualizar/agregar pesos, re-descargar desde la API CSS2 de Google con UA de navegador y quedarse con los subsets latin/latin-ext.
- El layout de carrera usa un contenedor centrado con ancho extendido en escritorio (`max-w-screen-xl`).
- **Compresión mobile (importante):** `PlayerCard`, el resumen de temporada y el panel de decisión reducen tamaños/paddings en móvil (badge FUT 42px, KPIs y tipografías menores, tira de "CLÁSICOS" oculta en móvil, posición mostrada como abreviatura `DC`/`MCD`/…). Objetivo: que la decisión sea visible sin scroll en pantallas de ~360–670px de alto útil.
- El flujo de decisiones y trayectoria se agrupa en `.decision-trajectory-layout`.
- `.decision-grid` (columnas por `--cols-mobile`/`--cols-wide`, seteadas por `decisionGridVars`):
  - Móvil: 1–2 opciones lado a lado; **3+ opciones se apilan en 1 columna** (para que no se aplaste el texto).
  - Desde `640px`: todas las opciones en una fila (`--cols-wide`).
- El panel `.trajectory-side` es sticky y limitado a `360px` en pantallas grandes.
- **Carta FUT premium (`PlayerCard`):** rail de identidad estilo Ultimate Team a la izquierda (badge valoración+posición, **bandera** vía `NatFlag`/`flagUrl`, escudo del club apilados). Materialidad metálica por tier en `.fut-badge` (gloss diagonal, barrido de brillo en oro/leyenda) y **foil holográfico** (`.pcard-foil`) solo en la carta LEYENDA. Todo respeta `prefers-reduced-motion`.
- **Trayectoria (`Trajectory`):** cada etapa muestra su **nota promedio** (pill `.stint-nota`, coloreada por rendimiento) y un cartel **★ PRIME** (`.stint-prime`) en la etapa de mayor nota con minutos — dorado para el jugador, verde para el DT (lógica simétrica por fase). La nota se calcula desde `career.seasons` (filtrando por `clubId` + rango de años de la etapa), así funciona en partidas ya guardadas.
- **Resultado de temporada compacto (`SeasonResult`):** una sola línea de stats (`7 PJ · 2 G · nota 4.5 · 15°`, nota y posición coloreadas), en el mismo idioma que la trayectoria — sin duplicar la etapa y dejando la decisión más arriba (mobile-first).
- **Decisiones con contexto:** las ofertas muestran el **nivel relativo** a tu club (`↑ salto` / `↓ más chico` / `≈ parejo`, en `offerOption`) y los badges comunican la **consecuencia** (`A SUMAR MINUTOS`, `SIN RIESGO`, `FICHAJE`, `ARRIESGADO`; ver `optionBadge` en `career.ts`) en vez de adjetivos vagos.
- **Banner de evento (`.flash-banner`):** el "flash" (giro de la temporada) es un banner ámbar con degradado, ícono en badge y pulso de atención — pensado para que no pase desapercibido. Respeta `prefers-reduced-motion`.
- **Accesibilidad:** el bloque `@media (prefers-reduced-motion: reduce)` fuerza `opacity: 1` en los elementos que se revelan por animación (`.reveal-item`, `.chip-in`, `.trophy-drop`) para que no queden invisibles sin animación.
- **Verificación visual:** los cambios de UI se validaron manejando el juego real con Playwright en viewport móvil (capturas + chequeo de overflow horizontal a 360/393px). Para pantallas difíciles de alcanzar (retiro/carta) se inyecta una carrera retirada sintética en `localStorage['dinastia-career-save-v2']` — **ojo:** el guard de resume saltea las retiradas (`if (resumed && !resumed.retired)`), así que para testear hay que relajarlo temporalmente y **revertirlo** después. Preferir este método antes que asumir que "se ve bien".

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
- **Carta compartible:** `sharecard.ts` **ya dibuja los trofeos reales** sobre el canvas (usa `trophySrcByTitlePrefix` para tolerar el sufijo de año, ej. `"Copa del Mundo 2038"` → copa del Mundial). Solo quedan en emoji los **premios individuales** (🥇 Balón de Oro / ⭐ MVP), el **meme** viral y las **banderas** de festejo.
- Los "momentos de carrera" (timeline) usan un emoji por evento por diseño (no son visualización de copas).

### Pipeline de assets y el manifiesto (CRÍTICO — leer antes de deployar)
`assets-manifest.json` es la **única fuente de verdad** para escudos: `crestSrc(clubId)` (en `assets.ts`) busca `clubId` en `man.crests[]`; si el id **no está**, devuelve `null` y `Crest` cae a **iniciales de texto** (no da 404, no hay error en consola). Por eso el síntoma de "escudos rotos" es texto tipo `RP`/`IND`/`SL` en vez de la imagen.

- **La bandera NO usa el manifiesto** (`flagUrl` arma la ruta directa desde `public/data/flags/`). Diagnóstico útil: si la **bandera carga pero el escudo no**, el problema es el manifiesto, no la ruta base ni el hosting.
- **Regla de oro:** el manifiesto **debe cubrir todos los clubes de `clubs.json`**. Un `clubs.json` regenerado por el ETL con un `assets-manifest.json` viejo/incompleto = **todos** los escudos de los clubes faltantes rotos. Nunca deployar con esa desincronización.
- **Regenerar el manifiesto:**
  - `node scripts/rebuild-manifest.mjs` → **offline, determinista**. Matchea `clubs.json` ↔ archivos en `public/data/crests/` por id (con fallback case-insensitive). Cubre todos los clubes que tengan archivo en disco (si falta alguno, sale con `CLUBS SIN ARCHIVO` y exit 1). **No calcula colores** de club → el theming cae al dorado por defecto.
  - `node scripts/assets.mjs` → **pipeline completo, necesita red** (TheSportsDB): descarga escudos faltantes y **calcula los colores** (`primary`/`secondary`) por club. Es el que agrega el tema cromático.
  - Los escudos generados (SVG) tienen `source: "generated"`; los reales (PNG) `source: "real"`.
  - `.etl-cache/crest-lookup.json` cachea el match id→URL (no guarda colores).
- **Bug de datos conocido:** ids que colisionan case-insensitive (ej. `ARG1-ColonSantaFe`, `GER1-MGladbach`) comparten archivo de escudo en FS case-insensitive (Windows/macOS). `rebuild-manifest.mjs` lo avisa; no es fatal.
- **Verificación del build de producción:** `vite preview` en Windows a veces da un `404 ERR_ABORTED` fantasma del bundle JS (el shell queda en blanco) aunque el archivo exista. No es un bug del build. Para verificar el `dist/` real, servirlo con un server estático plano (Node/Python) desde la raíz `/` (el `base` es `/`) y manejar el juego con Playwright, en vez de confiar en `vite preview`. Alternativa más simple ahora que hay dominio propio: verificar directo contra https://elgoat.online/ tras el deploy con los `curl -sI` de la sección de despliegue.

## Analítica de visitas (GoatCounter)
- **Registro de ingresos al sitio** vía **GoatCounter** (gratis, open-source, **sin cookies → sin banner legal**). Es el **único recurso externo en runtime** (excepción deliberada a la regla de "todo local").
- **Dashboard:** **https://elgoat.goatcounter.com** (cuenta gratis; code `elgoat`, dominio `elgoat.online`). Muestra visitas, países, páginas y referrers.
- **Cómo está integrado:** una sola línea al final del `<body>` en [index.html](index.html):
  ```html
  <script data-goatcounter="https://elgoat.goatcounter.com/count"
          async src="//gc.zgo.at/count.js"></script>
  ```
  El `count.js` se sirve desde `gc.zgo.at`. Como es una SPA de una sola vista, alcanza con el pageview automático de carga (no hace falta trackear navegación por ruta). Si un adblocker bloquea `goatcounter.com`/`gc.zgo.at`, esa visita no se cuenta (limitación esperable).
- **Nota:** si en el futuro se agrega una CSP, hay que permitir `script-src https://gc.zgo.at` y `img-src https://elgoat.goatcounter.com` (el count es un pixel a ese host).

## Reglas importantes de la plataforma
- El modo vivo es una **carrera de jugador** (no gestión de club): la atención está en la decisión por temporada y en construir la leyenda.
- El runtime debe ser 100% local y determinista según seed.
- La UI es móvil primero: el bucle de juego debe entrar en una sola pantalla sin scroll; mejorar progresivamente en desktop.
- Las decisiones se muestran lado a lado cuando entran; en móvil con 3+ opciones se apilan.
- El panel de trayectoria debe ser visible y compacto en desktop sin romper el layout principal.
- No se usan recursos externos en runtime para la **lógica de juego** (datos/assets salen de `public/data`). **Única excepción:** el script de analítica GoatCounter (ver sección "Analítica de visitas"), que no afecta el determinismo ni el juego offline.

## Repositorio y despliegue
- **Repo:** [github.com/TomasGauto/futbolcup](https://github.com/TomasGauto/futbolcup) (público, cuenta `TomasGauto` en `gh` CLI).
- **Hosting:** GitHub Pages, gratis, servido desde la rama `gh-pages` (`build_type: legacy`, no GitHub Actions).
- **URL en vivo:** **https://elgoat.online/** (dominio propio, Namecheap). El viejo `https://tomasgauto.github.io/futbolcup/` redirige al dominio propio.
- **Dominio propio (DNS en Namecheap):** 4 `A` records en el host `@` → `185.199.108.153` / `.109.153` / `.110.153` / `.111.153` (IPs de GitHub Pages) + un `CNAME` `www` → `tomasgauto.github.io.`. `www` redirige (301) al apex. HTTPS con "Enforce HTTPS" activado (cert de GitHub, `https_enforced: true`).
- **`public/CNAME`** contiene `elgoat.online` y **se copia a `dist/` en cada build** → así el dominio se re-aplica en cada push forzado a `gh-pages` (no borrar este archivo, o Pages pierde el dominio en el próximo deploy). El dominio también está seteado en la config de Pages (`gh api -X PUT repos/TomasGauto/futbolcup/pages -f cname=...`).
- **Por qué no hay workflow de CI/CD:** el token de `gh` para esta cuenta no tiene el scope `workflow`, así que no se puede pushear a `.github/workflows/`. El deploy es manual pero determinista (ver pasos abajo).
- **`base` de Vite:** ahora `vite.config.ts` usa **`base: '/'` siempre** (el dominio propio sirve desde la raíz, no desde `/futbolcup/`). La env var `GH_PAGES` quedó por compatibilidad pero ya no cambia el base. Todos los `fetch` a `public/data/*` usan `import.meta.env.BASE_URL`, así que siguen funcionando sin tocar código.

> **Directiva permanente del usuario:** **deployar SIEMPRE tras cada cambio** (sin preguntar). El flujo es build + push a `gh-pages` (abajo). El único gate previo es el chequeo de escudos del paso 0.

### Cómo publicar una actualización
```bash
# 0) CHEQUEO PRE-DEPLOY (evita el bug de "escudos rotos"):
#    el manifiesto debe cubrir todos los clubes de clubs.json.
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('public/data/clubs.json'));const m=JSON.parse(fs.readFileSync('public/data/assets-manifest.json'));const ids=new Set((m.crests||[]).map(x=>x.id));const falt=c.filter(x=>!ids.has(x.id));console.log('clubes:',c.length,'| crests:',(m.crests||[]).length,'| sin escudo:',falt.length);if(falt.length)console.log('FALTAN:',falt.slice(0,10).map(x=>x.id).join(', '));"
#    Si "sin escudo" > 0: correr `node scripts/rebuild-manifest.mjs` (offline) o `node scripts/assets.mjs` (con red, agrega colores) ANTES de buildear.

# 1) build de producción (base '/' siempre; GH_PAGES ya no cambia nada, es inofensivo)
npm run build
#    Verificar que el dominio viaje en el build: dist/CNAME debe decir "elgoat.online".
cat dist/CNAME

# 2) publicar dist/ como commit único en la rama gh-pages
#    (si dist/.git ya existe de un deploy anterior, saltear init/remote y hacer solo add+commit+push)
cd dist
git init -q                                                    # falla silenciosa si ya existe: ok
git add -A
git commit -q -m "deploy: <descripción breve>"
git branch -M gh-pages
git remote add origin https://github.com/TomasGauto/futbolcup.git   # "already exists" = ok, ignorar
git push -f origin gh-pages
cd ..
```
GitHub Pages reconstruye automáticamente al recibir el push a `gh-pages` (usualmente <1 min). Verificar con:
```bash
gh api repos/TomasGauto/futbolcup/pages --jq '.status'   # debe decir "built"
```

> **Ojo con `dist/.git`:** el `dist/` ya tiene un repo git de deploys anteriores. En re-deploys, `git init` lo reutiliza y `git remote add origin` falla con `remote origin already exists` (no es un error real). Si pasa, saltear el `git init`/`remote add` y correr directo: `cd dist && git add -A && git commit -m "deploy: ..." && git push -f origin gh-pages`.

### Dominio propio `elgoat.online` — cómo se vinculó (paso a paso)
El sitio se sirve desde el dominio propio **https://elgoat.online/** (comprado en Namecheap). Así se configuró (queda documentado por si hay que rehacerlo o debuggear):

**1) DNS en Namecheap (Advanced DNS):** dejar EXACTAMENTE estos registros (borrar los defaults de Namecheap: `CNAME www → parkingpage.namecheap.com` y el `URL Redirect @`):
| Type | Host | Value |
|------|------|-------|
| A Record | `@` | `185.199.108.153` |
| A Record | `@` | `185.199.109.153` |
| A Record | `@` | `185.199.110.153` |
| A Record | `@` | `185.199.111.153` |
| CNAME Record | `www` | `tomasgauto.github.io.` |

Los 4 IPs son los de GitHub Pages (fijos). Verificar propagación con `nslookup elgoat.online 8.8.8.8` (debe listar los 4 IPs) y `nslookup www.elgoat.online 8.8.8.8` (alias → github.io).

**2) Archivo `public/CNAME`** con una sola línea: `elgoat.online`. Vite lo copia a `dist/CNAME` en cada build, y GitHub Pages lo lee para fijar el dominio → **se re-aplica solo en cada deploy**. **No borrar este archivo** o Pages pierde el dominio en el próximo push.

**3) `base: '/'` en `vite.config.ts`** (el dominio propio sirve desde la raíz, no desde `/futbolcup/`).

**4) Setear el dominio en la config de Pages y forzar HTTPS** (una sola vez; el `CNAME` file ya lo cubre, pero esto lo deja explícito):
```bash
gh api -X PUT repos/TomasGauto/futbolcup/pages -f cname="elgoat.online"
# esperar a que status = built y que el cert quede "approved":
gh api repos/TomasGauto/futbolcup/pages --jq '{status,cname,https:.https_certificate.state,enforce:.https_enforced}'
# una vez el cert está approved, forzar HTTPS:
gh api -X PUT repos/TomasGauto/futbolcup/pages -F https_enforced=true
```

**5) Verificación en vivo:**
```bash
curl -sI https://elgoat.online/                       # 200 OK sobre HTTPS
curl -sI https://elgoat.online/assets/index-*.js      # 200 → el base '/' anda
curl -sI https://elgoat.online/data/clubs.json        # 200 → datos/escudos cargan
curl -sI https://www.elgoat.online/                   # 301 → https://elgoat.online/
```

**Diagnóstico si el dominio "se rompe" tras un deploy:** casi siempre es que faltó `public/CNAME` (o se borró) → el push forzado dejó `gh-pages` sin el archivo y Pages resetea el dominio. Solución: re-crear `public/CNAME`, rebuild, redeploy y re-setear con el `gh api ... -f cname=...` de arriba.

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
