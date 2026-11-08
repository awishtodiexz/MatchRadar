export type Status = 'scheduled' | 'live' | 'halftime' | 'fulltime' | 'postponed' | 'cancelled' | 'suspended' | 'unknown';
export type Competition = 'premierLeague' | 'championsLeague';
export type CompetitionView = Competition | 'both';
export interface Team { id: string; name: string; short: string; logo?: string | null }
export interface Match { id: string; league: Competition; home: Team; away: Team; homeScore?: number | null; awayScore?: number | null; kickoff: string; status: Status; detail: string; competition: string; scoreStale?: boolean }
export interface MatchAlert { enabled: boolean; expiresAt: string }
export interface LeagueStatus {
  fixtureUpdatedAt?: string | null;
  updatedAt?: string | null;
  fixtureError?: string | null;
  scoreError?: string | null;
  recentUpdatedAt?: string | null;
  recentError?: string | null;
  recentRetryAt?: string | null;
}
export interface LeagueResults { updatedAt?: string | null; error?: string | null }
export interface Settings { matchAlerts: Record<string, MatchAlert>; favorites: string[]; followedOnly: boolean; compact: boolean; alwaysOnTop: boolean; startHidden: boolean; reducedMotion: boolean; opacity: number; theme: 'dark' | 'light'; competitionView: CompetitionView; reminders: boolean; reminderMinutes: number; starts: boolean; goals: boolean }
export interface Snapshot { matches: Match[]; leagueStatus?: Record<string, LeagueStatus>; updatedAt?: string | null; fixtureUpdatedAt?: string | null; fixtureError?: string | null; scoreError?: string | null; error?: string | null; partial?: boolean; refreshing?: boolean; settings: Settings }
