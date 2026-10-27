import type { Match, Settings, Snapshot, Team } from './types';
export const clubs: Team[] = [
  ['359','Arsenal','ARS'],['363','Chelsea','CHE'],['364','Liverpool','LIV'],['382','Manchester City','MCI'],['360','Manchester United','MUN'],['367','Tottenham Hotspur','TOT'],['362','Everton','EVE'],['361','Aston Villa','AVL'],['331','Newcastle United','NEW'],['337','Brighton & Hove Albion','BHA'],['379','Wolverhampton Wanderers','WOL'],['371','West Ham United','WHU'],['384','Crystal Palace','CRY'],['376','Fulham','FUL'],['393','Brentford','BRE'],['349','Nottingham Forest','NFO'],['357','Leeds United','LEE'],['366','Sunderland','SUN'],['306','Burnley','BUR'],['3492','Bournemouth','BOU']
].map(([id,name,short]) => ({id,name,short}));
export const defaults: Settings = { favorites: ['359','363','364','382','360','367'], followedOnly: false, compact: false, alwaysOnTop: true, reducedMotion: false, opacity: 96, reminders: true, reminderMinutes: 15, starts: true, goals: false, mock: false };
const time = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
export const mockMatches: Match[] = [
  {id:'demo-1',home:clubs[0],away:clubs[1],homeScore:2,awayScore:1,kickoff:time(-1),status:'live',detail:"67′",competition:'Premier League'},
  {id:'demo-2',home:clubs[2],away:clubs[8],homeScore:0,awayScore:0,kickoff:time(-1),status:'halftime',detail:'Half-time',competition:'Premier League'},
  {id:'demo-3',home:clubs[3],away:clubs[4],kickoff:time(3),status:'scheduled',detail:'Scheduled',competition:'Premier League'},
  {id:'demo-4',home:clubs[5],away:clubs[7],kickoff:time(26),status:'scheduled',detail:'Scheduled',competition:'Premier League'},
  {id:'demo-5',home:clubs[9],away:clubs[6],homeScore:1,awayScore:1,kickoff:time(-4),status:'fulltime',detail:'Full-time',competition:'Premier League'},
  {id:'demo-6',home:clubs[10],away:clubs[11],kickoff:time(48),status:'postponed',detail:'Postponed',competition:'Premier League'}
];
export const mockSnapshot: Snapshot = { matches: mockMatches, updatedAt: new Date().toISOString(), settings: {...defaults, mock: true} };
