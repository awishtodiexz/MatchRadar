export type MatchView = 'All'|'Live'|'Following'|'Upcoming'|'Results';
import type { Match } from './types';
import { isLive } from './fixtures';
export function matchesView(matches:Match[], view:MatchView, favorites:string[]) {
  return matches.filter(m=>view==='All'||view==='Live'&&isLive(m)||view==='Following'&&(favorites.includes(m.home.id)||favorites.includes(m.away.id))||view==='Upcoming'&&m.status==='scheduled'||view==='Results'&&m.status==='fulltime');
}
