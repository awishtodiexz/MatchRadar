export type MatchView = 'All'|'Live'|'Following'|'Upcoming'|'Results';
import type { Match } from './types';
import { isLive } from './fixtures';
export function matchesView(matches:Match[], view:MatchView, favorites:string[]) {
  return matches.filter(m=>view==='All'||view==='Live'&&isLive(m)||view==='Following'&&(favorites.includes(m.home.id)||favorites.includes(m.away.id))||view==='Upcoming'&&m.status==='scheduled'||view==='Results'&&m.status==='fulltime');
}

// History is authoritative on legacy ties; individually fresher daily scores win.
export function mergeResults(history:Match[], fixtures:Match[]):Match[] {
  const matches = new Map(history.map(match=>[match.id,match]));
  const time = (match:Match) => { const value=Date.parse(match.scoreUpdatedAt??''); return Number.isFinite(value)?value:0; };
  for(const match of fixtures) {
    const previous=matches.get(match.id);
    if(!previous||time(match)>time(previous)) matches.set(match.id,match);
  }
  return [...matches.values()];
}
