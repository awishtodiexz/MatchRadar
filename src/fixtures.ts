import type { Match } from './types';

export const isLive = (match: Match) => match.status === 'live' || match.status === 'halftime';
// A saved kickoff can be structurally valid JSON yet unparseable (damaged disk
// write, legacy format). Keep that fixture visible under its own group instead
// of letting Intl/fixture grouping throw and blank the widget.
const dayKey = (date: Date) => Number.isNaN(date.getTime()) ? 'unknown' : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const kickoffTime = (kickoff: string) => {
  const value = Date.parse(kickoff);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};
const groupDayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

export function groupFixtures(matches: Match[], favorites: string[], now = new Date()) {
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const followed = (m: Match) => favorites.includes(m.home.id) || favorites.includes(m.away.id);
  const ordered = matches.slice().sort((a, b) =>
    Number(isLive(b)) - Number(isLive(a)) ||
    (dayKey(new Date(a.kickoff)) === dayKey(new Date(b.kickoff))
      ? Number(followed(b)) - Number(followed(a)) || kickoffTime(a.kickoff) - kickoffTime(b.kickoff)
      : kickoffTime(a.kickoff) - kickoffTime(b.kickoff)) || a.id.localeCompare(b.id));
  const groups = new Map<string, { label: string; matches: Match[] }>();
  for (const match of ordered) {
    const date = new Date(match.kickoff);
    const valid = !Number.isNaN(date.getTime());
    const key = isLive(match) ? 'live' : dayKey(date);
    const label = isLive(match) ? 'LIVE NOW'
      : !valid ? 'DATE UNAVAILABLE'
      : dayKey(date) === dayKey(now) ? 'TODAY'
      : dayKey(date) === dayKey(tomorrow) ? 'TOMORROW'
      : groupDayLabel.format(date);
    if (!groups.has(key)) groups.set(key, { label, matches: [] });
    groups.get(key)!.matches.push(match);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group,
    label:key === 'live' && group.matches.some(m=>m.scoreStale)
      ? group.matches.every(m=>m.scoreStale) ? 'SAVED LIVE SCORES' : 'LIVE NOW · SOME SAVED'
      : group.label
  }));
}
