# FutbolCup — Plataforma y reglas de diseño

## Descripción general
FutbolCup es una webapp simuladora de gestión futbolística construida como una experiencia de estrategia y decisiones a largo plazo. La plataforma está pensada para que el jugador dirija un club real durante varias temporadas, tomando decisiones de mercado, finanzas, infraestructura y prensa en lugar de jugar partidos en vivo.

## Stack técnico
- Frontend: React 18 + TypeScript
- Bundler: Vite
- UI: Tailwind CSS (con importación directa en `src/index.css`)
- Estado: Zustand
- Gráficos: Recharts
- Tests: Vitest
- Scripts del proyecto: `tsx`

## Estructura principal
- `src/main.tsx` → punto de entrada de la app React
- `src/ui/` → vistas y componentes de interfaz
  - `CareerApp.tsx` → pantalla de carrera, decisiones, trayectoria, resultados y flujo principal
  - `QuickApp.tsx` → pantalla rápida / demo
  - `Crest.tsx` → renderizado de escudos, trofeos y recursos visuales
- `src/domain/` → dominio puro y motor de simulación
  - `rng.ts` → generador de números pseudoaleatorios determinista
  - `worldgen.ts` → genera el mundo futbolístico inicial a partir de datos estáticos
  - `playergen.ts` → genera jugadores, juveniles y perfiles por nacionalidad
  - `match.ts` → motor de partido con modelo Dixon-Coles y comparativa de ataque/defensa
  - `season.ts` → ciclo de temporada, ligas, ascensos/descensos y copas
  - `economy.ts` → finanzas del club, ingresos, gastos y FFP
  - `decisions.ts` → sistema de opciones, riesgos y efectos de las decisiones de director técnico
  - `events.ts` → motor de eventos de carrera, oferta de clubs y momentos clave
  - `board.ts` → objetivos de junta, desempeño y alineación con el camino estratégico
  - `engine.ts` → orquestador del bucle de bienio/temporada
- `scripts/` → datos offline y herramientas de validación
  - `etl.ts` → ETL para descargar, procesar y traducir datos reales a JSON estático
  - `validate.ts` → validación headless de simulaciones y consistencia de datos
  - `fetch-*.mjs` → utilidades para obtener datos de origen
- `public/data/` → datos generados y estáticos cargados en runtime

## Características clave
- **Experiencia offline:** la app no hace llamadas externas en runtime; solo lee JSON estáticos desde `public/data/`.
- **Determinismo:** cada partida se basa en una seed y sub-streams RNG por subsistema, lo que permite reproducir escenarios y probar estabilidad.
- **Autosave + persistencia:** guarda automáticamente el progreso en `localStorage` y permite exportar/importar saves.
- **Interfaz mobile-first:** la UI está diseñada para funcionar bien en móvil, con mejoras progresivas para escritorio.
- **Decisiones visuales:** las opciones se presentan en tarjetas comparables, con diseño a la medida para 2 y 3 decisiones.
- **Trayectoria:** muestra el historial del club y etapas de carrera en un panel lateral en desktop.

## Diseño actual de UI
- `src/index.css` contiene variables de color, tipografía y componentes globales.
- El layout de carrera usa un contenedor principal centrado con ancho extendido en escritorio (`max-w-screen-xl`).
- El flujo de decisiones y trayectoria se agrupa en `.decision-trajectory-layout`.
- `.decision-grid` muestra cartas de opción horizontalmente en desktop:
  - 1 columna en móvil
  - 2 columnas desde `640px`
  - 3 columnas desde `920px`
- El panel `.trajectory-side` se vuelve sticky y limitado a `360px` en pantallas grandes.

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

## Reglas importantes de la plataforma
- El juego es de gestión, no de partidos: la atención está en las decisiones estructurales.
- El runtime debe ser 100% local y determinista según seed.
- La UI debe ser móvil primero y mejorar progresivamente en desktop.
- Las decisiones deben mostrarse lado a lado cuando hay más de una opción.
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
