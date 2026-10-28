export type Status = 'scheduled' | 'live' | 'halftime' | 'fulltime' | 'postponed' | 'cancelled' | 'suspended' | 'unknown';
export interface Team { id: string; name: string; short: string; logo?: string }
export interface Match { id: string; home: Team; away: Team; homeScore?: number; awayScore?: number; kickoff: string; status: Status; detail: string; competition: string }
export interface Settings { favorites: string[]; followedOnly: boolean; compact: boolean; alwaysOnTop: boolean; reducedMotion: boolean; opacity: number; reminders: boolean; reminderMinutes: number; starts: boolean; goals: boolean; mock: boolean }
export interface Snapshot { matches: Match[]; updatedAt?: string | null; error?: string | null; refreshing?: boolean; settings: Settings }
