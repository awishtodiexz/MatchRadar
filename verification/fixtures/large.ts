import { clubs } from '../../src/teams';
import type { Match, Snapshot } from '../../src/types';

// Deterministic season-density fixture list for performance/render inspection.
// No Date.now(): callers pass the reference time so labels and windows are stable.
const uclTeams = [
  {id:'86',name:'Real Madrid',short:'RMA'},
  {id:'133',name:'Bayern Munich',short:'FCB'},
  {id:'160',name:'Paris Saint-Germain',short:'PSG'},
  {id:'124',name:'Inter Milan',short:'INT'},
  {id:'175',name:'Ajax',short:'AJX'},
  {id:'176',name:'PSV Eindhoven',short:'PSV'},
  {id:'189',name:'Benfica',short:'BEN'},
  {id:'192',name:'Porto',short:'POR'}
];

function team(index: number, champions: boolean) {
  const catalog = champions ? uclTeams : clubs;
  return catalog[index % catalog.length];
}

export function largeSnapshot(count = 240, now = new Date('2026-10-29T12:00:00Z')): Snapshot {
  const matches: Match[] = [];
  for (let index = 0; index < count; index += 1) {
    const champions = index % 2 === 1;
    const day = Math.floor(index / 8);
    const slot = index % 8;
    const kickoff = new Date(now.getTime() + day * 86400000 + (12 + (slot % 6)) * 3600000 - 2 * 86400000);
    const status: Match['status'] = slot === 0 ? 'live' : slot === 1 ? 'fulltime' : slot === 2 ? 'halftime' : 'scheduled';
    const played = status === 'fulltime' || status === 'live' || status === 'halftime';
    const home = team(Math.floor(index / 2), champions);
    const away = team(Math.floor(index / 2) + 1 + (index % 3), champions);
    matches.push({
      id: `perf-${index}`,
      league: champions ? 'championsLeague' : 'premierLeague',
      competition: champions ? 'Champions League' : 'Premier League',
      home,
      away,
      kickoff: kickoff.toISOString(),
      status,
      detail: status === 'live' ? "67'" : status === 'halftime' ? 'Half-time' : status === 'fulltime' ? 'Full-time' : 'Scheduled',
      homeScore: played ? index % 4 : null,
      awayScore: played ? (index + 1) % 3 : null,
      scoreUpdatedAt: played ? new Date(now.getTime() - 3600000).toISOString() : null
    });
  }
  return {
    matches,
    updatedAt: now.toISOString(),
    fixtureUpdatedAt: now.toISOString(),
    settings: {
      matchAlerts: {}, favorites: ['359','363','364','382'], followedOnly: false, compact: false,
      alwaysOnTop: true, startHidden: false, reducedMotion: false, opacity: 96, theme: 'dark',
      competitionView: 'both', reminders: true, reminderMinutes: 15, starts: true, goals: false
    }
  };
}
