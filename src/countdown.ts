import { useEffect, useState } from 'react';
// Kick-off countdown helpers. Kept out of components so Vite Fast Refresh is unaffected.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SOON = 5 * MINUTE;

// Floors every unit; anything within five minutes (including past kick-offs) reads as "Starting soon".
export function countdownLabel(kickoff: string, now: Date = new Date()): string | null {
  const at = new Date(kickoff).getTime();
  if (Number.isNaN(at)) return null;
  const diff = at - now.getTime();
  if (diff <= SOON) return 'Starting soon';
  if (diff < HOUR) return `Starts in ${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    const m = Math.floor((diff % HOUR) / MINUTE);
    return m ? `Starts in ${h}h ${m}m` : `Starts in ${h}h`;
  }
  const d = Math.floor(diff / DAY);
  const h = Math.floor((diff % DAY) / HOUR);
  return h ? `Starts in ${d}d ${h}h` : `Starts in ${d}d`;
}

const zoneName = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' });
// Offsets such as "GMT+2" or "UTC+02:00" are not names a reader recognises, so they fall back to "Local".
export function timezoneLabel(date: Date = new Date()): string {
  try {
    const name = zoneName.formatToParts(date).find(p => p.type === 'timeZoneName')?.value;
    if (!name || /^(GMT|UTC)[+-]/.test(name)) return 'Local';
    return name;
  } catch {
    return 'Local';
  }
}

// Current time for display. Re-renders every intervalMs; when disabled it holds one date and starts no timer.
export function useNow(intervalMs: number, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

// One-unit countdown for the narrow score slot of a fixture row: "8d", "5h", "40m".
export function shortCountdown(kickoff: string, now: Date = new Date()): string | null {
  const at = new Date(kickoff).getTime();
  if (Number.isNaN(at)) return null;
  const diff = at - now.getTime();
  if (diff <= SOON) return 'Soon';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  return `${Math.floor(diff / DAY)}d`;
}
