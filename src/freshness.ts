import type { Competition, CompetitionView, LeagueResults, Snapshot } from './types';

export const competitionLeagues = (view: CompetitionView = 'premierLeague'): Competition[] =>
  view === 'both' ? ['premierLeague', 'championsLeague'] : [view];

export const competitionSlug = (league: Competition) => (league === 'premierLeague' ? 'eng.1' : 'uefa.champions');
export const competitionName = (league: Competition) =>
  league === 'premierLeague' ? 'Premier League' : 'Champions League';

export interface ViewStatus {
  updatedAt?: string | null;
  fixtureUpdatedAt?: string | null;
  fixtureError?: string | null;
  scoreError?: string | null;
  error?: string | null;
  partial?: boolean;
  hasData?: boolean;
}

const earliest = (values: Array<string | null | undefined>): string | null => {
  const present = values.filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
  if (present.length !== values.length) return null;
  return present.length ? present.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
};
const joinErrors = (labels: string[], errors: Array<string | null | undefined>): string | null => {
  const present = errors.flatMap((error, index) => (error ? [`${labels[index]}: ${error}`] : []));
  return present.length ? present.join('; ') : null;
};

/** Status for the selected competition(s), falling back to legacy aggregate fields. */
export function competitionStatus(snapshot: Snapshot | null, view: CompetitionView = 'premierLeague'): ViewStatus {
  if (!snapshot) return {};
  const leagues = competitionLeagues(view);
  const statuses = leagues.map((league) => snapshot.leagueStatus?.[competitionSlug(league)]);
  const labels = leagues.map(competitionName);
  const hasData = snapshot.matches.some((match) => leagues.includes(match.league ?? 'premierLeague'));
  if (!statuses.some(Boolean)) {
    if (!leagues.includes('premierLeague')) return { hasData };
    return {
      updatedAt: snapshot.updatedAt,
      fixtureUpdatedAt: snapshot.fixtureUpdatedAt,
      fixtureError: snapshot.fixtureError,
      scoreError: snapshot.scoreError,
      error: snapshot.error,
      partial: snapshot.partial,
      hasData,
    };
  }
  // Only claim a checked timestamp when every selected competition reported;
  // otherwise one league's success would masquerade as complete freshness.
  const complete = statuses.every(Boolean);
  const updatedAt = complete ? earliest(statuses.map((status) => status?.updatedAt)) : null;
  const fixtureUpdatedAt = complete ? earliest(statuses.map((status) => status?.fixtureUpdatedAt)) : null;
  const fixtureError = joinErrors(
    labels,
    statuses.map((status) => status?.fixtureError),
  );
  const scoreError = joinErrors(
    labels,
    statuses.map((status) => status?.scoreError),
  );
  const errors = [fixtureError, scoreError].filter(Boolean);
  return {
    updatedAt,
    fixtureUpdatedAt,
    fixtureError,
    scoreError,
    error: errors.length ? errors.join('; ') : null,
    partial: !!errors.length && !!(updatedAt || fixtureUpdatedAt),
    hasData,
  };
}

export function resultsStatus(
  results: { updatedAt?: string | null; error?: string | null; leagues?: Record<string, LeagueResults> },
  view: CompetitionView = 'premierLeague',
): ViewStatus {
  const leagues = competitionLeagues(view);
  const entries = leagues.map((league) => results.leagues?.[competitionSlug(league)]);
  if (!entries.some(Boolean)) {
    if (!leagues.includes('premierLeague')) return {};
    return { updatedAt: results.updatedAt, error: results.error };
  }
  const labels = leagues.map(competitionName);
  const complete = entries.every(Boolean);
  const updatedAt = complete ? earliest(entries.map((entry) => entry?.updatedAt)) : null;
  const error = joinErrors(
    labels,
    entries.map((entry) => entry?.error),
  );
  return { updatedAt, error };
}

/** The host-wide ESPN rate-limit deadline while it is still in the future. */
export function rateLimitedUntil(snapshot: Snapshot | null, now = Date.now()): string | null {
  const until = snapshot?.rateLimitedUntil;
  return until && Date.parse(until) > now ? until : null;
}

export function updateStatus(
  snapshot: Snapshot | null,
  view: CompetitionView = 'premierLeague',
  now = Date.now(),
): { label: string; timestamp?: string | null } {
  if (snapshot?.refreshing) return { label: 'UPDATING' };
  // A manual refresh cannot bypass the provider's cooldown; say so instead of
  // flashing the spinner and silently leaving the data unchanged.
  const limited = rateLimitedUntil(snapshot, now);
  if (limited) return { label: 'RATE LIMITED · RETRY AT', timestamp: limited };
  const status = competitionStatus(snapshot, view);
  if (status.error) {
    const suffix = status.updatedAt
      ? status.scoreError
        ? 'SCORES SAVED'
        : 'SCORES CHECKED'
      : status.fixtureUpdatedAt
        ? 'FIXTURES UPDATED'
        : status.hasData
          ? 'DATA SAVED'
          : 'NO CACHE';
    return {
      label: (status.partial ? 'PARTIAL' : 'UPDATE FAILED') + ' · ' + suffix,
      timestamp: status.updatedAt ?? status.fixtureUpdatedAt,
    };
  }
  if (status.updatedAt) return { label: 'SCORES CHECKED', timestamp: status.updatedAt };
  if (status.fixtureUpdatedAt) return { label: 'FIXTURES UPDATED', timestamp: status.fixtureUpdatedAt };
  return { label: 'CONNECTING' };
}
