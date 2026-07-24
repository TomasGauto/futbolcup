import { Rng } from './rng';
import type { AiProfile, Club, League, Player, Sponsor } from './types';
import { CLUB_COLOR_PAIRS, PHILOSOPHIES, SPONSOR_BRANDS, STADIUM_SUFFIX } from './constants';
import { genSquad, resetPlayerCounter } from './playergen';
import { eloToOverall } from './valuation';

// Datos crudos que emite el ETL
export type EtlClub = {
  id: string; rawName: string; name: string; country: string; leagueId: string; division: number;
  elo: number; attack: number; defense: number;
  style: { aggression: number; dominance: number; homeAdv: number };
  prestige: number; titles: number; top4: number; seasonsInTop: number;
  avgPosLast5: number | null; bestSeason: number | null; lastSeen: string;
};

export type EtlLeague = {
  id: string; name: string; country: string; teams: number; relegations: number;
  tvBase: number; homeAdvElo: number;
  continentalSlots: { elite: number; second: number; third: number };
  coeff: number; avgGoalsPerTeam: number;
  confederation?: 'UEFA' | 'CONMEBOL' | 'CONCACAF';
};

export type EtlData = { clubs: EtlClub[]; leagues: EtlLeague[]; history: Record<string, { season: string; champion: string; runnerUp: string }[]> };

export const LEAGUE_WAGE_MULT: Record<string, number> = {
  ENG1: 1.5, ESP1: 1.15, ITA1: 1.0, GER1: 1.05, FRA1: 0.85,
};

const AI_PROFILES: AiProfile[] = ['ambicioso', 'conservador', 'formador', 'mecenas', 'en crisis'];

function divisionLeagueId(baseId: string, division: number): string {
  return division === 1 ? baseId : `${baseId.slice(0, 3)}${division}`;
}

function makeStadium(rng: Rng, name: string, prestige: number, elo: number, division: number) {
  const base = division === 1
    ? 18000 + prestige * 550 + Math.max(0, elo - 1500) * 14
    : division === 2 ? 8000 + prestige * 180 : 4000 + prestige * 90;
  const capacity = Math.round((base * (0.85 + rng.next('world') * 0.3)) / 500) * 500;
  return {
    name: `${name.split(' ')[0]} ${rng.pick('world', STADIUM_SUFFIX)}`,
    capacity,
    quality: Math.min(95, Math.max(25, Math.round(prestige * 0.7 + rng.int('world', -5, 15)))),
    ticketPrice: division === 1 ? 30 + Math.round(prestige / 4) : division === 2 ? 18 : 12,
    maintenanceDebt: 0,
  };
}

function makeSponsors(rng: Rng, prestige: number, division: number): Sponsor[] {
  const scale = division === 1 ? 1 : division === 2 ? 0.18 : 0.05;
  const shirtAnnual = Number((scale * (2 + prestige * prestige * 0.006) * (0.8 + rng.next('world') * 0.4)).toFixed(1));
  return [
    { slot: 'camiseta', brand: rng.pick('world', SPONSOR_BRANDS.normal), annual: shirtAnnual, yearsLeft: rng.int('world', 1, 3), toxic: false },
    { slot: 'entrenamiento', brand: rng.pick('world', SPONSOR_BRANDS.kit), annual: Number((shirtAnnual * 0.35).toFixed(1)), yearsLeft: rng.int('world', 1, 4), toxic: false },
  ];
}

function buildClub(rng: Rng, raw: EtlClub, marketIndex: number): Club {
  const targetOverall = eloToOverall(raw.elo, raw.division);
  const leagueMult = (LEAGUE_WAGE_MULT[raw.leagueId] ?? 1) * (raw.division === 1 ? 1 : raw.division === 2 ? 0.35 : 0.15);
  const squad: Player[] = genSquad(rng, {
    country: raw.country,
    targetOverall,
    leagueMult,
    prestige: raw.prestige,
    marketIndex,
  });
  const wages = squad.reduce((a, p) => a + p.contract.wage, 0);
  const revenueGuess = wages / 0.58; // un club sano gasta ~58% en salarios
  const profile: AiProfile = raw.prestige >= 80 ? rng.pick('world', ['ambicioso', 'mecenas', 'conservador'])
    : raw.prestige <= 25 ? rng.pick('world', ['en crisis', 'conservador', 'formador'])
    : rng.pick('world', AI_PROFILES);

  const debt = rng.chance('world', 0.35)
    ? [{ label: 'Préstamo heredado', principal: Number((revenueGuess * (0.2 + rng.next('world') * 0.5)).toFixed(1)), rate: 0.06, yearsLeft: rng.int('world', 3, 8) }]
    : [];

  return {
    id: raw.id,
    name: raw.name,
    shortName: raw.name.length > 14 ? raw.name.slice(0, 13) + '…' : raw.name,
    country: raw.country,
    leagueId: divisionLeagueId(raw.leagueId, raw.division),
    division: raw.division,
    colors: (() => {
      const [primary, secondary] = rng.pick('world', CLUB_COLOR_PAIRS);
      return { primary, secondary };
    })(),
    elo: raw.elo,
    attack: raw.attack,
    defense: raw.defense,
    style: raw.style,
    prestige: raw.prestige,
    fanbase: {
      size: Math.round(raw.prestige * raw.prestige * 12 + 20000),
      loyalty: rng.int('world', 40, 85),
      expectation: Math.min(95, raw.prestige + rng.int('world', -5, 15)),
      mood: rng.int('world', 45, 70),
    },
    stadium: makeStadium(rng, raw.name, raw.prestige, raw.elo, raw.division),
    facilities: {
      academy: Math.max(1, Math.min(5, Math.round(raw.prestige / 22) + rng.int('world', 0, 1))),
      medical: Math.max(1, Math.min(5, Math.round(raw.prestige / 25) + 1)),
      training: Math.max(1, Math.min(5, Math.round(raw.prestige / 25) + 1)),
      scouting: Math.max(1, Math.min(5, Math.round(raw.prestige / 28) + 1)),
      dataDept: rng.int('world', 1, 3),
      womensTeam: raw.prestige > 60,
    },
    finances: {
      cash: Number((revenueGuess * (0.1 + rng.next('world') * 0.3)).toFixed(1)),
      wageBudget: Number((wages * 1.15).toFixed(1)),
      ffpWindow: [],
      creditRating: raw.prestige >= 75 ? 'AA' : raw.prestige >= 55 ? 'A' : raw.prestige >= 35 ? 'BBB' : 'BB',
      lastPnL: null,
      ffpSanction: 0,
    },
    squad,
    sponsors: makeSponsors(rng, raw.prestige, raw.division),
    debt,
    aiProfile: profile,
    philosophy: rng.pick('world', PHILOSOPHIES as unknown as string[]) as Club['philosophy'],
    coachQuality: Math.min(92, Math.max(45, targetOverall + rng.int('world', -6, 6))),
    identity: rng.int('world', 40, 80),
    history: [],
    amortPool: [],
    continentalCoeff: Math.max(0, (raw.elo - 1450) / 10 + raw.top4 * 2),
  };
}

/** Clubes sintéticos persistentes para completar divisiones inferiores. */
function synthClub(rng: Rng, league: EtlLeague, division: number, n: number, marketIndex: number): Club {
  const cities: Record<string, string[]> = {
    Inglaterra: ['Harrowgate', 'Duncastle', 'Westmoor', 'Ashfield', 'Kingsbrook', 'Redport'],
    España: ['Alcorán', 'Vega Alta', 'Puerto Real', 'Monteverde', 'Riazor Norte', 'Almadén'],
    Italia: ['Borgonuovo', 'Santa Rocca', 'Valdarno', 'Montefiore', 'Porto Levante', 'Castellina'],
    Alemania: ['Neustadt', 'Waldheim', 'Osterberg', 'Lindenau', 'Brückenfeld', 'Steinbach'],
    Francia: ['Villeneuve', 'Montclair', 'Beaurivage', 'Saint-Arnaud', 'Clairmont', 'Rocheville'],
  };
  const prefixes = ['CD', 'FC', 'Unión', 'Atlético', 'Real', 'Sporting', 'AS', 'SV', 'US'];
  const city = (cities[league.country] ?? cities.España)[n % 6];
  const name = `${rng.pick('world', prefixes)} ${city}`;
  const raw: EtlClub = {
    id: `${league.id}-SYN${division}${n}`,
    rawName: name, name, country: league.country, leagueId: league.id, division,
    elo: 1400 - division * 40 + rng.int('world', -30, 30),
    attack: -0.1, defense: 0.1,
    style: { aggression: rng.int('world', 30, 70), dominance: rng.int('world', 20, 50), homeAdv: 0.5 },
    prestige: Math.max(5, 22 - division * 4 + rng.int('world', -4, 6)),
    titles: 0, top4: 0, seasonsInTop: 0, avgPosLast5: null, bestSeason: null, lastSeen: '',
  };
  return buildClub(rng, raw, marketIndex);
}

export function buildWorld(etl: EtlData, rng: Rng, marketIndex: number): { clubs: Record<string, Club>; leagues: League[] } {
  resetPlayerCounter();
  const clubs: Record<string, Club> = {};
  const leagues: League[] = [];

  for (const el of etl.leagues) {
    const countryClubs = etl.clubs.filter((c) => c.leagueId === el.id);
    const byDiv: Record<number, Club[]> = { 1: [], 2: [], 3: [] };
    for (const raw of countryClubs) {
      const club = buildClub(rng, raw, marketIndex);
      clubs[club.id] = club;
      byDiv[raw.division].push(club);
    }
    // Completar divisiones inferiores a 18 equipos con clubes sintéticos persistentes
    for (const div of [2, 3]) {
      let n = 0;
      while (byDiv[div].length < 18) {
        const club = synthClub(rng, el, div, n++, marketIndex);
        clubs[club.id] = club;
        byDiv[div].push(club);
      }
    }
    for (const div of [1, 2, 3]) {
      const divId = divisionLeagueId(el.id, div);
      leagues.push({
        id: divId,
        name: div === 1 ? el.name : div === 2 ? `Segunda de ${el.country}` : `Tercera de ${el.country}`,
        country: el.country,
        division: div,
        clubIds: byDiv[div].map((c) => c.id),
        tvBase: div === 1 ? el.tvBase : div === 2 ? el.tvBase * 0.12 : el.tvBase * 0.03,
        tvCycleMult: 1,
        homeAdvElo: el.homeAdvElo,
        relegations: div === 3 ? 0 : el.relegations,
        promotions: div === 1 ? 0 : el.relegations,
        continentalSlots: div === 1 ? el.continentalSlots : { elite: 0, second: 0, third: 0 },
        coeff: div === 1 ? el.coeff : 0,
        confederation: el.confederation ?? 'UEFA',
      });
    }
  }
  return { clubs, leagues };
}
