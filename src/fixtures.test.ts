import { describe, expect, it } from 'vitest';
import { groupFixtures, isInProgress, isLive } from './fixtures';
import { mockMatches } from './test-fixtures/fixtures';
import type { Match } from './types';

const fixture = (id: string, day: number, hour: number, favorite = false): Match => ({
  ...mockMatches[2],
  id,
  status: 'scheduled',
  home: { id: favorite ? 'followed' : id, name: id, short: id },
  away: { id: 'away', name: 'Away', short: 'AWY' },
  kickoff: new Date(2026, 9, day, hour).toISOString(),
});
describe('local fixture dates', () => {
  it('labels unconfirmed cached live scores explicitly without changing their match status', () => {
    const saved = { ...fixture('live', 28, 12), status: 'live' as const, scoreStale: true };
    expect(groupFixtures([saved], [])[0].label).toBe('SAVED LIVE SCORES');
    expect(groupFixtures([saved, { ...saved, id: 'fresh', scoreStale: false }], [])[0].label).toBe(
      'LIVE NOW · SOME SAVED',
    );
  });
  it('keeps a suspended game with in-progress matches, as the backend does, without calling it live', () => {
    const suspended = { ...fixture('suspended', 27, 20), status: 'suspended' as const, detail: 'Suspended' };
    const groups = groupFixtures([fixture('later', 30, 12), suspended], [], new Date(2026, 9, 28));
    expect(groups[0]).toMatchObject({ key: 'live', label: 'LIVE NOW' });
    expect(groups[0].matches.map((m) => m.id)).toEqual(['suspended']);
    // A game being played still leads an earlier-kickoff suspended one.
    const live = { ...fixture('live', 28, 12), status: 'live' as const };
    expect(groupFixtures([suspended, live], [], new Date(2026, 9, 28))[0].matches.map((m) => m.id)).toEqual([
      'live',
      'suspended',
    ]);
    expect(isLive(suspended)).toBe(false);
    expect(isInProgress(suspended)).toBe(true);
  });
  it('keeps earlier dates ahead of later followed fixtures and sorts each day', () => {
    const groups = groupFixtures(
      [fixture('later', 31, 14, true), fixture('evening', 30, 20), fixture('morning', 30, 9)],
      ['followed'],
      new Date(2026, 9, 28),
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].matches.map((m) => m.id)).toEqual(['morning', 'evening']);
    expect(groups[1].matches[0].id).toBe('later');
  });
  it('prioritizes favorites within the same day and keeps live matches first', () => {
    const live = { ...fixture('live', 28, 12), status: 'live' as const };
    const groups = groupFixtures(
      [fixture('early', 29, 9), fixture('followed', 29, 20, true), live],
      ['followed'],
      new Date(2026, 9, 28),
    );
    expect(groups[0].label).toBe('LIVE NOW');
    expect(groups[1].label).toBe('TOMORROW');
    expect(groups[1].matches.map((m) => m.id)).toEqual(['followed', 'early']);
  });
  it('handles local midnight and month boundaries', () => {
    const groups = groupFixtures(
      [fixture('tomorrow', 32, 0), fixture('today', 31, 23)],
      [],
      new Date(2026, 9, 31, 23, 59),
    );
    expect(groups.map((g) => g.label)).toEqual(['TODAY', 'TOMORROW']);
  });
  it('keeps a fixture with a damaged kickoff visible instead of throwing', () => {
    const broken: Match = { ...fixture('broken', 29, 12), kickoff: 'not-a-date' };
    const groups = groupFixtures([broken, fixture('good', 29, 15)], [], new Date(2026, 9, 28, 12));
    expect(groups.map((g) => g.label)).toEqual(['TOMORROW', 'DATE UNAVAILABLE']);
    expect(groups[1].matches.map((m) => m.id)).toEqual(['broken']);
  });
  it('orders results newest first, including within a day, with unknown dates last', () => {
    const matches = [
      fixture('early', 29, 9, true),
      fixture('old', 28, 20),
      fixture('late', 29, 20),
      { ...fixture('unknown', 29, 12), kickoff: 'invalid' },
    ];
    const groups = groupFixtures(matches, ['followed'], new Date(2026, 9, 30), 'results');
    expect(groups.map((group) => group.matches.map((match) => match.id))).toEqual([
      ['late', 'early'],
      ['old'],
      ['unknown'],
    ]);
  });
  it('treats playing, halftime and suspended matches as in progress', () => {
    for (const status of ['live', 'halftime', 'suspended'] as const) {
      expect(isInProgress({ ...fixture(status, 28, 12), status })).toBe(true);
    }
    expect(isInProgress(fixture('scheduled', 28, 12))).toBe(false);
  });
});
