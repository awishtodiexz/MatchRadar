import type { Match } from './types';
// Keep non-component helpers separate so component edits retain Vite Fast Refresh.
// Formatters are immutable and locale-bound for the session; rebuilding one per
// label cost ~55µs and happens dozens of times per poll.
const dayMonth = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
// numeric hour: "2:30 PM" in en-US, "14:30" in 24h locales (no leading zero).
const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
// Saved state is checked for shape, not semantics. A damaged timestamp string
// must degrade to a readable label instead of throwing during render and
// blanking the whole widget with no recovery path.
const parsed = (date: string) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? null : value;
};
export const dateLabel = (date: string) => {
  const value = parsed(date);
  return value ? dayMonth.format(value) : 'Date unavailable';
};
export const timeLabel = (date: string) => {
  const value = parsed(date);
  return value ? time.format(value) : 'Time unavailable';
};
// Rust normalizes these outcomes to fixed details (provider.rs).
export const isAbandoned = (match: Match) => match.status === 'cancelled' && match.detail === 'Abandoned';
export const isForfeit = (match: Match) => match.status === 'fulltime' && match.detail === 'Forfeit';
export const resultLabel = (match: Match) => {
  if (isForfeit(match)) return 'FF';
  if (match.shootout || /\bpen(?:alties|alty|s)?\b/i.test(match.detail)) return 'PEN';
  if (/\baet\b|after extra time/i.test(match.detail)) return 'AET';
  return 'FT';
};
export const shootoutResult = (match: Match) => {
  const tally = match.shootout;
  if (match.status !== 'fulltime' || !tally || tally.home === tally.away) return null;
  const side = tally.home > tally.away ? 'home' : 'away';
  return {
    side,
    tally: `${tally.home}–${tally.away}`,
    outcome: `${match[side].name} won ${Math.max(tally.home, tally.away)}–${Math.min(tally.home, tally.away)} on penalties`,
  };
};
export const resultWinner = (match: Match) => {
  if (match.status !== 'fulltime') return null;
  if (resultLabel(match) === 'PEN') return shootoutResult(match)?.side ?? null;
  const { homeScore, awayScore } = match;
  if (homeScore == null || awayScore == null || homeScore === awayScore) return null;
  return homeScore > awayScore ? 'home' : 'away';
};
export const closedNote = (match: Match) =>
  isAbandoned(match) ? 'This match was abandoned.' : 'This match was cancelled.';
export const matchButtonId = (id: string) => 'match-open-' + encodeURIComponent(id);
// "Today"/"Tomorrow"/"Yesterday" reads faster than a date for nearby kick-offs.
export const relativeDay = (date: string, now = new Date()) => {
  const value = parsed(date);
  if (!value) return 'Date unavailable';
  const day = (d: Date) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000);
  const diff = day(value) - day(now);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : dayMonth.format(value);
};
// Split "02:30 PM" so the meridiem can be set smaller than the digits.
export const timeParts = (label: string) => {
  const match = label.match(/^(.*?)(\s*[AaPp]\.?\s?[Mm]\.?)$/);
  return match ? ([match[1], match[2]] as const) : ([label, ''] as const);
};
// "Updated 2m ago" reads faster than a wall-clock time for freshness labels.
// Older than a day falls back to the date so stale data never looks current.
export const relativeAge = (date: string, now = Date.now()) => {
  const value = parsed(date);
  if (!value) return 'time unavailable';
  const seconds = Math.max(0, Math.round((now - value.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return dayMonth.format(value);
};
// Providers write added time as "90'+7'"; football convention is "90+7'".
export const formatMinute = (minute: string) => {
  const added = /^\s*(\d+)\s*[′']?\s*\+\s*(\d+)\s*[′']?\s*$/.exec(minute);
  if (added) return `${added[1]}+${added[2]}'`;
  const plain = /^\s*(\d+)\s*[′']?\s*$/.exec(minute);
  return plain ? `${plain[1]}'` : minute;
};
