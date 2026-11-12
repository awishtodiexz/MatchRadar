import type { Match } from './types';
// Keep non-component helpers separate so component edits retain Vite Fast Refresh.
// Formatters are immutable and locale-bound for the session; rebuilding one per
// label cost ~55µs and happens dozens of times per poll.
const dayMonth = new Intl.DateTimeFormat(undefined, { weekday:'short', day:'numeric', month:'short' });
const time = new Intl.DateTimeFormat(undefined, { hour:'2-digit', minute:'2-digit' });
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
export const closedNote = (match: Match) => isAbandoned(match) ? 'This match was abandoned.' : 'This match was cancelled.';
export const matchButtonId = (id:string) => 'match-open-'+encodeURIComponent(id);
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
  return match ? [match[1], match[2]] as const : [label, ''] as const;
};
