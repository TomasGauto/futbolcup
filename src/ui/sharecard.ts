// Tarjeta compartible (PNG) del retiro: póster formato MOBILE (1080×1920 máx.).
// Arriba: nombre, tier, puntaje y el PALMARÉS completo con los trofeos dibujados.
// Abajo: la trayectoria separada en dos vidas — CARRERA COMO JUGADOR (dorado) y
// SEGUNDA VIDA COMO DT (verde) — cada etapa con sus escudos y copas.
// Si la carrera es muy larga, el contenido se escala para entrar en formato story.

import type { CareerState, Stint } from '../domain/career';
import type { CareerLegacy } from '../domain/career';
import { crestSrc, trophySrcByTitle } from './assets';

const W = 1080;
const MAX_H = 1920; // formato story / pantalla de teléfono
const GOLD = '#d4b062';
const BG = '#0b0e13';
const PANEL = '#12161f';
const LINE = '#232a38';
const TEXT = '#d8dde6';
const MUTED = '#78829a';
const GOOD = '#4ade80';
const GOOD_DIM = 'rgba(74,222,128,0.35)';
const COND = '"Bahnschrift SemiBold Condensed", "Bahnschrift", "Arial Narrow", sans-serif';

const MARGIN = 90;
const ROW_H = 56;
const TROPHY_ROW_H = 42; // sub-fila con los trofeos de la etapa
const PAL_ICON = 34; // alto de los trofeos del palmarés
const PAL_LINE_H = 52; // alto de cada línea de chips del palmarés
const PAL_LABEL_H = 40; // sub-etiqueta "COMO JUGADOR" / "COMO DT"
const CHIP_FONT = `600 27px ${COND}`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function titleEmoji(t: string): string {
  if (t.startsWith('Copa del Mundo')) return '🌍';
  if (/Champions League|Europa League|Conference League|Copa Libertadores|Copa Sudamericana|Concacaf Champions|Copa América|Eurocopa|Copa Oro|Copa Africana|Copa Asiática/.test(t)) return '🌟';
  if (t.startsWith('Copa')) return '🏅';
  if (t.startsWith('Ascenso')) return '⬆';
  return '🏆';
}

/** Nombre corto del título ("La Liga", "Copa de España", "Mundial 2034"). */
function shortTitle(t: string): string {
  if (t.startsWith('Copa del Mundo')) return t.replace('Copa del Mundo', 'Mundial');
  if (t.startsWith('Ascenso')) return 'Ascenso';
  return t;
}

/** Orden de importancia: Mundial → continental → liga → copa → ascenso. */
function titleOrder(t: string): number {
  if (t.startsWith('Copa del Mundo')) return 0;
  if (/Champions League|Europa League|Conference League|Libertadores|Sudamericana|Concacaf|Copa América|Eurocopa|Copa Oro|Copa Africana|Copa Asiática/.test(t)) return 1;
  if (t.startsWith('Ascenso')) return 4;
  if (t.startsWith('Copa')) return 3;
  return 2;
}

/** Nombres de títulos agrupados: [título, cantidad] en orden de importancia. */
function groupTitleNames(names: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const t of names) map.set(t, (map.get(t) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => titleOrder(a[0]) - titleOrder(b[0]));
}

function groupTitles(s: Stint): [string, number][] {
  return groupTitleNames(s.titles);
}

function chipLabel(title: string, count: number): string {
  return `${shortTitle(title)}${count > 1 ? ` ×${count}` : ''}`;
}

type Chip = { title: string; count: number; iconW: number; w: number };

/** Distribuye los chips (trofeo + nombre ×N) en líneas que entren en maxW. */
function layoutChips(
  ctx: CanvasRenderingContext2D,
  entries: [string, number][],
  imgs: Map<string, HTMLImageElement>,
  maxW: number,
): Chip[][] {
  ctx.font = CHIP_FONT;
  const GAP = 34;
  const lines: Chip[][] = [];
  let line: Chip[] = [];
  let x = 0;
  for (const [title, count] of entries) {
    const img = imgs.get(title);
    const iconW = img && img.width > 0 ? (img.width / img.height) * PAL_ICON || PAL_ICON : PAL_ICON;
    const w = iconW + 10 + ctx.measureText(chipLabel(title, count)).width;
    if (x + w > maxW && line.length > 0) {
      lines.push(line);
      line = [];
      x = 0;
    }
    line.push({ title, count, iconW, w });
    x += w + GAP;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function drawChipLines(
  ctx: CanvasRenderingContext2D,
  lines: Chip[][],
  imgs: Map<string, HTMLImageElement>,
  y: number,
  color: string,
): number {
  const GAP = 34;
  for (const line of lines) {
    let x = MARGIN;
    for (const chip of line) {
      const img = imgs.get(chip.title);
      if (img && img.width > 0) {
        ctx.drawImage(img, x, y, chip.iconW, PAL_ICON);
      } else {
        ctx.font = `28px ${COND}`;
        ctx.fillStyle = GOLD;
        ctx.fillText(titleEmoji(chip.title), x, y + 28);
      }
      ctx.fillStyle = color;
      ctx.font = CHIP_FONT;
      ctx.fillText(chipLabel(chip.title, chip.count), x + chip.iconW + 10, y + PAL_ICON / 2 + 10);
      x += chip.w + GAP;
    }
    y += PAL_LINE_H;
  }
  return y;
}

/** Encabezado de sección con línea divisoria; devuelve la Y del contenido. */
function sectionHeader(ctx: CanvasRenderingContext2D, label: string, top: number, color: string, right?: string): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = color;
  ctx.font = `600 26px ${COND}`;
  ctx.fillText(label, MARGIN, top);
  if (right) {
    ctx.textAlign = 'right';
    ctx.fillStyle = MUTED;
    ctx.font = `500 22px ${COND}`;
    ctx.fillText(right, W - MARGIN, top);
    ctx.textAlign = 'left';
  }
  ctx.strokeStyle = color === GOOD ? GOOD_DIM : LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MARGIN, top + 14);
  ctx.lineTo(W - MARGIN, top + 14);
  ctx.stroke();
}

/** Filas de etapas (escudo, club, años, PJ) con su sub-fila de trofeos. Devuelve la Y final. */
function drawStintRows(
  ctx: CanvasRenderingContext2D,
  stints: Stint[],
  crests: (HTMLImageElement | null)[],
  trophyImgs: Map<string, HTMLImageElement>,
  rowHeights: number[],
  startY: number,
): number {
  let y = startY;
  stints.forEach((s, i) => {
    const img = crests[i];
    if (img) ctx.drawImage(img, MARGIN, y - 30, 42, 42);
    else {
      ctx.fillStyle = LINE;
      roundRect(ctx, MARGIN, y - 30, 42, 42, 8);
      ctx.fill();
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = TEXT;
    ctx.font = `700 29px ${COND}`;
    ctx.fillText(fitText(ctx, `${s.clubName}${s.loan ? ' (prést.)' : ''}`, 460), 150, y);

    ctx.fillStyle = MUTED;
    ctx.font = `500 24px ${COND}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${s.startYear}–${s.endYear}`, 790, y);
    ctx.fillText(s.as === 'dt' ? `${s.apps} PJ dir.` : `${s.apps} PJ · ${s.goals} g`, W - MARGIN, y);
    ctx.textAlign = 'left';

    // sub-fila: LOS TROFEOS de la etapa, con su dibujito
    if (s.titles.length > 0) {
      let tx = 150;
      const ty = y + 12; // top de la sub-fila (iconos de 30px)
      for (const [title, count] of groupTitles(s)) {
        const timg = trophyImgs.get(title);
        if (timg && timg.width > 0) {
          const tw = (timg.width / timg.height) * 30 || 30;
          ctx.drawImage(timg, tx, ty, tw, 30);
          tx += tw + 6;
        } else {
          ctx.font = `24px ${COND}`;
          ctx.fillStyle = GOLD;
          ctx.fillText(titleEmoji(title), tx, ty + 24);
          tx += 34;
        }
        ctx.fillStyle = GOLD;
        ctx.font = `600 21px ${COND}`;
        const label = count > 1 ? `×${count}` : '';
        const short = fitText(ctx, shortTitle(title), 190);
        ctx.fillText(`${short}${label ? ' ' + label : ''}`, tx, ty + 22);
        tx += ctx.measureText(`${short}${label ? ' ' + label : ''}`).width + 26;
        if (tx > W - MARGIN - 120) break; // no desbordar la fila
      }
    }

    const rowH = rowHeights[i];
    if (i < stints.length - 1) {
      ctx.strokeStyle = 'rgba(35,42,56,0.6)';
      ctx.beginPath();
      ctx.moveTo(150, y + rowH - 36);
      ctx.lineTo(W - MARGIN, y + rowH - 36);
      ctx.stroke();
    }
    y += rowH;
  });
  return y;
}

export async function buildShareCard(career: CareerState, legacy: CareerLegacy): Promise<Blob | null> {
  const stints = career.stints.slice(0, 24);
  const playerStints = stints.filter((s) => s.as === 'jugador');
  const dtStints = stints.filter((s) => s.as === 'dt');
  const hasDt = dtStints.length > 0 || legacy.dtSeasons > 0;
  // el meme viral (si hubo alguno) se muestra como una píldora aparte, así no se pisa con el tier
  const viralMoment = [...career.moments].reverse().find((m) => m.icon === '🎭');
  const headerShift = viralMoment ? 46 : 0;
  const awards = career.awards ?? [];
  const awardsText = awards.map((a) => `${a.award.startsWith('Balón de Oro') ? '🥇' : '⭐'} ${a.award}`).join('   ');

  // --- cargar escudos y trofeos (SVG del manifiesto) antes de medir ---
  const loadCrests = (list: Stint[]) => Promise.all(list.map((s) => {
    const src = crestSrc(s.clubId);
    return src ? loadImage(src) : Promise.resolve(null);
  }));
  const trophyTitles = [...new Set(career.titles.map((t) => t.title))];
  const trophyImgs = new Map<string, HTMLImageElement>();
  const [playerCrests, dtCrests] = await Promise.all([
    loadCrests(playerStints),
    loadCrests(dtStints),
    Promise.all(trophyTitles.map(async (t) => {
      const src = trophySrcByTitle(t);
      if (!src) return;
      const img = await loadImage(src);
      if (img) trophyImgs.set(t, img);
    })),
  ]);

  // --- palmarés completo de la carrera, separado por vida ---
  const palJug = groupTitleNames(career.titles.filter((t) => t.as === 'jugador').map((t) => t.title));
  const palDt = groupTitleNames(career.titles.filter((t) => t.as === 'dt').map((t) => t.title));
  const palEmpty = palJug.length === 0 && palDt.length === 0;

  // --- pre-medición: altura natural del contenido ---
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  const jugChipLines = layoutChips(measure, palJug, trophyImgs, W - MARGIN * 2);
  const dtChipLines = layoutChips(measure, palDt, trophyImgs, W - MARGIN * 2);
  const labelJug = hasDt && palJug.length > 0;
  const labelDt = hasDt && palDt.length > 0;
  const palContentH = palEmpty
    ? 46
    : (labelJug ? PAL_LABEL_H : 0) + jugChipLines.length * PAL_LINE_H
      + (palDt.length > 0 && palJug.length > 0 ? 14 : 0)
      + (labelDt ? PAL_LABEL_H : 0) + dtChipLines.length * PAL_LINE_H;

  const rowHeightsOf = (list: Stint[]) => list.map((s) => ROW_H + (s.titles.length > 0 ? TROPHY_ROW_H : 0));
  const playerRowHs = rowHeightsOf(playerStints);
  const dtRowHs = rowHeightsOf(dtStints);
  const blockH = (rowHs: number[]) => 36 + rowHs.reduce((a, b) => a + b, 0);

  const palTop = 606 + headerShift; // el header (nombre + puntaje + stats) termina en 534
  const palBottom = palTop + 56 + palContentH;
  const awardsH = awards.length > 0 ? 68 : 0;
  const playerTop = palBottom + awardsH + 54;
  const playerBottom = playerTop + blockH(playerRowHs);
  const dtTop = playerBottom + 58;
  const dtBottom = dtStints.length > 0 ? dtTop + blockH(dtRowHs) : playerBottom;
  const naturalH = dtBottom + 100;

  // --- canvas en formato mobile: si el contenido es más alto, se escala para entrar ---
  const H = Math.min(MAX_H, Math.max(1350, naturalH));
  const k = naturalH > H ? H / naturalH : 1;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (k < 1) {
    ctx.translate((W - W * k) / 2, 0);
    ctx.scale(k, k);
  }

  // gradiente de atmósfera
  const grad = ctx.createRadialGradient(W * 0.2, 0, 100, W * 0.2, 0, naturalH * 0.9);
  grad.addColorStop(0, 'rgba(212,176,98,0.14)');
  grad.addColorStop(0.5, 'rgba(212,176,98,0.02)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, naturalH);

  // --- header ---
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `600 25px ${COND}`;
  ctx.fillText('DINASTÍA FC · SIMULADOR DE CARRERA', W / 2, 64);

  ctx.fillStyle = TEXT;
  ctx.font = `800 84px ${COND}`;
  ctx.fillText(fitText(ctx, career.name.toUpperCase(), W - 140), W / 2, 158);

  ctx.fillStyle = MUTED;
  ctx.font = `500 28px ${COND}`;
  const firstYear = career.seasons[0]?.year ?? 2026;
  ctx.fillText(`${career.position.toUpperCase()} · ${career.nationality.toUpperCase()} · ${firstYear}–${career.year}`, W / 2, 202);

  if (viralMoment) {
    ctx.font = `600 20px ${COND}`;
    const memeText = fitText(ctx, `🎭 ${viralMoment.text}`, W - 260);
    const tw = ctx.measureText(memeText).width;
    const boxW = tw + 40;
    const boxX = W / 2 - boxW / 2;
    const boxY = 216;
    ctx.fillStyle = 'rgba(214,157,255,0.10)';
    roundRect(ctx, boxX, boxY, boxW, 36, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(214,157,255,0.4)';
    ctx.lineWidth = 1;
    roundRect(ctx, boxX, boxY, boxW, 36, 18);
    ctx.stroke();
    ctx.fillStyle = '#d69dff';
    ctx.fillText(memeText, W / 2, boxY + 24);
  }

  ctx.fillStyle = GOLD;
  ctx.font = `800 50px ${COND}`;
  ctx.fillText(`«${legacy.tier}»`, W / 2, 272 + headerShift);

  ctx.fillStyle = PANEL;
  roundRect(ctx, W / 2 - 165, 300 + headerShift, 330, 102, 10);
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  roundRect(ctx, W / 2 - 165, 300 + headerShift, 330, 102, 10);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.font = `600 21px ${COND}`;
  ctx.fillText('PUNTAJE DE LEYENDA', W / 2, 334 + headerShift);
  ctx.fillStyle = GOLD;
  ctx.font = `800 56px ${COND}`;
  ctx.fillText(`${legacy.score} / 1000`, W / 2, 390 + headerShift);

  const stats: [string, string][] = [
    ['TEMPORADAS', String(career.seasons.length)],
    ['PARTIDOS', String(legacy.totalApps)],
    ['GOLES', String(legacy.totalGoals)],
    ['TÍTULOS', String(career.titles.length)],
  ];
  const statW = 225;
  const statGap = 12;
  const statsX = (W - statW * 4 - statGap * 3) / 2;
  const statsTop = 438 + headerShift;
  stats.forEach(([label, value], i) => {
    const x = statsX + i * (statW + statGap);
    ctx.fillStyle = PANEL;
    roundRect(ctx, x, statsTop, statW, 96, 8);
    ctx.fill();
    ctx.fillStyle = MUTED;
    ctx.font = `600 19px ${COND}`;
    ctx.fillText(label, x + statW / 2, statsTop + 32);
    ctx.fillStyle = TEXT;
    ctx.font = `800 42px ${COND}`;
    ctx.fillText(value, x + statW / 2, statsTop + 80);
  });

  // --- PALMARÉS: todas las copas de la carrera, con su dibujito ---
  sectionHeader(ctx, 'PALMARÉS', palTop, MUTED);
  let py = palTop + 40;
  if (palEmpty) {
    ctx.fillStyle = MUTED;
    ctx.font = `600 28px ${COND}`;
    ctx.fillText('Vitrinas vacías, historia llena.', MARGIN, py + 30);
  } else {
    if (labelJug) {
      ctx.fillStyle = GOLD;
      ctx.font = `700 22px ${COND}`;
      ctx.fillText('COMO JUGADOR', MARGIN, py + 24);
      py += PAL_LABEL_H;
    }
    py = drawChipLines(ctx, jugChipLines, trophyImgs, py, TEXT);
    if (palDt.length > 0 && palJug.length > 0) py += 14;
    if (labelDt) {
      ctx.fillStyle = GOOD;
      ctx.font = `700 22px ${COND}`;
      ctx.fillText('COMO DT', MARGIN, py + 24);
      py += PAL_LABEL_H;
    }
    py = drawChipLines(ctx, dtChipLines, trophyImgs, py, TEXT);
  }

  // --- PREMIOS INDIVIDUALES: MVP de liga, Balón de Oro ---
  if (awards.length > 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = MUTED;
    ctx.font = `600 20px ${COND}`;
    ctx.fillText('PREMIOS INDIVIDUALES', W / 2, palBottom + 22);
    ctx.fillStyle = GOLD;
    ctx.font = `600 26px ${COND}`;
    ctx.fillText(fitText(ctx, awardsText, W - MARGIN * 2), W / 2, palBottom + 54);
    ctx.textAlign = 'left';
  }

  // --- CARRERA COMO JUGADOR ---
  sectionHeader(ctx, hasDt ? 'CARRERA COMO JUGADOR' : 'TRAYECTORIA', playerTop, MUTED);
  drawStintRows(ctx, playerStints, playerCrests, trophyImgs, playerRowHs, playerTop + 56);

  // --- SEGUNDA VIDA: DT (sección propia, en verde) ---
  if (dtStints.length > 0) {
    sectionHeader(
      ctx,
      'SEGUNDA VIDA: DIRECTOR TÉCNICO',
      dtTop,
      GOOD,
      `${legacy.dtSeasons} temporadas · ${legacy.dtMatches} PJ · ${legacy.dtTitles} títulos`,
    );
    // barra de acento verde a la izquierda de toda la sección
    ctx.fillStyle = GOOD_DIM;
    ctx.fillRect(MARGIN - 26, dtTop + 30, 4, dtBottom - dtTop - 44);
    drawStintRows(ctx, dtStints, dtCrests, trophyImgs, dtRowHs, dtTop + 56);
  }

  // --- pie ---
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `500 25px ${COND}`;
  ctx.fillText('¿Cómo sería tu carrera? — DINASTÍA FC', W / 2, k < 1 ? naturalH - 40 : H - 44);

  ctx.restore();

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
