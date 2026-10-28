import type { Match, Settings, Snapshot } from './types';
import { clubs } from './teams';
export { clubs } from './teams';
export const defaults: Settings = { matchAlerts: {}, favorites: ['359','363','364','382','360','367'], followedOnly: false, compact: false, alwaysOnTop: true, reducedMotion: false, opacity: 96, theme: 'dark', reminders: true, reminderMinutes: 15, starts: true, goals: false, mock: false };
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
