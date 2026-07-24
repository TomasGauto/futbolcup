import type { Player } from './types';

// Valor de mercado y salario (§7.4 del diseño). Todo en millones.

export function ageMult(age: number): number {
  if (age <= 18) return 1.2;
  if (age <= 21) return 1.45;
  if (age <= 24) return 1.4;
  if (age <= 26) return 1.3;
  if (age <= 28) return 1.1;
  if (age <= 30) return 0.75;
  if (age <= 32) return 0.5;
  if (age <= 34) return 0.28;
  return 0.12;
}

const POS_MULT: Record<string, number> = {
  GK: 0.8, CB: 0.95, LB: 0.9, RB: 0.9, DM: 1.0, CM: 1.05, AM: 1.15, LW: 1.15, RW: 1.15, ST: 1.2,
};

export function contractMult(yearsLeft: number): number {
  if (yearsLeft <= 0) return 0.1;
  if (yearsLeft === 1) return 0.45;
  if (yearsLeft === 2) return 0.8;
  if (yearsLeft === 3) return 1.0;
  return 1.15;
}

export function playerValue(p: Player, marketIndex: number): number {
  // Calibrado: 70 → ~13M, 80 → ~42M, 85 → ~75M, 90 → ~133M, 94 → ~210M
  const base = 0.0042 * Math.exp(0.115 * p.overall);
  const v = base
    * ageMult(p.age)
    * (1 + 0.02 * Math.max(0, p.potential - p.overall))
    * (POS_MULT[p.position] ?? 1)
    * contractMult(p.contract.yearsLeft)
    * (1 + 0.03 * p.form / 10)
    * marketIndex;
  return Math.max(0.05, Number(v.toFixed(2)));
}

export function fairWage(p: Player, leagueMult: number, prestige: number): number {
  const raw = playerValue(p, 1) * 0.13 * leagueMult * (0.8 + prestige / 250);
  return Math.max(0.08, Number(raw.toFixed(2)));
}

export function eloToOverall(elo: number, division: number): number {
  // Ancla la calidad de plantilla al Elo real: 1900 → ~84 de media, 1500 → ~72.
  // La brecha entre divisiones es moderada (-4) para que el ascendido compita.
  const base = 72 + (elo - 1500) / 33 - (division - 1) * 4;
  return Math.round(Math.max(52, Math.min(88, base)));
}

export function refreshSquadValues(players: Player[], marketIndex: number): void {
  for (const p of players) p.value = playerValue(p, marketIndex);
}
