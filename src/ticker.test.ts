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
