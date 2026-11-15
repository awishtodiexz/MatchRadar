// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MatchDetails } from './MatchDetails';
import { defaults, mockMatches } from '../test-fixtures/fixtures';
import { dateLabel, timeLabel } from '../presentation';
const summary = vi.hoisted(() => ({ data: null as unknown }));
vi.mock('../useMatchSummary', () => ({
  useMatchSummary: () => ({ data: summary.data, loading: false, error: null, retry: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  summary.data = null;
});

it('uses a compact scoreboard for lineups and restores the full header on Overview', () => {
  const match = mockMatches[4];
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Lineups' }));
  expect(document.querySelector('.detail-hero')?.hasAttribute('hidden')).toBe(true);
  expect(document.querySelector('.mini-score')?.getAttribute('aria-label')).toContain(match.home.name);
  expect(document.querySelector('.mini-score small')?.textContent).toBe('FULL-TIME');
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
  expect(document.querySelector('.detail-hero')?.hasAttribute('hidden')).toBe(false);
});

it.each([
  ['FT', 'FULL-TIME'],
  ['AET', 'AFTER EXTRA TIME'],
  ['PEN', 'AFTER PENALTIES'],
  ['Forfeit', 'FORFEIT'],
])('identifies a completed %s result in Match Centre', (detail, label) => {
  render(
    <MatchDetails match={{ ...mockMatches[0], status: 'fulltime', detail }} settings={defaults} back={() => {}} />,
  );
  expect(document.querySelector('.detail-status')?.textContent).toBe(label);
});

const summaryWith = (matchId: string, standings?: unknown) => ({
  matchId,
  updatedAt: new Date().toISOString(),
  stale: false,
  error: null,
  venue: null,
  events: [],
  statistics: [],
  players: [],
  ...(standings ? { standings } : {}),
});

it('shows kick-off time and an explicit note for a postponed match', () => {
  const match = mockMatches[5];
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  expect(document.querySelector('.detail-score > span')?.textContent).toBe(timeLabel(match.kickoff));
  expect(screen.getByText('POSTPONED')).toBeTruthy();
  expect(screen.getByText('This match has been postponed.')).toBeTruthy();
  expect(screen.getByText('Match information')).toBeTruthy();
});

it('shows kick-off time and an explicit note for a cancelled match', () => {
  const match = mockMatches[9];
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  expect(document.querySelector('.detail-score > span')?.textContent).toBe(timeLabel(match.kickoff));
  expect(screen.getByText('CANCELLED')).toBeTruthy();
  expect(screen.getByText('This match was cancelled.')).toBeTruthy();
});

it('keeps the score and scoreboard for a played match', () => {
  const match = mockMatches[4];
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  expect(document.querySelector('.detail-score > span')?.textContent).toBe('1 – 1');
  expect(screen.getByText('FULL-TIME')).toBeTruthy();
});

it('shows knockout leg and aggregate context when the provider supplies it', () => {
  const match = { ...mockMatches[4], leg: '2nd Leg', aggregate: '6-4' };
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  expect(screen.getByText(/2nd Leg · Aggregate 6-4/)).toBeTruthy();
});

it('omits knockout context for league matches', () => {
  render(<MatchDetails match={mockMatches[4]} settings={defaults} back={() => {}} />);
  expect(screen.queryByText(/Aggregate/)).toBeNull();
});

it('shows a countdown in place of a date that is already in the status pill', () => {
  // Eight days out, so relativeDay returns the calendar date rather than "Today"/"Tomorrow".
  const kickoff = new Date(Date.now() + (8 * 24 + 4) * 3600_000 + 30 * 60_000).toISOString();
  const dateText = dateLabel(kickoff);
  render(<MatchDetails match={{ ...mockMatches[2], kickoff }} settings={defaults} back={() => {}} />);
  expect(document.querySelector('.detail-date .countdown')?.textContent).toMatch(/^Starts in \d+d \d+h$/);
  expect(document.querySelector('.detail-date .tz-badge')?.textContent).toBeTruthy();
  expect(document.querySelector('.detail-date')?.textContent).not.toContain(dateText);
  const heroText = document.querySelector('.detail-hero')?.textContent ?? '';
  expect(heroText.split(dateText).length - 1).toBe(1);
});

it('shows league position and points under each club when the summary has standings', () => {
  const match = mockMatches[2];
  summary.data = summaryWith(match.id, [
    { teamId: match.home.id, rank: 1, points: 27, played: 10 },
    { teamId: match.away.id, rank: 12, points: 14, played: 10 },
  ]);
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  const pills = [...document.querySelectorAll('.table-pill')].map((el) => el.textContent);
  expect(pills).toEqual(['1st · 27 pts', '12th · 14 pts']);
  const homePill = screen.getByText('1st · 27 pts');
  expect(homePill.getAttribute('title')).toBe('1st in the table · 27 points from 10 matches');
  expect(homePill.parentElement?.querySelector('b')?.textContent).toBe(match.home.name);
  expect(screen.getByText('12th · 14 pts').parentElement?.querySelector('b')?.textContent).toBe(match.away.name);
});

it('uses singular units for a one-match standing row', () => {
  const match = mockMatches[2];
  summary.data = summaryWith(match.id, [{ teamId: match.home.id, rank: 1, points: 1, played: 1 }]);
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  const pill = screen.getByText('1st · 1 pt');
  expect(pill.getAttribute('title')).toBe('1st in the table · 1 point from 1 match');
});

it('renders no standings pill when the summary has no standings or only invalid rows', () => {
  const match = mockMatches[2];
  summary.data = summaryWith(match.id);
  const { unmount } = render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  expect(document.querySelectorAll('.table-pill')).toHaveLength(0);
  unmount();
  summary.data = summaryWith(match.id, [
    { teamId: match.home.id, rank: Number.NaN, points: 27 },
    { teamId: match.away.id, rank: 3, points: Number.NaN },
  ]);
  render(<MatchDetails match={match} settings={defaults} back={() => {}} />);
  expect(document.querySelectorAll('.table-pill')).toHaveLength(0);
  expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
});
