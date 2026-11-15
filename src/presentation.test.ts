import { describe, expect, it } from 'vitest';
import { dateLabel, matchButtonId, resultLabel, timeLabel, timeParts } from './presentation';
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
