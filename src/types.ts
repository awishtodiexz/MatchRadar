export type Status = 'scheduled' | 'live' | 'halftime' | 'fulltime' | 'postponed' | 'cancelled' | 'suspended' | 'unknown';
export interface Team { id: string; name: string; short: string; logo?: string | null }
export interface Match { id: string; home: Team; away: Team; homeScore?: number | null; awayScore?: number | null; kickoff: string; status: Status; detail: string; competition: string; scoreStale?: boolean }
export interface MatchAlert { enabled: boolean; expiresAt: string }
export interface Settings { matchAlerts: Record<string, MatchAlert>; favorites: string[]; followedOnly: boolean; compact: boolean; alwaysOnTop: boolean; reducedMotion: boolean; opacity: number; theme: 'dark' | 'light'; reminders: boolean; reminderMinutes: number; starts: boolean; goals: boolean }
export interface Snapshot { matches: Match[]; updatedAt?: string | null; fixtureUpdatedAt?: string | null; fixtureError?: string | null; scoreError?: string | null; error?: string | null; partial?: boolean; refreshing?: boolean; settings: Settings }
