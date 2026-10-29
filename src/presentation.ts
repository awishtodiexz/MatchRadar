// Keep non-component helpers separate so component edits retain Vite Fast Refresh.
export const dateLabel = (date: string) => new Intl.DateTimeFormat(undefined, { weekday:'short', day:'numeric', month:'short' }).format(new Date(date));
export const timeLabel = (date: string) => new Intl.DateTimeFormat(undefined, { hour:'2-digit', minute:'2-digit' }).format(new Date(date));
export const matchButtonId = (id:string) => 'match-open-'+encodeURIComponent(id);
