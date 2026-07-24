import { useState } from 'react';
import { crestSrc, trophySrc, trophySrcByTitlePrefix } from './assets';

interface CrestProps {
  clubId: string;
  name?: string;
  size?: number;
  className?: string;
}

/** Escudo de un club. Si no hay imagen (o falla la carga), muestra iniciales sobre el color del club. */
export function Crest({ clubId, name, size = 28, className }: CrestProps) {
  const src = crestSrc(clubId);
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    const label = initials(name ?? clubId.split('-').slice(1).join(''));
    return (
      <span
        className={className}
        aria-label={name}
        style={{
          width: size, height: size, flex: `0 0 ${size}px`,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 6, background: 'var(--line)', color: 'var(--muted)',
          fontSize: Math.round(size * 0.34), fontWeight: 700, letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
    );
  }
  return (
    <img
      src={src} alt={name ?? ''} width={size} height={size} loading="lazy"
      onError={() => setBroken(true)}
      className={className}
      style={{ width: size, height: size, flex: `0 0 ${size}px`, objectFit: 'contain' }}
    />
  );
}

interface LeagueTrophyProps {
  leagueId: string;
  title?: string;
  size?: number;
  className?: string;
}

/** Trofeo (SVG) de una liga. Devuelve null si no hay asset (el caller decide el fallback). */
export function LeagueTrophy({ leagueId, title, size = 24, className }: LeagueTrophyProps) {
  const src = trophySrc(leagueId);
  if (!src) return null;
  return (
    <img
      src={src} alt={title ?? ''} title={title} height={size} loading="lazy"
      className={className}
      style={{ height: size, width: 'auto', objectFit: 'contain' }}
    />
  );
}

interface TrophyProps {
  title: string; // texto del título (admite sufijo de temporada)
  size?: number;
  className?: string;
}

/** Trofeo por título (imagen oficial o estilizada). Fallback: pip dorado, nunca emoji. */
export function Trophy({ title, size = 20, className }: TrophyProps) {
  const src = trophySrcByTitlePrefix(title);
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className={className} title={title} aria-label={title}
        style={{ width: size, height: size, borderRadius: '50%', display: 'inline-block',
          background: 'linear-gradient(160deg,#fff3c4,#e8b23a 45%,#9a6b12)', flex: `0 0 ${size}px` }} />
    );
  }
  return (
    <img src={src} alt={title} title={title} height={size} loading="lazy"
      onError={() => setBroken(true)} className={className}
      style={{ height: size, width: 'auto', objectFit: 'contain' }} />
  );
}

function initials(raw: string): string {
  const words = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[.\-']/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}
