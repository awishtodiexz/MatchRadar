export type MatchView = 'All' | 'Live' | 'Upcoming' | 'Results';
import type { Match } from './types';
import { isInProgress } from './fixtures';
export function matchesView(matches: Match[], view: MatchView, favorites: string[], followedOnly = false) {
  return matches.filter(
    (m) =>
      (!followedOnly || favorites.includes(m.home.id) || favorites.includes(m.away.id)) &&
      (view === 'All' ||
        (view === 'Live' && isInProgress(m)) ||
        (view === 'Upcoming' && m.status === 'scheduled') ||
        (view === 'Results' && m.status === 'fulltime')),
  );
}

// History is authoritative on legacy ties; individually fresher daily scores win.
export function mergeResults(history: Match[], fixtures: Match[]): Match[] {
  const matches = new Map(history.map((match) => [match.id, match]));
  const time = (match: Match) => {
    const value = Date.parse(match.scoreUpdatedAt ?? '');
    return Number.isFinite(value) ? value : 0;
  };
  for (const match of fixtures) {
    const previous = matches.get(match.id);
    if (!previous || time(match) > time(previous)) matches.set(match.id, match);
  }
  return [...matches.values()];
}
