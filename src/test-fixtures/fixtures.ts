import type { Match, Settings, Snapshot } from '../types';
import { clubs } from '../teams';
export { clubs } from '../teams';
export const defaults: Settings = {
  matchAlerts: {},
  favorites: ['359', '363', '364', '382', '360', '367'],
  followedOnly: false,
  compact: false,
  alwaysOnTop: true,
  startHidden: false,
  reducedMotion: false,
  opacity: 96,
  theme: 'dark',
  competitionView: 'premierLeague',
  reminders: true,
  reminderMinutes: 15,
  starts: true,
  goals: false,
};
const time = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(20, 0, 0, 0);
  return date.toISOString();
};
const pl = (m: Omit<Match, 'league'>): Match => ({ ...m, league: 'premierLeague' });
const plMatches: Array<Omit<Match, 'league'>> = [
  {
    id: 'demo-1',
    home: clubs[0],
    away: clubs[1],
    homeScore: 2,
    awayScore: 1,
    kickoff: time(-1),
    status: 'live',
    detail: '67′',
    competition: 'Premier League',
  },
  {
    id: 'demo-2',
    home: clubs[2],
    away: clubs[8],
    homeScore: 0,
    awayScore: 0,
    kickoff: time(-1),
    status: 'halftime',
    detail: 'Half-time',
    competition: 'Premier League',
  },
  {
    id: 'demo-3',
    home: clubs[3],
    away: clubs[4],
    kickoff: time(0.25),
    status: 'scheduled',
    detail: 'Scheduled',
    competition: 'Premier League',
  },
  {
    id: 'demo-4',
    home: clubs[5],
    away: clubs[7],
    kickoff: tomorrow(),
    status: 'scheduled',
    detail: 'Scheduled',
    competition: 'Premier League',
  },
  {
    id: 'demo-5',
    home: clubs[9],
    away: clubs[6],
    homeScore: 1,
    awayScore: 1,
    kickoff: time(-4),
    status: 'fulltime',
    detail: 'Full-time',
    competition: 'Premier League',
  },
  {
    id: 'demo-6',
    home: clubs[10],
    away: clubs[11],
    kickoff: time(48),
    status: 'postponed',
    detail: 'Postponed',
    competition: 'Premier League',
  },
  {
    id: 'demo-7',
    home: clubs[12],
    away: clubs[13],
    homeScore: 0,
    awayScore: 0,
    kickoff: time(-1),
    status: 'live',
    detail: "21'",
    competition: 'Premier League',
  },
  {
    id: 'demo-8',
    home: clubs[14],
    away: clubs[11],
    homeScore: 4,
    awayScore: 3,
    kickoff: time(-28),
    status: 'fulltime',
    detail: 'Full-time',
    competition: 'Premier League',
  },
  {
    id: 'demo-9',
    home: clubs[13],
    away: clubs[8],
    homeScore: 0,
    awayScore: 0,
    kickoff: time(-52),
    status: 'fulltime',
    detail: 'Full-time',
    competition: 'Premier League',
  },
  {
    id: 'demo-10',
    home: clubs[6],
    away: clubs[10],
    kickoff: time(54),
    status: 'cancelled',
    detail: 'Cancelled',
    competition: 'Premier League',
  },
  {
    id: 'demo-11',
    home: clubs[5],
    away: clubs[6],
    homeScore: 0,
    awayScore: 0,
    kickoff: time(-2),
    status: 'suspended',
    detail: 'Suspended',
    competition: 'Premier League',
  },
  {
    id: 'demo-12',
    home: clubs[11],
    away: clubs[12],
    kickoff: time(72),
    status: 'unknown',
    detail: 'Status unavailable',
    competition: 'Premier League',
  },
];
export const mockMatches: Match[] = plMatches.map(pl);
const uclTeam = { id: '86', name: 'Real Madrid', short: 'RMA' };
const uclTeam2 = { id: '133', name: 'Bayern Munich', short: 'FCB' };
export const uclMatch: Match = {
  id: 'ucl-demo-1',
  league: 'championsLeague',
  competition: 'Champions League',
  home: uclTeam,
  away: uclTeam2,
  kickoff: time(6),
  status: 'scheduled',
  detail: 'Scheduled',
};
export const uclArsenalMatch: Match = {
  id: 'ucl-demo-2',
  league: 'championsLeague',
  competition: 'Champions League',
  home: clubs[0],
  away: { id: '133', name: 'Bayern Munich', short: 'FCB' },
  kickoff: time(5),
  status: 'scheduled',
  detail: 'Scheduled',
};
export const mockSnapshot: Snapshot = { matches: mockMatches, updatedAt: new Date().toISOString(), settings: defaults };
export const mockSnapshotWithUcl: Snapshot = { ...mockSnapshot, matches: [...mockMatches, uclMatch] };
