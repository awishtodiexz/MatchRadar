import type { MatchView } from './matchViews';

export function liveEmptyState({scoreError, savedLive, live, followedOnly, view}: {
  scoreError: boolean; savedLive: boolean; live: number; followedOnly: boolean; view: MatchView;
}): {title:string; message:string; canShowAll:boolean} | null {
  if (view !== 'Live') return null;
  if (savedLive) return {
    title:'Live scores awaiting confirmation',
    message:'Saved live scores may be out of date. Refresh to check for updates.',
    canShowAll:followedOnly
  };
  if (scoreError) return {
    title:'Live status unavailable',
    message:'Could not check the latest Premier League scores. Please try again.',
    canShowAll:followedOnly&&live>0
  };
  if (followedOnly && live > 0) return {
    title:'No followed clubs are live',
    message:'Live matches are hidden by your following filter.',
    canShowAll:true
  };
  return {title:'No Premier League matches are live right now',message:'Check Upcoming for the next matches.',canShowAll:false};
}
