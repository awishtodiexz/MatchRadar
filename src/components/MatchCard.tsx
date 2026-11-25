import { Bell, BellOff, BellRing, ClipboardCopy, PanelRightOpen, Star } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useApp } from '../store';
import { isLive } from '../fixtures';
import type { Match, Settings } from '../types';
import { Badge } from './WidgetUi';
import { closedNote, resultLabel, resultWinner, shootoutResult, matchButtonId, timeLabel } from '../presentation';
import { awaitingKickoffUpdate, countdownLabel, shortCountdown } from '../countdown';

const clockText = (detail: string) => {
  const stoppage = detail.match(/^(\d+)'\+(\d+)'?$/);
  return stoppage ? `${stoppage[1]}+${stoppage[2]}'` : detail;
};
// A damaged saved kickoff must not make the alert controls throw. Fall back to
// now for the (display-only) subscription expiry; Rust clamps it to the fixture.
const alertExpiry = (kickoff: string) => {
  const parsed = Date.parse(kickoff);
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + 30 * 86400000).toISOString();
};

function alertPresentation(settings: Settings, match: Match) {
  const preference = settings.matchAlerts[match.id];
  const state = preference ? (preference.enabled ? 'on' : 'muted') : 'team';
  const ended = match.status === 'fulltime';
  const cancelled = match.status === 'cancelled';
  const postponed = match.status === 'postponed';
  const closed = ended || cancelled;
  const followed = [match.home, match.away].filter((team) => settings.favorites.includes(team.id));
  const defaultTypes = [
    settings.reminders && `${settings.reminderMinutes}-minute reminders`,
    settings.starts && 'match start',
    settings.goals && 'goals',
  ].filter(Boolean);
  const defaultDescription =
    followed.length === 0
      ? 'No alerts: you don’t follow either team.'
      : defaultTypes.length === 0
        ? 'No alerts: all team alert types are off in Settings.'
        : `Alerts for ${defaultTypes.join(', ')} because you follow ${followed.map((team) => team.name).join(' and ')}.`;
  const base =
    state === 'on'
      ? 'Kick-off reminders, match start and goal alerts are on for this match.'
      : state === 'muted'
        ? 'No alerts for this match, even for followed clubs.'
        : defaultDescription;
  // A cancelled match has not "ended", and a postponed one can still alert later.
  const description = ended
    ? 'This match has ended.'
    : cancelled
      ? closedNote(match)
      : postponed
        ? 'This match is postponed; alerts resume if it is rescheduled.'
        : base;
  return {
    defaultDescription,
    state,
    ended,
    cancelled,
    closed,
    postponed,
    description,
    enabled: state === 'on',
    label: state === 'on' ? 'On' : state === 'muted' ? 'Muted' : 'Team default',
  };
}

export function MatchCard({
  match,
  settings,
  onOpen,
  showCompetition = false,
  now,
  scoreChange,
}: {
  match: Match;
  settings: Settings;
  onOpen: () => void;
  showCompetition?: boolean;
  now?: Date;
  scoreChange?: { home: boolean; away: boolean };
}) {
  const alerts = alertPresentation(settings, match);
  const detailId = useId();
  const openButton = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const awaitingUpdate = match.status === 'scheduled' && awaitingKickoffUpdate(match.kickoff, now);
  const shootout = shootoutResult(match);
  const cardDetail =
    (match.status === 'scheduled'
      ? `Kick-off ${timeLabel(match.kickoff)}${awaitingUpdate ? ', awaiting match update' : ''}`
      : `${match.homeScore ?? '–'} to ${match.awayScore ?? '–'}, ${isLive(match) ? (match.status === 'halftime' ? 'half-time' : clockText(match.detail || 'live')) : match.detail || match.status}${match.scoreStale ? ' (saved)' : ''}`) +
    (showCompetition ? `, ${match.league === 'championsLeague' ? 'Champions League' : 'Premier League'}` : '') +
    (shootout ? `, ${shootout.outcome}` : '') +
    (scoreChange ? ', score just changed' : '');
  const winner = resultWinner(match);
  const loser = winner ? match[winner === 'home' ? 'away' : 'home'].id : null;
  const openMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    // The keyboard context-menu key reports 0,0; anchor to the card instead.
    const card = openButton.current?.getBoundingClientRect();
    setMenu(
      event.clientX || event.clientY
        ? { x: event.clientX, y: event.clientY }
        : { x: (card?.left ?? 0) + 24, y: (card?.bottom ?? 0) - 8 },
    );
  };
  return (
    <article
      className={'match-row match-card' + (scoreChange ? ' score-changed' : '')}
      data-match-id={match.id}
      aria-labelledby={matchButtonId(match.id)}
      onContextMenu={openMenu}
    >
      <button
        ref={openButton}
        id={matchButtonId(match.id)}
        className="match-open"
        onClick={onOpen}
        aria-describedby={detailId}
        title={scoreChange ? 'Score just changed · view match details' : 'View match details · right-click for more'}
      >
        <span className="sr-only">Match details: </span>
        <div className={'fixture-time ' + (isLive(match) && !match.scoreStale ? 'is-live' : '')}>
          <span>
            {match.status === 'scheduled'
              ? timeLabel(match.kickoff)
              : isLive(match)
                ? match.status === 'halftime'
                  ? 'HT'
                  : clockText(match.detail || 'LIVE')
                : match.status === 'fulltime'
                  ? resultLabel(match)
                  : match.detail || match.status}
          </span>
          {shootout && (
            <small title={shootout.outcome} aria-hidden="true">
              {shootout.tally}
            </small>
          )}
          {match.scoreStale && <small>Saved</small>}
          {awaitingUpdate && <small>Awaiting update</small>}
          {showCompetition && (
            <small className="competition-tag">{match.league === 'championsLeague' ? 'UCL' : 'PL'}</small>
          )}
        </div>
        <div className="teams">
          {[match.home, match.away].map((team) => (
            <div className={'team-line' + (team.id === loser ? ' is-beaten' : '')} key={team.id}>
              <Badge team={team} />
              <span className="team-name" title={team.name}>
                {team.name}
              </span>
              {settings.favorites.includes(team.id) && (
                <Star aria-hidden="true" className="fav" size={11} fill="currentColor" />
              )}
            </div>
          ))}
        </div>
        <div className={'match-state ' + (isLive(match) && !match.scoreStale ? 'is-live' : '')}>
          <div className={'result ' + (match.status === 'scheduled' ? 'scheduled' : '')}>
            {match.status === 'scheduled' ? (
              <span className="scheduled-score" title={countdownLabel(match.kickoff, now) ?? undefined}>
                {shortCountdown(match.kickoff, now) ?? '–'}
              </span>
            ) : (
              <div className="scores">
                <strong
                  className={
                    [match.home.id === loser && 'is-beaten', scoreChange?.home && 'just-changed']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
                  {match.homeScore ?? '–'}
                </strong>
                <strong
                  className={
                    [match.away.id === loser && 'is-beaten', scoreChange?.away && 'just-changed']
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                >
                  {match.awayScore ?? '–'}
                </strong>
              </div>
            )}
          </div>
        </div>
      </button>
      <span id={detailId} className="sr-only">
        {cardDetail}
      </span>
      {!alerts.closed && <MatchAlertsButton match={match} settings={settings} list />}
      {menu && (
        <CardMenu
          match={match}
          settings={settings}
          at={menu}
          onOpen={onOpen}
          close={(refocus) => {
            setMenu(null);
            if (refocus) openButton.current?.focus();
          }}
        />
      )}
    </article>
  );
}

const scoreLine = (match: Match) =>
  match.status === 'scheduled'
    ? `${match.home.name} v ${match.away.name}, ${match.competition}, kick-off ${timeLabel(match.kickoff)}`
    : `${match.home.name} ${match.homeScore ?? '–'}–${match.awayScore ?? '–'} ${match.away.name} (${shootoutResult(match)?.outcome ?? (match.status === 'fulltime' ? resultLabel(match) : isLive(match) ? (match.status === 'halftime' ? 'HT' : clockText(match.detail || 'live')) : match.detail || match.status)}), ${match.competition}`;

/** Right-click (or context-menu key) shortcuts for one card: open, follow either club, copy the score. */
function CardMenu({
  match,
  settings,
  at,
  onOpen,
  close,
}: {
  match: Match;
  settings: Settings;
  at: { x: number; y: number };
  onOpen: () => void;
  close: (refocus: boolean) => void;
}) {
  const save = useApp((state) => state.save);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: at.y, left: at.x });
  useLayoutEffect(() => {
    const bounds = menu.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({
      top: Math.max(8, Math.min(at.y, window.innerHeight - bounds.height - 8)),
      left: Math.max(8, Math.min(at.x, window.innerWidth - bounds.width - 8)),
    });
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [at]);
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  }, [close]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) latestClose.current(false);
    };
    const blurred = () => latestClose.current(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('focusin', outside);
    window.addEventListener('blur', blurred);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('blur', blurred);
    };
  }, []);
  const run = (action: () => void) => () => {
    close(true);
    action();
  };
  const follow = (teamId: string) => {
    const following = settings.favorites.includes(teamId);
    void save({
      favorites: following ? settings.favorites.filter((id) => id !== teamId) : [...settings.favorites, teamId],
    });
  };
  const items = [
    { label: 'Open match details', icon: <PanelRightOpen size={14} />, action: onOpen },
    ...[match.home, match.away].map((team) => ({
      label: `${settings.favorites.includes(team.id) ? 'Unfollow' : 'Follow'} ${team.name}`,
      icon: <Star size={14} fill={settings.favorites.includes(team.id) ? 'currentColor' : 'none'} />,
      action: () => follow(team.id),
    })),
    {
      label: match.status === 'scheduled' ? 'Copy fixture' : 'Copy score',
      icon: <ClipboardCopy size={14} />,
      action: () => {
        void navigator.clipboard
          ?.writeText(scoreLine(match))
          .catch(() => useApp.setState({ error: 'Could not copy to the clipboard.' }));
      },
    },
  ];
  return (
    <div
      ref={menu}
      className="card-menu"
      role="menu"
      aria-label={`${match.home.name} versus ${match.away.name}`}
      style={position}
      onKeyDown={(event) => {
        const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const index = entries.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        } else if (event.key === 'Tab') {
          // Menus are not focus traps: Tab dismisses and carries focus in the
          // pressed direction — forward past the card, backward onto the
          // control before the menu.
          event.preventDefault();
          event.stopPropagation();
          close(false);
          const order = [
            ...document.querySelectorAll<HTMLElement>('button:not([disabled]), select, input, [tabindex="0"]'),
          ];
          const index = entries[0] ? order.indexOf(entries[0]) : -1;
          const target =
            index === -1
              ? menu.current?.closest('.match-card')?.querySelector<HTMLElement>('.alert-trigger, .match-open')
              : event.shiftKey
                ? order[Math.max(0, index - 1)]
                : order[index + entries.length];
          target?.focus({ preventScroll: true });
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          entries[(index + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          entries[event.key === 'Home' ? 0 : entries.length - 1]?.focus();
        }
      }}
    >
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" tabIndex={-1} onClick={run(item.action)}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function MatchAlertsButton({
  match,
  settings,
  list = false,
}: {
  match: Match;
  settings: Settings;
  list?: boolean;
}) {
  const save = useApp((state) => state.save);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const alerts = alertPresentation(settings, match);
  const [feedback, setFeedback] = useState('');
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !menu.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = menu.current.getBoundingClientRect();
      const below = anchor.bottom + 6;
      const top = below + bounds.height <= window.innerHeight - 12 ? below : anchor.top - bounds.height - 6;
      setPosition({
        top: Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12)),
        left: Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, feedback]);
  useEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !trigger.current?.parentElement?.contains(event.target)) setOpen(false);
    };
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof Node) || !trigger.current?.parentElement?.contains(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const persist = async (matchAlerts: Settings['matchAlerts'], label: string) => {
    setFeedback('Saving…');
    const saved = await save({ matchAlerts });
    setFeedback(saved ? `Match alerts: ${label}.` : 'Could not save alert preference. Please try again.');
  };
  const change = (enabled: boolean) => {
    void persist(
      { ...settings.matchAlerts, [match.id]: { enabled, expiresAt: alertExpiry(match.kickoff) } },
      enabled ? 'On' : 'Muted',
    );
  };
  const reset = () => {
    const next = { ...settings.matchAlerts };
    delete next[match.id];
    void persist(next, 'Team default');
  };
  if (alerts.closed) return null;
  return (
    <div className="alert-control">
      <button
        ref={trigger}
        className={'icon-button alert-trigger' + (list ? ' match-bell' : '')}
        data-alert-state={alerts.state}
        aria-label={`Match alerts: ${match.home.name} versus ${match.away.name}, ${alerts.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={titleFor(alerts)}
        onClick={() => setOpen((value) => !value)}
      >
        {alerts.enabled ? (
          <BellRing size={17} fill="currentColor" />
        ) : alerts.state === 'muted' ? (
          <BellOff size={17} />
        ) : (
          <Bell size={17} />
        )}
      </button>
      {open && (
        <div
          ref={menu}
          className="alert-menu"
          style={position}
          role="dialog"
          aria-labelledby={menuId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <div className="alert-menu-head">
            <h3 id={menuId} ref={heading} tabIndex={-1}>
              Match alerts
            </h3>
          </div>
          <p className="field-note">
            {match.home.name} vs {match.away.name}
          </p>
          {alerts.postponed && <p className="field-note">{alerts.description}</p>}
          <div className="alert-options">
            <div className="alert-option">
              <button
                className="outline-button"
                aria-labelledby={`${menuId}-team`}
                aria-describedby={`${menuId}-team-description`}
                aria-pressed={alerts.state === 'team'}
                onClick={reset}
              >
                <strong id={`${menuId}-team`}>Team default</strong>
              </button>
              <small id={`${menuId}-team-description`}>{alerts.defaultDescription}</small>
            </div>
            <div className="alert-option">
              <button
                className="outline-button"
                aria-labelledby={`${menuId}-on`}
                aria-describedby={`${menuId}-on-description`}
                aria-pressed={alerts.state === 'on'}
                onClick={() => change(true)}
              >
                <strong id={`${menuId}-on`}>On</strong>
              </button>
              <small id={`${menuId}-on-description`}>
                Reminders, match start and goals, even if you don’t follow either team.
              </small>
            </div>
            <div className="alert-option">
              <button
                className="outline-button"
                aria-labelledby={`${menuId}-muted`}
                aria-describedby={`${menuId}-muted-description`}
                aria-pressed={alerts.state === 'muted'}
                onClick={() => change(false)}
              >
                <strong id={`${menuId}-muted`}>Muted</strong>
              </button>
              <small id={`${menuId}-muted-description`}>No alerts for this match, even for followed clubs.</small>
            </div>
          </div>
          <p className="field-note alert-feedback" role="status">
            {feedback}
          </p>
        </div>
      )}
    </div>
  );
}

// Tooltip for the details-header bell only; the list-card bell keeps its own title.
function titleFor(alerts: ReturnType<typeof alertPresentation>) {
  if (alerts.closed) return alerts.description;
  if (alerts.enabled) return 'Match alerts: On';
  if (alerts.state === 'muted') return 'Match alerts: Muted';
  return 'Match alerts: Team default';
}
