import { expect, it } from 'vitest';
import { tickerMatches } from './ticker';
import { mockSnapshot } from './test-fixtures/fixtures';

it('prioritizes followed live clubs and then followed upcoming clubs', () => {
  const live = mockSnapshot.matches[0];
  const next = mockSnapshot.matches[2];
  const other = { ...live, id: 'other', home: mockSnapshot.matches[4].home, away: mockSnapshot.matches[4].away };
  const upcoming = { ...next, id: 'upcoming', kickoff: '2099-01-01T12:00:00Z' };
  const options = [other, { ...upcoming, id: 'other-upcoming', home: other.home, away: other.away }, upcoming, live];
  expect(tickerMatches(options, [live.home.id, next.home.id], Date.now()).map((match) => match.id)).toEqual([
    live.id,
    'other',
    'upcoming',
    'other-upcoming',
  ]);
  expect(options[0].id).toBe('other');
});

it('keeps saved games available while excluding completed and past scheduled games', () => {
  const live = mockSnapshot.matches[0];
  const saved = { ...live, id: 'saved', scoreStale: true };
  expect(
    tickerMatches(
      [saved, mockSnapshot.matches[4], { ...mockSnapshot.matches[2], kickoff: '2000-01-01T12:00:00Z' }, live],
      [],
      Date.now(),
    ).map((match) => match.id),
  ).toEqual([live.id, 'saved']);
});

it('shows games being played before suspended games, even if the suspended club is followed', () => {
  const live = mockSnapshot.matches[0];
  const paused = mockSnapshot.matches[10];
  expect(tickerMatches([paused, live], [paused.home.id], Date.now()).map((match) => match.id)).toEqual([
    live.id,
    paused.id,
  ]);
});

it('keeps scheduled matches in the ticker through the kickoff confirmation grace period', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const base = mockSnapshot.matches[2];
  const at = (id: string, kickoff: string) => ({ ...base, id, kickoff, status: 'scheduled' as const });
  const twoMinutesPast = at('two-minutes-past', '2026-01-01T11:58:00Z');
  const tenMinutesPast = at('ten-minutes-past', '2026-01-01T11:50:00Z');
  const later = at('later', '2026-01-01T12:30:00Z');
  const fortyFiveMinutesPast = at('forty-five-minutes-past', '2026-01-01T11:15:00Z');
  const ancient = at('ancient', '2000-01-01T12:00:00Z');
  expect(
    tickerMatches([later, fortyFiveMinutesPast, twoMinutesPast, ancient, tenMinutesPast], [], now).map(
      (match) => match.id,
    ),
  ).toEqual(['ten-minutes-past', 'two-minutes-past', 'later']);
});
