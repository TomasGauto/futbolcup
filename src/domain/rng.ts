// RNG determinista: mulberry32 con sub-streams por subsistema.
// Prohibido Math.random() en el dominio: todo pasa por acá.

export type StreamName = 'world' | 'match' | 'injury' | 'market' | 'event' | 'dev' | 'misc';

export type RngState = Record<StreamName, number>;

const STREAMS: StreamName[] = ['world', 'match', 'injury', 'market', 'event', 'dev', 'misc'];

export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function initRngState(seed: string): RngState {
  const base = hashSeed(seed);
  const state = {} as RngState;
  STREAMS.forEach((name, i) => {
    state[name] = (base + Math.imul(i + 1, 0x9e3779b9)) >>> 0;
  });
  return state;
}

function mulberry32Step(a: number): { value: number; next: number } {
  let t = (a + 0x6d2b79f5) >>> 0;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { value, next: t };
}

/** Envoltorio mutable sobre RngState: cada stream avanza de forma independiente. */
export class Rng {
  constructor(public state: RngState) {}

  next(stream: StreamName): number {
    const { value, next } = mulberry32Step(this.state[stream]);
    this.state[stream] = next;
    return value;
  }

  int(stream: StreamName, min: number, max: number): number {
    return min + Math.floor(this.next(stream) * (max - min + 1));
  }

  pick<T>(stream: StreamName, arr: readonly T[]): T {
    return arr[Math.floor(this.next(stream) * arr.length)];
  }

  /** Normal estándar via Box-Muller. */
  normal(stream: StreamName, mean = 0, sd = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next(stream);
    while (v === 0) v = this.next(stream);
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  poisson(stream: StreamName, lambda: number): number {
    // Knuth para lambdas chicos (goles: <8 siempre)
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next(stream);
    } while (p > L);
    return k - 1;
  }

  chance(stream: StreamName, p: number): boolean {
    return this.next(stream) < p;
  }

  shuffle<T>(stream: StreamName, arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next(stream) * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
