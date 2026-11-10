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
export const matchButtonId = (id:string) => 'match-open-'+encodeURIComponent(id);
