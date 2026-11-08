// Keep non-component helpers separate so component edits retain Vite Fast Refresh.
// Formatters are immutable and locale-bound for the session; rebuilding one per
// label cost ~55µs and happens dozens of times per poll.
const dayMonth = new Intl.DateTimeFormat(undefined, { weekday:'short', day:'numeric', month:'short' });
const time = new Intl.DateTimeFormat(undefined, { hour:'2-digit', minute:'2-digit' });
export const dateLabel = (date: string) => dayMonth.format(new Date(date));
export const timeLabel = (date: string) => time.format(new Date(date));
export const matchButtonId = (id:string) => 'match-open-'+encodeURIComponent(id);
