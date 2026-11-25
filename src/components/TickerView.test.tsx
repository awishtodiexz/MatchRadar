// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TickerView } from './TickerView';
import { mockSnapshot } from '../test-fixtures/fixtures';
import { relativeDay, timeLabel } from '../presentation';
import type { Match } from '../types';

afterEach(cleanup);

const scheduled: Match = { ...mockSnapshot.matches[2], kickoff: new Date(Date.now() + 5 * 3600000).toISOString() };
const live = mockSnapshot.matches[0]; // demo-1: live 2–1 at 67′

it('shows a scheduled kick-off with its time and day', () => {
  const { container } = render(<TickerView match={scheduled} onExpand={vi.fn()} />);
  expect(screen.getByText(timeLabel(scheduled.kickoff))).toBeTruthy();
  expect(screen.getByText(relativeDay(scheduled.kickoff))).toBeTruthy();
  expect(container.textContent).not.toMatch(/undefined|NaN/);
});

it('shows a live score with the match clock', () => {
  const { container } = render(<TickerView match={live} onExpand={vi.fn()} />);
  expect(screen.getByText('2 – 1')).toBeTruthy();
  expect(screen.getByText('67′')).toBeTruthy();
  expect(container.querySelector('.ticker-centre')?.classList.contains('is-live')).toBe(true);
  expect(container.textContent).not.toMatch(/undefined|NaN/);
});

it('renders a dash for a missing score instead of undefined', () => {
  const { container } = render(
    <TickerView match={{ ...live, homeScore: null, awayScore: undefined }} onExpand={vi.fn()} />,
  );
  expect(screen.getByText('– – –')).toBeTruthy();
  expect(container.textContent).not.toMatch(/undefined|NaN/);
});

it('labels saved scores and removes the live treatment', () => {
  const { container } = render(<TickerView match={{ ...live, scoreStale: true }} onExpand={vi.fn()} />);
  expect(screen.getByText(/SAVED/)).toBeTruthy();
  expect(container.querySelector('.is-live')).toBeNull();
  expect(container.querySelector('.dot')).toBeNull();
});

it('keeps the score visible while a match is suspended', () => {
  const { container } = render(
    <TickerView match={{ ...live, status: 'suspended', detail: 'Suspended' }} onExpand={vi.fn()} />,
  );
  expect(screen.getByText('2 – 1')).toBeTruthy();
  expect(screen.getByText('SUSPENDED')).toBeTruthy();
  expect(container.querySelector('.dot')).toBeNull();
});

it('shows the final score rather than the original kick-off time for a finished match', () => {
  const ended = { ...live, status: 'fulltime' as const, detail: 'Full-time', homeScore: 3, awayScore: 1 };
  render(<TickerView match={ended} onExpand={vi.fn()} />);
  expect(screen.getByText('3 – 1')).toBeTruthy();
  expect(screen.queryByText(timeLabel(ended.kickoff))).toBeNull();
});

it('does not present the original kick-off time as current for postponed or cancelled matches', () => {
  for (const status of ['postponed', 'cancelled'] as const) {
    const detail = status === 'postponed' ? 'Postponed' : 'Cancelled';
    const match = { ...scheduled, status, detail };
    const { unmount } = render(<TickerView match={match} onExpand={vi.fn()} />);
    expect(screen.queryByText(timeLabel(match.kickoff))).toBeNull();
    expect(screen.getByText(detail.toUpperCase())).toBeTruthy();
    expect(screen.getByText('–')).toBeTruthy();
    unmount();
  }
});

it('shows the empty message when there is no match', () => {
  render(<TickerView match={null} onExpand={vi.fn()} />);
  expect(screen.getByText('No live or upcoming matches')).toBeTruthy();
});

it('expands the full widget when the card is clicked', () => {
  const onExpand = vi.fn();
  render(<TickerView match={live} onExpand={onExpand} />);
  fireEvent.click(screen.getByTitle('Expand MatchRadar'));
  expect(onExpand).toHaveBeenCalledTimes(1);
});

it('keeps the expand affordance available without a match', () => {
  const onExpand = vi.fn();
  render(<TickerView match={null} onExpand={onExpand} />);
  fireEvent.click(screen.getByTitle('Expand MatchRadar'));
  expect(onExpand).toHaveBeenCalledTimes(1);
});

it('names the card with the visible codes and the shootout outcome', () => {
  const pens: Match = {
    ...live,
    status: 'fulltime',
    detail: 'Full time',
    shootout: { home: 4, away: 3 },
  };
  render(<TickerView match={pens} onExpand={vi.fn()} />);
  // Content-derived name: visible text + the descriptive sr-only sentence, so
  // label-content-name-mismatch cannot fire on an author-provided label.
  const card = screen.getByRole('button', {
    name: /^ARS\b.*Arsenal \(ARS\) versus Chelsea \(CHE\), score 2 – 1, Full time, Arsenal won 4–3 on penalties\. Expand MatchRadar$/,
  });
  // The leading sentence boundary is pinned separately: it is what keeps the
  // sr-only sentence a word boundary away from the visible text for axe 2.5.3.
  expect(card.textContent).toContain('. Arsenal (ARS) versus');
  expect(card.textContent).toContain('ARS');
  expect(card.textContent).toContain('CHE');
});

it('shows that a pinned scheduled game is awaiting a provider update after kickoff', () => {
  render(
    <TickerView
      match={{ ...scheduled, kickoff: new Date(Date.now() - 10 * 60_000).toISOString() }}
      onExpand={vi.fn()}
    />,
  );
  expect(screen.getByText('Awaiting update')).toBeTruthy();
});
