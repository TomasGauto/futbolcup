// Carga y cachea el manifiesto de assets (escudos de clubes + trofeos de liga).
// Se llena una vez al inicio (junto con el resto de los JSON de public/data) y
// los componentes leen de forma síncrona con crestSrc()/trophySrc().

interface CrestEntry {
  id: string;
  name: string;
  leagueId: string;
  division: number;
  file: string; // p.ej. "crests/ENG1-Liverpool.png"
  source: 'real' | 'generated';
  /** Color dominante del escudo, generado junto con el manifiesto. */
  primary?: string;
  secondary?: string;
}
interface TrophyEntry {
  key: string;
  kind?: 'league' | 'continental' | 'national';
  title: string; // texto exacto del título en el juego (liga, copa continental o nacional)
  leagueId?: string;
  file: string; // p.ej. "trophies/ENG1.png"
  source: string;
}
interface AssetManifest {
  crests?: CrestEntry[];
  trophies?: TrophyEntry[];
}

let base = '/';
const crestByClub = new Map<string, string>();
const colorByClub = new Map<string, { primary: string; secondary: string }>();
const trophyByLeague = new Map<string, string>();
const trophyByName = new Map<string, string>(); // nombre de liga (= título) -> archivo

/** Carga el manifiesto una sola vez. No lanza: si falla, los getters devuelven null. */
export async function loadAssetManifest(baseUrl: string): Promise<void> {
  base = baseUrl;
  try {
    const res = await fetch(`${baseUrl}data/assets-manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const man: AssetManifest = await res.json();
    crestByClub.clear();
    colorByClub.clear();
    for (const c of man.crests ?? []) {
      crestByClub.set(c.id, c.file);
      if (c.primary) colorByClub.set(c.id, { primary: c.primary, secondary: c.secondary ?? '#10151d' });
    }
    for (const t of man.trophies ?? []) {
      trophyByName.set(t.title, t.file); // todo título (liga/continental/nacional) -> imagen
      if (t.kind === 'league' && t.leagueId) trophyByLeague.set(t.leagueId, t.file);
    }
  } catch {
    // sin manifiesto: la UI cae a placeholders/emoji con gracia
  }
}

/** URL del escudo de un club, o null si no hay. */
export function crestSrc(clubId: string): string | null {
  const file = crestByClub.get(clubId);
  return file ? `${base}data/${file}` : null;
}

/** Color del club declarado por el manifiesto de assets. */
export function clubColors(clubId: string): { primary: string; secondary: string } | null {
  return colorByClub.get(clubId) ?? null;
}

function hexToRgb(hex: string): string {
  const raw = hex.replace('#', '').trim();
  const value = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = Number.parseInt(value, 16);
  if (!Number.isFinite(n)) return '212,176,98';
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function luminance(hex: string): number {
  const raw = hex.replace('#', '').trim();
  const value = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = Number.parseInt(value, 16);
  if (!Number.isFinite(n)) return 0.5;
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** Un primario negro del escudo sirve como identidad, pero no como texto sobre la UI oscura. */
function readablePrimary(colors: { primary: string; secondary: string }): string {
  if (luminance(colors.primary) >= 0.10) return colors.primary;
  if (luminance(colors.secondary) >= 0.10) return colors.secondary;
  return '#b7c4d8';
}

/** Aplica el lenguaje cromático del club actual al tema global. */
export function applyClubTheme(clubId: string | null): void {
  if (typeof document === 'undefined') return;
  const colors = clubId ? clubColors(clubId) : null;
  const primary = colors ? readablePrimary(colors) : '#d4b062';
  const secondary = colors?.secondary ?? '#10151d';
  document.documentElement.style.setProperty('--club-primary', primary);
  document.documentElement.style.setProperty('--club-secondary', secondary);
  document.documentElement.style.setProperty('--club-primary-rgb', hexToRgb(primary));
}

/** URL del trofeo de una liga por id (ENG1…), o null. */
export function trophySrc(leagueId: string): string | null {
  const file = trophyByLeague.get(leagueId);
  return file ? `${base}data/${file}` : null;
}

/** URL del trofeo a partir del texto exacto de un título (liga, copa continental o nacional). */
export function trophySrcByTitle(title: string): string | null {
  const file = trophyByName.get(title);
  return file ? `${base}data/${file}` : null;
}

/** URL del SVG de un premio individual. Solo el Balón de Oro tiene imagen; el resto usa emoji. */
export function awardSrc(award: string): string | null {
  if (award.startsWith('Balón de Oro')) return `${base}data/trophies/award-ballon-dor.svg`;
  return null;
}

/** Como trophySrcByTitle pero tolera sufijos (ej. "La Liga 2031/32"): matchea por prefijo. */
export function trophySrcByTitlePrefix(text: string): string | null {
  if (trophyByName.has(text)) return `${base}data/${trophyByName.get(text)}`;
  let best: string | null = null;
  for (const [title, file] of trophyByName) {
    if (text.startsWith(title) && (!best || title.length > best.length)) best = file;
  }
  return best ? `${base}data/${best}` : null;
}
