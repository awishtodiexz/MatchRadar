import type { MatchView } from './matchViews';

export function liveEmptyState({
  checking = false,
  scoreError,
  savedLive,
  live,
  followedOnly,
  view,
  competition = 'Premier League',
  both = false,
}: {
  checking?: boolean;
  scoreError: boolean;
  savedLive: boolean;
  live: number;
  followedOnly: boolean;
  view: MatchView;
  competition?: string;
  both?: boolean;
}): { title: string; message: string; canShowAll: boolean } | null {
  if (view !== 'Live') return null;
  if (checking)
    return {
      title: both ? 'Checking live scores' : `Checking ${competition} live scores`,
      message: 'Live status will update when the first check completes.',
      canShowAll: false,
    };
  if (savedLive)
    return {
      title: 'Live scores awaiting confirmation',
      message: 'Saved live scores may be out of date. Refresh to check for updates.',
      canShowAll: followedOnly,
    };
  if (scoreError)
    return {
      title: 'Live status unavailable',
      message: `Could not check the latest ${competition} scores. Please try again.`,
      canShowAll: followedOnly && live > 0,
    };
  if (followedOnly && live > 0)
    return {
      title: 'No followed clubs are live',
      message: 'Live matches are hidden by your following filter.',
      canShowAll: true,
    };
  return {
    title: both ? 'No matches are live right now' : `No ${competition} matches are live right now`,
    message: 'Check Upcoming for the next matches.',
    canShowAll: false,
  };
}
