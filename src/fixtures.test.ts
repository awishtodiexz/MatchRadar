import { describe, expect, it } from 'vitest';
import { groupFixtures } from './fixtures';
import { mockMatches } from './test-fixtures/fixtures';
import type { Match } from './types';

const fixture = (id: string, day: number, hour: number, favorite = false): Match => ({ ...mockMatches[2], id, status: 'scheduled', home: { id: favorite ? 'followed' : id, name: id, short: id }, away: { id: 'away', name: 'Away', short: 'AWY' }, kickoff: new Date(2026, 9, day, hour).toISOString() });
describe('local fixture dates', () => {
  it('labels unconfirmed cached live scores explicitly without changing their match status', () => {
    const saved = {...fixture('live',28,12),status:'live' as const,scoreStale:true};
    expect(groupFixtures([saved],[])[0].label).toBe('SAVED LIVE SCORES');
    expect(groupFixtures([saved,{...saved,id:'fresh',scoreStale:false}],[])[0].label).toBe('LIVE NOW · SOME SAVED');
  });
  it('keeps earlier dates ahead of later followed fixtures and sorts each day', () => {
    const groups = groupFixtures([fixture('later', 31, 14, true), fixture('evening', 30, 20), fixture('morning', 30, 9)], ['followed'], new Date(2026, 9, 28));
    expect(groups).toHaveLength(2);
    expect(groups[0].matches.map(m => m.id)).toEqual(['morning', 'evening']);
    expect(groups[1].matches[0].id).toBe('later');
  });
  it('prioritizes favorites within the same day and keeps live matches first', () => {
    const live = { ...fixture('live', 28, 12), status: 'live' as const };
    const groups = groupFixtures([fixture('early', 29, 9), fixture('followed', 29, 20, true), live], ['followed'], new Date(2026, 9, 28));
    expect(groups[0].label).toBe('LIVE NOW');
    expect(groups[1].label).toBe('TOMORROW');
    expect(groups[1].matches.map(m => m.id)).toEqual(['followed', 'early']);
  });
  it('handles local midnight and month boundaries', () => {
    const groups = groupFixtures([fixture('tomorrow', 32, 0), fixture('today', 31, 23)], [], new Date(2026, 9, 31, 23, 59));
    expect(groups.map(g => g.label)).toEqual(['TODAY', 'TOMORROW']);
  });
  it('keeps a fixture with a damaged kickoff visible instead of throwing', () => {
    const broken: Match = { ...fixture('broken', 29, 12), kickoff: 'not-a-date' };
    const groups = groupFixtures([broken, fixture('good', 29, 15)], [], new Date(2026, 9, 28, 12));
    expect(groups.map(g => g.label)).toEqual(['TOMORROW', 'DATE UNAVAILABLE']);
    expect(groups[1].matches.map(m => m.id)).toEqual(['broken']);
  });
});
