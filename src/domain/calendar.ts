// Calendario round-robin (algoritmo de Berger), ida y vuelta.

export type Fixture = { round: number; matches: { homeId: string; awayId: string }[] };

export function bergerFixtures(clubIds: string[]): Fixture[] {
  const n = clubIds.length;
  const teams = [...clubIds];
  if (n % 2 !== 0) teams.push('__bye__');
  const m = teams.length;
  const roundsFirst: Fixture[] = [];
  const rot = teams.slice(1);
  for (let r = 0; r < m - 1; r++) {
    const matches: { homeId: string; awayId: string }[] = [];
    const left = [teams[0], ...rot.slice(0, m / 2 - 1)];
    const right = rot.slice(m / 2 - 1).reverse();
    for (let i = 0; i < m / 2; i++) {
      const a = left[i];
      const b = right[i];
      if (a === '__bye__' || b === '__bye__') continue;
      // alterna localía del cabeza de serie
      if (i === 0 && r % 2 === 1) matches.push({ homeId: b, awayId: a });
      else matches.push({ homeId: a, awayId: b });
    }
    roundsFirst.push({ round: r + 1, matches });
    rot.push(rot.shift()!);
  }
  const roundsSecond: Fixture[] = roundsFirst.map((f, i) => ({
    round: roundsFirst.length + i + 1,
    matches: f.matches.map((x) => ({ homeId: x.awayId, awayId: x.homeId })),
  }));
  return [...roundsFirst, ...roundsSecond];
}
