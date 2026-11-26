import { isInProgress, isLive } from './fixtures';
import type { Match } from './types';

const KICKOFF_GRACE_MS = 30 * 60_000;

export function tickerMatches(matches: Match[], favorites: string[], now: number): Match[] {
  const followed = (match: Match) => favorites.includes(match.home.id) || favorites.includes(match.away.id);
  const priority = (match: Match) => (isInProgress(match) ? (match.scoreStale ? 2 : isLive(match) ? 0 : 1) : 3);
  return matches
    .filter(
      (match) =>
        isInProgress(match) || (match.status === 'scheduled' && Date.parse(match.kickoff) > now - KICKOFF_GRACE_MS),
    )
    .sort(
      (a, b) =>
        priority(a) - priority(b) ||
        Number(followed(b)) - Number(followed(a)) ||
        Date.parse(a.kickoff) - Date.parse(b.kickoff) ||
        a.id.localeCompare(b.id),
    );
}
