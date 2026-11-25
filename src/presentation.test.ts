import { describe, expect, it } from 'vitest';
import {
  dateLabel,
  matchButtonId,
  resultLabel,
  resultWinner,
  shootoutResult,
  timeLabel,
  timeParts,
} from './presentation';
import { mockMatches } from './test-fixtures/fixtures';

// Persisted state is validated structurally, not semantically: a valid JSON
// snapshot can still carry a damaged timestamp after a partial disk write.
// Formatting must degrade to a readable placeholder, never throw and blank the UI.
describe('date labels tolerate damaged timestamps', () => {
  it('returns placeholders instead of throwing on unparseable values', () => {
    for (const value of ['not-a-date', '', '2026-13-45T99:99:99Z']) {
      expect(() => dateLabel(value)).not.toThrow();
      expect(() => timeLabel(value)).not.toThrow();
      expect(dateLabel(value)).toBe('Date unavailable');
      expect(timeLabel(value)).toBe('Time unavailable');
    }
  });
  it('formats valid timestamps and builds stable encoded element ids', () => {
    expect(dateLabel('2026-10-31T12:00:00Z')).toMatch(/31/);
    expect(timeLabel('2026-10-31T12:00:00Z')).toMatch(/^\d{1,2}:\d{2}/);
    expect(matchButtonId('abc:123')).toBe('match-open-abc%3A123');
  });
});

describe('time labels', () => {
  it('splits the meridiem from the clock so it can be styled separately', () => {
    expect(timeParts('2:30 PM')).toEqual(['2:30', ' PM']);
    expect(timeParts('12:05\u202fam')).toEqual(['12:05', '\u202fam']);
    expect(timeParts('14:30')).toEqual(['14:30', '']);
  });
});

it('labels completed results by their outcome', () => {
  const match = { ...mockMatches[0], status: 'fulltime' as const };
  for (const [detail, expected] of [
    ['FT', 'FT'],
    ['AET', 'AET'],
    ['Final - After Extra Time', 'AET'],
    ['FT-Pens', 'PEN'],
    ['Final - Penalties', 'PEN'],
    ['Forfeit', 'FF'],
  ]) {
    expect(resultLabel({ ...match, detail })).toBe(expected);
  }
});

describe('shootout presentation', () => {
  const decided = {
    ...mockMatches[0],
    status: 'fulltime' as const,
    detail: 'FT-Pens',
    homeScore: 1,
    awayScore: 1,
    shootout: { home: 5, away: 4 },
  };
  it('labels and resolves a shootout winner from the tally', () => {
    expect(resultLabel(decided)).toBe('PEN');
    expect(shootoutResult(decided)).toEqual({
      side: 'home',
      tally: '5–4',
      outcome: `${decided.home.name} won 5–4 on penalties`,
    });
    expect(resultWinner(decided)).toBe('home');
  });
  it('resolves an away shootout win', () => {
    const away = { ...decided, shootout: { home: 3, away: 4 } };
    expect(shootoutResult(away)).toEqual({
      side: 'away',
      tally: '3–4',
      outcome: `${away.away.name} won 4–3 on penalties`,
    });
    expect(resultWinner(away)).toBe('away');
  });
  it('claims no shootout winner without a decided tally, and still labels the detail', () => {
    expect(shootoutResult({ ...decided, shootout: undefined })).toBeNull();
    expect(shootoutResult({ ...decided, shootout: { home: 4, away: 4 } })).toBeNull();
    expect(shootoutResult({ ...decided, status: 'live' as const })).toBeNull();
    expect(resultLabel({ ...decided, shootout: undefined })).toBe('PEN');
    expect(resultWinner({ ...decided, shootout: undefined })).toBeNull();
    // Regulation results still resolve from the scoreline when no shootout exists.
    expect(resultWinner({ ...decided, detail: 'FT', shootout: undefined, homeScore: 2 })).toBe('home');
    expect(resultWinner({ ...decided, status: 'live' as const })).toBeNull();
  });
});
