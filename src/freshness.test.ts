import { describe, expect, it } from 'vitest';
import { competitionStatus, resultsStatus, updateStatus } from './freshness';
import { mockSnapshot } from './test-fixtures/fixtures';

describe('independent source freshness', () => {
  it('does not label a fixture-only success as a fresh scoreboard', () => {
    expect(
      updateStatus({
        ...mockSnapshot,
        partial: true,
        error: 'Scores failed',
        scoreError: 'HTTP 500',
        updatedAt: 'old scores',
        fixtureUpdatedAt: 'new fixtures',
      }),
    ).toEqual({ label: 'PARTIAL · SCORES SAVED', timestamp: 'old scores' });
    expect(
      updateStatus({
        ...mockSnapshot,
        partial: true,
        error: 'Scores failed',
        scoreError: 'HTTP 500',
        updatedAt: null,
        fixtureUpdatedAt: 'new fixtures',
      }),
    ).toEqual({ label: 'PARTIAL · FIXTURES UPDATED', timestamp: 'new fixtures' });
    expect(
      updateStatus({
        ...mockSnapshot,
        partial: true,
        error: 'Partial month and failed scores',
        updatedAt: null,
        fixtureUpdatedAt: null,
      }),
    ).toEqual({ label: 'PARTIAL · DATA SAVED', timestamp: null });
  });
  it('shows valid scores with a fixture error, or a complete failure without a false success time', () => {
    expect(
      updateStatus({
        ...mockSnapshot,
        partial: true,
        error: 'Fixtures failed',
        fixtureError: 'HTTP 500',
        updatedAt: 'new scores',
      }),
    ).toEqual({ label: 'PARTIAL · SCORES CHECKED', timestamp: 'new scores' });
    expect(
      updateStatus({
        ...mockSnapshot,
        partial: false,
        error: 'Both failed',
        scoreError: 'HTTP 500',
        updatedAt: 'old scores',
      }),
    ).toEqual({ label: 'UPDATE FAILED · SCORES SAVED', timestamp: 'old scores' });
  });
  it('reports an active ESPN rate limit with its retry time, then reverts when it passes', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const limited = { ...mockSnapshot, updatedAt: 'old scores', rateLimitedUntil: '2026-11-12T12:10:00Z' };
    expect(updateStatus(limited, 'premierLeague', now)).toEqual({
      label: 'RATE LIMITED · RETRY AT',
      timestamp: '2026-11-12T12:10:00Z',
    });
    expect(updateStatus(limited, 'premierLeague', Date.parse('2026-11-12T12:11:00Z')).label).not.toContain(
      'RATE LIMITED',
    );
    expect(updateStatus({ ...limited, refreshing: true }, 'premierLeague', now)).toEqual({ label: 'UPDATING' });
  });
  it('keeps ordinary success, loading and empty startup distinguishable', () => {
    expect(updateStatus({ ...mockSnapshot, updatedAt: 'checked' })).toEqual({
      label: 'SCORES CHECKED',
      timestamp: 'checked',
    });
    expect(updateStatus({ ...mockSnapshot, refreshing: true })).toEqual({ label: 'UPDATING' });
    expect(updateStatus(null)).toEqual({ label: 'CONNECTING' });
  });
  it('never claims a checked timestamp when only one selected competition reported', () => {
    const snapshot = {
      ...mockSnapshot,
      leagueStatus: { 'eng.1': { updatedAt: '2026-11-06T10:00:00Z', fixtureUpdatedAt: '2026-11-05T10:00:00Z' } },
    };
    const both = competitionStatus(snapshot, 'both');
    expect(both.updatedAt).toBeNull();
    expect(both.fixtureUpdatedAt).toBeNull();
    expect(both.error).toBeNull();
    // The Premier League alone is still reported accurately.
    expect(competitionStatus(snapshot, 'premierLeague').updatedAt).toBe('2026-11-06T10:00:00Z');
    expect(updateStatus(snapshot, 'both').label).toBe('CONNECTING');
  });
});

it('requires every selected league to have a valid source timestamp', () => {
  const checked = '2026-11-14T10:00:00Z';
  for (const missing of [null, undefined, 'invalid']) {
    const snapshot = {
      ...mockSnapshot,
      leagueStatus: {
        'eng.1': { updatedAt: checked, fixtureUpdatedAt: checked },
        'uefa.champions': { updatedAt: missing, fixtureUpdatedAt: missing },
      },
    };
    expect(competitionStatus(snapshot, 'both').updatedAt).toBeNull();
    expect(competitionStatus(snapshot, 'both').fixtureUpdatedAt).toBeNull();
    expect(
      resultsStatus({ leagues: { 'eng.1': { updatedAt: checked }, 'uefa.champions': { updatedAt: missing } } }, 'both')
        .updatedAt,
    ).toBeNull();
  }
  expect(
    resultsStatus(
      { leagues: { 'eng.1': { updatedAt: checked }, 'uefa.champions': { updatedAt: '2026-11-14T09:00:00Z' } } },
      'both',
    ).updatedAt,
  ).toBe('2026-11-14T09:00:00Z');
});
