import { describe, expect, it } from 'vitest';
import { countdownLabel, timezoneLabel } from './countdown';

const now = new Date('2026-11-13T12:00:00Z');
const in_ = (ms: number) => new Date(now.getTime() + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('countdownLabel', () => {
  it('shows days and hours for kick-offs more than a day away', () => {
    expect(countdownLabel(in_(8 * DAY + 4 * HOUR + 30 * MIN), now)).toBe('Starts in 8d 4h');
  });
  it('shows hours and minutes under a day', () => {
    expect(countdownLabel(in_(2 * HOUR + 15 * MIN), now)).toBe('Starts in 2h 15m');
  });
  it('drops zero minutes', () => {
    expect(countdownLabel(in_(2 * HOUR), now)).toBe('Starts in 2h');
  });
  it('shows minutes under an hour', () => {
    expect(countdownLabel(in_(45 * MIN), now)).toBe('Starts in 45m');
  });
  it('reads as starting soon within five minutes', () => {
    expect(countdownLabel(in_(4 * MIN), now)).toBe('Starting soon');
    expect(countdownLabel(in_(5 * MIN), now)).toBe('Starting soon');
  });
  it('reads as starting soon for a kick-off already past', () => {
    expect(countdownLabel(in_(-10 * MIN), now)).toBe('Starting soon');
  });
  it('returns null for an unparseable kick-off', () => {
    expect(countdownLabel('not a date', now)).toBeNull();
  });
  it('drops zero hours from day countdowns', () => {
    expect(countdownLabel(in_(3 * DAY), now)).toBe('Starts in 3d');
  });
});

describe('timezoneLabel', () => {
  it('returns a non-empty label', () => {
    const label = timezoneLabel(now);
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
  it('never returns a raw GMT/UTC offset', () => {
    expect(timezoneLabel(now)).not.toMatch(/^(GMT|UTC)[+-]/);
  });
});
