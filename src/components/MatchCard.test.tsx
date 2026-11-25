// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MatchAlertsButton, MatchCard } from './MatchCard';
import { MatchDetails } from './MatchDetails';
import { defaults, mockMatches } from '../test-fixtures/fixtures';
import { useApp } from '../store';

vi.mock('../useMatchSummary', () => ({
  useMatchSummary: () => ({ data: null, loading: false, error: null, retry: vi.fn() }),
}));
const originalSave = useApp.getState().save;
afterEach(() => {
  cleanup();
  useApp.setState({ save: originalSave });
});

it('shows an awaiting-update note instead of Soon when a scheduled kickoff is overdue', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  render(
    <MatchCard
      match={{ ...mockMatches[2], kickoff: '2026-11-14T11:50:00Z' }}
      settings={defaults}
      onOpen={() => {}}
      now={now}
    />,
  );
  expect(screen.getByText('Awaiting update')).toBeTruthy();
  expect(screen.queryByText('Soon')).toBeNull();
  const button = screen.getByRole('button', { name: /Match details:/ });
  expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toContain(
    'awaiting match update',
  );
});

it('offers the same explicit alert choices from the list and details', () => {
  const save = vi.fn().mockResolvedValue(undefined);
  useApp.setState({ save });
  const match = mockMatches[2];
  const { unmount } = render(<MatchCard match={match} settings={defaults} onOpen={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Match alerts:/ }));
  const menu = screen.getByRole('dialog');
  expect(within(menu).getByRole('button', { name: 'Team default' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(menu).getByRole('button', { name: 'On' }));
  expect(save).toHaveBeenCalledWith({
    matchAlerts: { ...defaults.matchAlerts, [match.id]: expect.objectContaining({ enabled: true }) },
  });
  unmount();
  render(
    <MatchDetails
      match={match}
      settings={{ ...defaults, matchAlerts: { [match.id]: { enabled: false, expiresAt: match.kickoff } } }}
      back={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Match alerts:/ }));
  expect(screen.getByRole('button', { name: 'Muted' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Team default' }));
  expect(save).toHaveBeenLastCalledWith({ matchAlerts: {} });
});

it('lets Tab leave the context menu in the pressed direction', () => {
  const next = mockMatches.find((match) => match.id !== mockMatches[2].id) ?? mockMatches[0];
  render(
    <>
      <MatchCard match={mockMatches[2]} settings={defaults} onOpen={() => {}} />
      <MatchCard match={next} settings={defaults} onOpen={() => {}} />
    </>,
  );
  const open = () => {
    fireEvent.contextMenu(screen.getAllByRole('button', { name: /Match details:/ })[0]);
    const menu = screen.getByRole('menu');
    within(menu).getAllByRole('menuitem')[0].focus();
    return menu;
  };
  // Forward Tab dismisses and lands on the first control after the menu: the
  // next card's open button, not document.body and not the card just passed.
  fireEvent.keyDown(within(open()).getAllByRole('menuitem')[0], { key: 'Tab' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect((document.activeElement as HTMLElement | null)?.id).toBe(`match-open-${next.id}`);
  // Shift+Tab dismisses back onto the card control just before the menu.
  fireEvent.keyDown(within(open()).getAllByRole('menuitem')[0], { key: 'Tab', shiftKey: true });
  expect(screen.queryByRole('menu')).toBeNull();
  expect((document.activeElement as HTMLElement | null)?.className).toContain('alert-trigger');
});

it('hides alert controls for completed and cancelled matches', () => {
  const match = mockMatches[2];
  const { rerender } = render(<MatchAlertsButton match={{ ...match, status: 'fulltime' }} settings={defaults} />);
  expect(screen.queryByRole('button', { name: /Match alerts:/ })).toBeNull();
  rerender(<MatchCard match={{ ...match, status: 'cancelled' }} settings={defaults} onOpen={() => {}} />);
  expect(screen.queryByRole('button', { name: /Match alerts:/ })).toBeNull();
});

it('returns keyboard focus to the match details button after using the card menu', () => {
  const match = mockMatches[2];
  render(<MatchCard match={match} settings={defaults} onOpen={vi.fn()} />);
  const details = screen.getByRole('button', { name: /^Match details:/ });
  details.focus();
  fireEvent.contextMenu(details, { clientX: 0, clientY: 0 });
  const menu = screen.getByRole('menu');
  const open = within(menu).getByRole('menuitem', { name: 'Open match details' });
  expect(document.activeElement).toBe(open);
  fireEvent.keyDown(open, { key: 'End' });
  const copy = within(menu).getByRole('menuitem', { name: 'Copy fixture' });
  expect(document.activeElement).toBe(copy);
  fireEvent.keyDown(copy, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(details);
});

it('changes the followed team list from match details', () => {
  const save = vi.fn().mockResolvedValue(undefined);
  useApp.setState({ save });
  const match = mockMatches[2];
  const settings = { ...defaults, favorites: [match.home.id] };
  render(<MatchDetails match={match} settings={settings} back={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: `Unfollow ${match.home.name}` }));
  expect(save).toHaveBeenLastCalledWith({ favorites: [] });
  fireEvent.click(screen.getByRole('button', { name: `Follow ${match.away.name}` }));
  expect(save).toHaveBeenLastCalledWith({ favorites: [match.home.id, match.away.id] });
});

it('explains what team defaults mean for this fixture', () => {
  const match = mockMatches[2];
  const { rerender } = render(<MatchAlertsButton match={match} settings={{ ...defaults, favorites: [] }} />);
  fireEvent.click(screen.getByRole('button', { name: /Match alerts:/ }));
  expect(screen.getByText(/No alerts: you don’t follow either team/)).toBeTruthy();
  rerender(
    <MatchAlertsButton
      match={match}
      settings={{ ...defaults, favorites: [match.home.id], reminders: false, starts: false, goals: false }}
    />,
  );
  expect(screen.getByText(/all team alert types are off/)).toBeTruthy();
  rerender(
    <MatchAlertsButton
      match={match}
      settings={{ ...defaults, favorites: [match.home.id], reminders: false, starts: false, goals: true }}
    />,
  );
  expect(screen.getByText(`Alerts for goals because you follow ${match.home.name}.`)).toBeTruthy();
});
