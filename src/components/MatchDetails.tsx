import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { ArrowLeft, Star } from 'lucide-react';
import { useApp } from '../store';
import { MatchCentreView } from './MatchCentre';
import type { Match, Settings, Team } from '../types';
import { isLive } from '../fixtures';
import { Badge, CompetitionMark } from './WidgetUi';
import {
  dateLabel,
  resultLabel,
  resultWinner,
  shootoutResult,
  relativeDay,
  timeLabel,
  timeParts,
} from '../presentation';
import { MatchAlertsButton } from './MatchCard';
import { useMatchSummary, type MatchSummary } from '../useMatchSummary';
import { countdownLabel, timezoneLabel, useNow } from '../countdown';
import { teamCode } from '../teams';
import { createMatchMemory } from '../matchMemory';
import type { MatchMemory, MatchSection } from '../matchMemory';

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// 1st, 2nd, 3rd, 4th … 11th–13th take "th".
const ordinal = (n: number) =>
  `${n}${(n % 100 >= 11 && n % 100 <= 13) || n % 10 > 3 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10]}`;

// Only this line re-renders on the 15s tick, not the whole detail view.
function Countdown({ kickoff }: { kickoff: string }) {
  const now = useNow(15000);
  const label = countdownLabel(kickoff, now);
  const tz = timezoneLabel(now);
  return label ? (
    <>
      <span className="countdown" aria-live="off">
        {label}
      </span>
      <span className="tz-badge" title={`Times shown in your local time zone (${zone})`}>
        {tz === 'Local' ? 'Local time' : `Local time · ${tz}`}
      </span>
    </>
  ) : (
    <time dateTime={kickoff}>{dateLabel(kickoff)}</time>
  );
}

// Renders nothing unless the summary carries a valid table row for this club.
// Standings are the current table, not the table at kick-off, so past matches say "now".
function TablePill({
  team,
  standings,
  current,
}: {
  team: Team;
  standings?: MatchSummary['standings'];
  current: boolean;
}) {
  const row = standings?.find((s) => s.teamId === team.id);
  if (!row || !Number.isInteger(row.rank) || row.rank < 1 || !Number.isInteger(row.points)) return null;
  const played =
    row.played != null && Number.isInteger(row.played)
      ? ` from ${row.played} ${row.played === 1 ? 'match' : 'matches'}`
      : '';
  const points = `${row.points} ${row.points === 1 ? 'point' : 'points'}`;
  return (
    <span
      className="table-pill"
      title={`${ordinal(row.rank)} in the ${current ? 'current ' : ''}table · ${points}${played}`}
    >
      {current && 'Now '}
      {ordinal(row.rank)} · {row.points} {row.points === 1 ? 'pt' : 'pts'}
    </span>
  );
}

export interface MatchDetailsHandle {
  refresh: () => void;
}

export function MatchDetails({
  match,
  settings,
  back,
  ref,
  onBusyChange,
  sessions,
}: {
  match: Match;
  settings: Settings;
  back: () => void;
  ref?: Ref<MatchDetailsHandle>;
  onBusyChange?: (busy: boolean) => void;
  sessions?: Map<string, MatchMemory>;
}) {
  const save = useApp((state) => state.save);
  const [memory] = useState(() => sessions?.get(match.id) ?? createMatchMemory());
  useEffect(() => {
    sessions?.set(match.id, memory);
  }, [sessions, match.id, memory]);
  const [section, setSection] = useState(memory.view.section);
  const [collapsed, setCollapsed] = useState(false);
  const lineupView = section === 'Lineups';
  const hero = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const restoredSection = useRef<MatchSection | null>(null);
  const live = isLive(match);
  // Single summary owner for the page: the hero reads standings, the centre reads everything else.
  const summary = useMatchSummary(match.id, live, match.status === 'fulltime');
  useLayoutEffect(() => {
    if (restoredSection.current === section || (summary.loading && !summary.data) || !body.current) return;
    if (!summary.data && (memory.scroll[section] ?? 0) > 0) return;
    body.current.scrollTop = memory.scroll[section] ?? 0;
    restoredSection.current = section;
    setCollapsed(
      !lineupView && body.current.scrollTop > 0 && body.current.scrollTop >= (hero.current?.offsetHeight ?? 180) - 24,
    );
  }, [section, summary.loading, summary.data, memory, lineupView]);
  useImperativeHandle(ref, () => ({ refresh: summary.refresh }));
  useEffect(() => {
    onBusyChange?.(summary.loading || summary.refreshing);
    return () => onBusyChange?.(false);
  }, [summary.loading, summary.refreshing, onBusyChange]);
  const scheduled = match.status === 'scheduled';
  const status = live
    ? match.status === 'halftime'
      ? 'HALF-TIME'
      : `LIVE ${match.detail || ''}`.trim()
    : match.status === 'fulltime'
      ? { FT: 'FULL-TIME', AET: 'AFTER EXTRA TIME', PEN: 'AFTER PENALTIES', FF: 'FORFEIT' }[resultLabel(match)]
      : scheduled
        ? `Kick-off · ${relativeDay(match.kickoff)}`
        : (match.detail || match.status).toUpperCase();
  const statusText = match.scoreStale ? `${status} · Saved` : status;
  const awaitingScore = match.homeScore == null && match.awayScore == null;
  const showKickoff =
    scheduled ||
    (awaitingScore && (match.status === 'postponed' || match.status === 'cancelled' || match.status === 'unknown'));
  const score = showKickoff ? timeLabel(match.kickoff) : `${match.homeScore ?? '–'} – ${match.awayScore ?? '–'}`;
  const [clock, meridiem] = timeParts(score);
  const context = [match.leg, match.aggregate && `Aggregate ${match.aggregate}`].filter(Boolean).join(' · ');
  const winner = resultWinner(match);
  const shootout = shootoutResult(match);
  return (
    <>
      <div className="detail-route">
        <button className="back-link" onClick={back} aria-label="Back to matches" title="Back to matches (Esc)">
          <ArrowLeft size={16} />
          Matches
        </button>
        <h2 className="sr-only" data-view-heading tabIndex={-1}>
          Match details
        </h2>
        {collapsed || lineupView ? (
          <div
            className="mini-score"
            aria-label={`${match.home.name} ${score} ${match.away.name}, ${shootout?.outcome ?? statusText}`}
          >
            <Badge team={match.home} fallback={false} />
            <span>{teamCode(match.home)}</span>
            <div>
              <strong>{score}</strong>
              <small>{shootout ? `PEN ${shootout.tally}` : statusText}</small>
            </div>
            <span>{teamCode(match.away)}</span>
            <Badge team={match.away} fallback={false} />
          </div>
        ) : (
          <div className="detail-league">
            <CompetitionMark league={match.league} />
            <span>{match.competition}</span>
          </div>
        )}
        <MatchAlertsButton match={match} settings={settings} />
      </div>
      <div
        className="detail-body"
        ref={body}
        onScroll={(event) => {
          // Record every scroll, not only post-restore ones: a user who scrolls
          // while the summary is still loading must keep that position when the
          // restore pass arms, not be dragged back to the top.
          memory.scroll[section] = event.currentTarget.scrollTop;
          if (!lineupView)
            setCollapsed(
              event.currentTarget.scrollTop > 0 &&
                event.currentTarget.scrollTop >= (hero.current?.offsetHeight ?? 180) - 24,
            );
        }}
      >
        <div className={'detail-hero' + (live ? ' is-live' : '')} ref={hero} hidden={lineupView}>
          <div className="versus">
            <div className={winner === 'away' ? 'is-beaten' : undefined}>
              <span className="crest-ring">
                <Badge team={match.home} />
              </span>
              <span className="versus-name">
                <b title={`${match.home.name} · home`}>{match.home.name}</b>
                <FollowTeam team={match.home} settings={settings} save={save} />
              </span>
              <small className="sr-only">Home</small>
              <TablePill team={match.home} standings={summary.data?.standings} current={!scheduled && !live} />
            </div>
            <div className="detail-score">
              <span className={showKickoff ? 'is-time' : undefined}>
                {clock}
                {meridiem && <small>{meridiem}</small>}
              </span>
              <small className={'detail-status ' + match.status + (match.scoreStale ? ' saved' : '')}>
                {live && !match.scoreStale && <i className="dot" />}
                {statusText}
              </small>
            </div>
            <div className={winner === 'home' ? 'is-beaten' : undefined}>
              <span className="crest-ring">
                <Badge team={match.away} />
              </span>
              <span className="versus-name">
                <b title={`${match.away.name} · away`}>{match.away.name}</b>
                <FollowTeam team={match.away} settings={settings} save={save} />
              </span>
              <small className="sr-only">Away</small>
              <TablePill team={match.away} standings={summary.data?.standings} current={!scheduled && !live} />
            </div>
          </div>
          <p className="detail-date">
            {scheduled ? (
              <Countdown kickoff={match.kickoff} />
            ) : (
              <time dateTime={match.kickoff}>
                {dateLabel(match.kickoff)}
                {showKickoff ? '' : ` · ${timeLabel(match.kickoff)}`}
              </time>
            )}
            {context && <> · {context}</>}
            {shootout && (
              <>
                <br />
                <strong>{shootout.outcome}</strong>
              </>
            )}
          </p>
        </div>
        <MatchCentreView
          key={match.id}
          match={match}
          summary={summary}
          memory={memory}
          onSectionChange={(next) => {
            if (next === section) return;
            if (body.current) memory.scroll[section] = body.current.scrollTop;
            setSection(next);
            setCollapsed(false);
          }}
        />
      </div>
    </>
  );
}

function FollowTeam({
  team,
  settings,
  save,
}: {
  team: Team;
  settings: Settings;
  save: ReturnType<typeof useApp.getState>['save'];
}) {
  const following = settings.favorites.includes(team.id);
  return (
    <button
      type="button"
      className="icon-button follow-team"
      aria-pressed={following}
      aria-label={`${following ? 'Unfollow' : 'Follow'} ${team.name}`}
      title={following ? `Following ${team.name} · click to unfollow` : `Follow ${team.name}`}
      onClick={() =>
        void save({
          favorites: following ? settings.favorites.filter((id) => id !== team.id) : [...settings.favorites, team.id],
        })
      }
    >
      <Star size={14} aria-hidden="true" fill={following ? 'currentColor' : 'none'} />
    </button>
  );
}
