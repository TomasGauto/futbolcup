// Pools de nombres y marcas para la generación procedural (determinista por seed).

export const NAME_POOLS: Record<string, { first: string[]; last: string[] }> = {
  Inglaterra: {
    first: ['Harry', 'Jack', 'Mason', 'Callum', 'Reece', 'Jordan', 'Kyle', 'Ben', 'Ollie', 'Lewis', 'Marcus', 'Jude', 'Cole', 'Declan', 'Aaron', 'Conor', 'Tyler', 'Joe', 'Sam', 'Luke', 'Jamal', 'Rio', 'Trent', 'Phil', 'Bukayo'],
    last: ['Smith', 'Walker', 'Robinson', 'Clarke', 'Wright', 'Turner', 'Hughes', 'Bennett', 'Foster', 'Palmer', 'Barnes', 'Gallagher', 'Henderson', 'Maddison', 'Bowen', 'Ferguson', 'Colwill', 'Branthwaite', 'Wharton', 'Gordon', 'Sancho', 'Grealish', 'Watkins', 'Mount', 'Saka'],
  },
  España: {
    first: ['Pablo', 'Álvaro', 'Sergio', 'Iker', 'Dani', 'Mikel', 'Unai', 'Aitor', 'Marcos', 'Nico', 'Pedri', 'Gavi', 'Bryan', 'Yeremy', 'Fermín', 'Rodri', 'Isco', 'Fabián', 'Marco', 'Álex', 'Iván', 'Raúl', 'Adrián', 'Hugo', 'Javi'],
    last: ['García', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Torres', 'Navarro', 'Moreno', 'Gil', 'Herrera', 'Merino', 'Zubimendi', 'Oyarzabal', 'Baena', 'Ruiz', 'Olmo', 'Williams', 'Cubarsí', 'Fornals', 'Canales', 'Puado', 'Riquelme', 'Guruzeta', 'Paredes', 'Valverde'],
  },
  Italia: {
    first: ['Marco', 'Alessandro', 'Federico', 'Nicolò', 'Davide', 'Lorenzo', 'Sandro', 'Matteo', 'Riccardo', 'Giacomo', 'Gianluca', 'Andrea', 'Samuele', 'Fabio', 'Pietro', 'Tommaso', 'Michael', 'Wilfried', 'Moise', 'Destiny'],
    last: ['Rossi', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Gatti', 'Locatelli', 'Barella', 'Tonali', 'Raspadori', 'Scamacca', 'Frattesi', 'Bastoni', 'Dimarco', 'Orsolini', 'Zaccagni', 'Casadei', 'Miretti', 'Fagioli'],
  },
  Alemania: {
    first: ['Leon', 'Florian', 'Jamal', 'Kai', 'Niclas', 'Jonas', 'Tim', 'Maximilian', 'Felix', 'Nico', 'Deniz', 'Karim', 'Serge', 'Julian', 'Pascal', 'Robin', 'David', 'Luca', 'Finn', 'Emre'],
    last: ['Müller', 'Schmidt', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Schäfer', 'Wirtz', 'Musiala', 'Füllkrug', 'Andrich', 'Raum', 'Schlotterbeck', 'Adeyemi', 'Gnabry', 'Stiller', 'Undav', 'Beier', 'Pavlović'],
  },
  Francia: {
    first: ['Kylian', 'Ousmane', 'Aurélien', 'Eduardo', 'Randal', 'Bradley', 'Warren', 'Rayan', 'Mathys', 'Théo', 'Lucas', 'Jules', 'Ibrahima', 'Youssouf', 'Adrien', 'Antoine', 'Moussa', 'Malo', 'Léo', 'Enzo'],
    last: ['Dubois', 'Moreau', 'Laurent', 'Girard', 'Bonnet', 'Rousseau', 'Barcola', 'Cherki', 'Zaïre-Emery', 'Camavinga', 'Tchouaméni', 'Koundé', 'Saliba', 'Konaté', 'Fofana', 'Thuram', 'Diaby', 'Coman', 'Nkunku', 'Olise'],
  },
  Argentina: {
    first: ['Julián', 'Enzo', 'Alexis', 'Thiago', 'Valentín', 'Franco', 'Nicolás', 'Lautaro', 'Exequiel', 'Facundo', 'Claudio', 'Matías', 'Santiago', 'Agustín', 'Emiliano', 'Gonzalo', 'Lucas', 'Marcos', 'Nahuel', 'Joaquín'],
    last: ['Álvarez', 'Fernández', 'Mac Allister', 'Almada', 'Carboni', 'Mastantuono', 'Paz', 'Martínez', 'Palacios', 'Buonanotte', 'Echeverri', 'Soulé', 'Garnacho', 'Barco', 'Medina', 'Montiel', 'Romero', 'Acuña', 'Molina', 'Perrone'],
  },
  Brasil: {
    first: ['Gabriel', 'Vinícius', 'Rodrygo', 'Endrick', 'Estêvão', 'Savinho', 'João', 'Matheus', 'Lucas', 'Igor', 'Murillo', 'André', 'Bruno', 'Raphael', 'Éder', 'Douglas', 'Marquinhos', 'Wesley', 'Kaio', 'Vitor'],
    last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Almeida', 'Nascimento', 'Araújo', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa', 'Cunha', 'Paquetá', 'Guimarães', 'Militão'],
  },
  Resto: {
    first: ['Victor', 'Dušan', 'Lamine', 'Khvicha', 'Viktor', 'Benjamin', 'Martin', 'Erling', 'Rasmus', 'Alejandro', 'Piotr', 'Milan', 'Luka', 'Josip', 'Takefusa', 'Kaoru', 'Mohammed', 'Achraf', 'Sofyan', 'Teun'],
    last: ['Osimhen', 'Vlahović', 'Gyökeres', 'Kvaratskhelia', 'Šeško', 'Højlund', 'Ødegaard', 'Kudus', 'Zieliński', 'Modrić', 'Gvardiol', 'Kubo', 'Mitoma', 'Salisu', 'Hakimi', 'Amrabat', 'Koopmeiners', 'Szoboszlai', 'Isak', 'Lookman'],
  },
};

// Mezcla de nacionalidades por país de la liga: [propia, resto de pools]
export const NATIONALITY_MIX: Record<string, [string, number][]> = {
  Inglaterra: [['Inglaterra', 0.45], ['Francia', 0.1], ['Brasil', 0.08], ['España', 0.07], ['Argentina', 0.06], ['Resto', 0.24]],
  España: [['España', 0.55], ['Argentina', 0.12], ['Brasil', 0.08], ['Francia', 0.06], ['Resto', 0.19]],
  Italia: [['Italia', 0.5], ['Argentina', 0.1], ['Brasil', 0.08], ['Francia', 0.06], ['Resto', 0.26]],
  Alemania: [['Alemania', 0.52], ['Francia', 0.08], ['Resto', 0.4]],
  Francia: [['Francia', 0.55], ['Brasil', 0.07], ['Argentina', 0.05], ['Resto', 0.33]],
};

export const SPONSOR_BRANDS = {
  normal: ['Aerolínea Nimbus', 'TecnoBank', 'Grupo Vantia', 'Motor Élan', 'Cerveza Faro', 'Telecom Orbis', 'Seguros Atlas', 'Energía Volta', 'Turismo Zenit', 'Alimentos Delta'],
  toxic: ['BetMaxx', 'CryptoRush', 'LoanFast', 'Apuestas Rey', 'TurboBet'],
  kit: ['Vector Sport', 'Cóndor Athletics', 'Rhein Sportwear', 'Prisma Kits', 'Aurora Teamwear'],
};

export const STADIUM_SUFFIX = ['Park', 'Arena', 'Stadium', 'Coliseo', 'Estadio'];

export const POSITIONS_TEMPLATE: { pos: string; count: number }[] = [
  { pos: 'GK', count: 3 },
  { pos: 'CB', count: 4 },
  { pos: 'LB', count: 2 },
  { pos: 'RB', count: 2 },
  { pos: 'DM', count: 2 },
  { pos: 'CM', count: 3 },
  { pos: 'AM', count: 2 },
  { pos: 'LW', count: 2 },
  { pos: 'RW', count: 2 },
  { pos: 'ST', count: 3 },
];

export const PHILOSOPHIES = ['posesión', 'presión alta', 'contragolpe', 'bloque bajo', 'juego directo'] as const;

// Matriz estilo-vs-estilo: bonus (máx ±8%) del estilo fila contra el estilo columna.
export const TACTIC_MATRIX: Record<string, Record<string, number>> = {
  'posesión': { 'posesión': 0, 'presión alta': -0.04, 'contragolpe': 0.03, 'bloque bajo': -0.05, 'juego directo': 0.04 },
  'presión alta': { 'posesión': 0.05, 'presión alta': 0, 'contragolpe': -0.06, 'bloque bajo': 0.03, 'juego directo': -0.03 },
  'contragolpe': { 'posesión': 0.06, 'presión alta': 0.04, 'contragolpe': 0, 'bloque bajo': -0.05, 'juego directo': 0.02 },
  'bloque bajo': { 'posesión': 0.04, 'presión alta': -0.03, 'contragolpe': 0.05, 'bloque bajo': 0, 'juego directo': -0.04 },
  'juego directo': { 'posesión': -0.04, 'presión alta': 0.05, 'contragolpe': -0.02, 'bloque bajo': 0.06, 'juego directo': 0 },
};

export const CLUB_COLOR_PAIRS: [string, string][] = [
  ['#c8102e', '#ffffff'], ['#034694', '#ffffff'], ['#6cabdd', '#1c2c5b'], ['#ef0107', '#023474'],
  ['#132257', '#ffffff'], ['#7a263a', '#95bfe5'], ['#fdb913', '#231f20'], ['#0057b8', '#ffcd00'],
  ['#d71920', '#fbee23'], ['#004d98', '#a50044'], ['#ffffff', '#00529f'], ['#cb3524', '#ffffff'],
  ['#fde100', '#000000'], ['#dd0741', '#000000'], ['#1d1d1b', '#00a0e4'], ['#8a1538', '#ffffff'],
  ['#009739', '#fedd00'], ['#00285e', '#f5a623'], ['#6f263d', '#ffffff'], ['#241f20', '#b3995d'],
];
