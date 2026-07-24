import type { CareerClub } from './career';

export type RivalryInfo = {
  club: CareerClub;
  label: string;
  cityBased: boolean;
};

type RivalPair = [string, string, string];

// Alias en minúsculas y sin tildes. La lista cubre los clásicos más reconocibles
// del mundo de la carrera; los clubes sin pareja caen en una rivalidad de liga.
const CITY_RIVALRIES: Record<string, RivalPair[]> = {
  ENG1: [
    ['manchester united', 'manchester city', 'Derbi de Manchester'],
    ['liverpool', 'everton', 'Derbi de Merseyside'],
    ['arsenal', 'tottenham', 'Derbi del norte de Londres'],
  ],
  ESP1: [
    ['real madrid', 'atletico de madrid', 'Derbi de Madrid'],
    ['barcelona', 'espanyol', 'Derbi de Barcelona'],
    ['sevilla', 'real betis', 'Derbi sevillano'],
    ['athletic club', 'real sociedad', 'Derbi vasco'],
  ],
  ITA1: [
    ['inter de milan', 'ac milan', 'Derbi della Madonnina'],
    ['juventus', 'torino', 'Derbi de Turín'],
    ['as roma', 'lazio', 'Derbi de Roma'],
    ['napoli', 'salernitana', 'Derbi de Campania'],
    ['genoa', 'sampdoria', 'Derbi de Génova'],
  ],
  GER1: [
    ['borussia dortmund', 'schalke', 'Derbi del Ruhr'],
    ['bayern munich', '1860 munich', 'Derbi de Múnich'],
    ['hamburgo', 'st pauli', 'Derbi de Hamburgo'],
  ],
  FRA1: [
    ['paris saint germain', 'olympique de marsella', 'Le Classique'],
    ['olympique de lyon', 'saint etienne', 'Derbi del Ródano'],
    ['lille', 'lens', 'Derbi del norte'],
  ],
  NED1: [
    ['ajax', 'feyenoord', 'De Klassieker'],
    ['psv', 'fc twente', 'Derbi de los Países Bajos'],
  ],
  POR1: [
    ['benfica', 'sporting cp', 'Derbi de Lisboa'],
    ['fc porto', 'benfica', 'O Clássico'],
    ['sporting cp', 'fc porto', 'O Clássico'],
    ['sporting braga', 'vitoria guimaraes', 'Derbi del Miño'],
  ],
  BRA1: [
    ['flamengo', 'fluminense', 'Fla-Flu'],
    ['corinthians', 'palmeiras', 'Derbi Paulista'],
    ['gremio', 'internacional', 'Grenal'],
    ['santos', 'sao paulo', 'San-São'],
    ['atletico mg', 'cruzeiro', 'Clásico Mineiro'],
  ],
  ARG1: [
    ['boca juniors', 'river plate', 'Superclásico'],
    ['independiente', 'racing club', 'Clásico de Avellaneda'],
    ['san lorenzo', 'huracan', 'Clásico porteño'],
    ['rosario central', 'newells old boys', 'Clásico rosarino'],
    ['estudiantes lp', 'gimnasia lp', 'Clásico platense'],
  ],
  USA1: [
    ['los angeles fc', 'los angeles galaxy', 'El Tráfico'],
    ['new york city', 'new york red bulls', 'Derbi de Nueva York'],
    ['seattle sounders', 'portland timbers', 'Cascadia Cup'],
  ],
  MEX1: [
    ['club america', 'guadalajara chivas', 'Clásico Nacional'],
    ['tigres uanl', 'monterrey', 'Clásico Regiomontano'],
    ['cruz azul', 'unam pumas', 'Clásico capitalino'],
  ],
  COL1: [
    ['millonarios', 'santa fe', 'Clásico capitalino'],
    ['atletico nacional', 'independiente medellin', 'Clásico paisa'],
    ['america de cali', 'deportivo cali', 'Clásico vallecaucano'],
  ],
};

function key(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasName(club: CareerClub, alias: string): boolean {
  return key(club.name).includes(alias);
}

/** Devuelve 1–2 rivales activos en la misma liga, primero por ciudad y luego por cercanía deportiva. */
export function getClubRivals(club: CareerClub, clubs: Record<string, CareerClub>): RivalryInfo[] {
  const peers = Object.values(clubs).filter((c) => c.id !== club.id && c.leagueId === club.leagueId);
  const explicit: RivalryInfo[] = [];
  for (const [left, right, label] of CITY_RIVALRIES[club.leagueId] ?? []) {
    const alias = hasName(club, left) ? right : hasName(club, right) ? left : null;
    if (!alias) continue;
    const rival = peers.find((c) => hasName(c, alias));
    if (rival && !explicit.some((r) => r.club.id === rival.id)) explicit.push({ club: rival, label, cityBased: true });
  }

  const fallback = peers
    .filter((c) => !explicit.some((r) => r.club.id === c.id))
    .sort((a, b) => Math.abs(a.elo - club.elo) - Math.abs(b.elo - club.elo) || b.prestige - a.prestige)
    .slice(0, Math.max(0, 2 - explicit.length))
    .map((c) => ({ club: c, label: 'Rivalidad de liga', cityBased: false }));
  return [...explicit, ...fallback].slice(0, 2);
}
