// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TickerView } from './TickerView';
import { mockSnapshot } from '../test-fixtures/fixtures';
import { relativeDay, timeLabel } from '../presentation';
import type { Match } from '../types';

afterEach(cleanup);

const scheduled: Match = {...mockSnapshot.matches[2], kickoff: new Date(Date.now() + 5 * 3600000).toISOString()};
const live = mockSnapshot.matches[0]; // demo-1: live 2–1 at 67′

it('shows a scheduled kick-off with its time and day', () => {
  const { container } = render(<TickerView match={scheduled} onExpand={vi.fn()}/>);
  expect(screen.getByText(timeLabel(scheduled.kickoff))).toBeTruthy();
  expect(screen.getByText(relativeDay(scheduled.kickoff))).toBeTruthy();
  expect(container.textContent).not.toMatch(/undefined|NaN/);
});

it('shows a live score with the match clock', () => {
  const { container } = render(<TickerView match={live} onExpand={vi.fn()}/>);
  expect(screen.getByText('2 – 1')).toBeTruthy();
  expect(screen.getByText("67′")).toBeTruthy();
  expect(container.querySelector('.ticker-centre')?.classList.contains('is-live')).toBe(true);
  expect(container.textContent).not.toMatch(/undefined|NaN/);
});

it('renders a dash for a missing score instead of undefined', () => {
  const { container } = render(<TickerView match={{...live, homeScore: null, awayScore: undefined}} onExpand={vi.fn()}/>);
  expect(screen.getByText('– – –')).toBeTruthy();
  expect(container.textContent).not.toMatch(/undefined|NaN/);
});

it('shows the empty message when there is no match', () => {
  render(<TickerView match={null} onExpand={vi.fn()}/>);
  expect(screen.getByText('No live or upcoming matches')).toBeTruthy();
});

it('expands the full widget when the card is clicked', () => {
  const onExpand = vi.fn();
  render(<TickerView match={live} onExpand={onExpand}/>);
  fireEvent.click(screen.getByTitle('Expand MatchRadar'));
  expect(onExpand).toHaveBeenCalledTimes(1);
});

it('keeps the expand affordance available without a match', () => {
  const onExpand = vi.fn();
  render(<TickerView match={null} onExpand={onExpand}/>);
  fireEvent.click(screen.getByTitle('Expand MatchRadar'));
  expect(onExpand).toHaveBeenCalledTimes(1);
});
