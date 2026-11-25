import type { Match } from '../types';
import { Badge } from './WidgetUi';
import { relativeDay, resultLabel, shootoutResult, timeLabel } from '../presentation';
import { teamCode } from '../teams';
import { isInProgress } from '../fixtures';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { awaitingKickoffUpdate } from '../countdown';

// Slim ticker mode: one match, a draggable strip above it, and a single click to expand.
export function TickerView({
  match,
  followedOnly,
  feedError,
  onExpand,
  onOpen,
  navigation,
}: {
  match: Match | null;
  followedOnly?: boolean;
  feedError?: string | null;
  onExpand: () => void;
  onOpen?: () => void;
  navigation?: { canCycle: boolean; onPrevious: () => void; onNext: () => void };
}) {
  if (!match)
    return (
      <section className="ticker" aria-label="Match ticker" data-tauri-drag-region>
        <p className="ticker-empty" role={feedError ? 'alert' : undefined}>
          {feedError ??
            (followedOnly ? 'No live or upcoming matches for followed clubs' : 'No live or upcoming matches')}
        </p>
        <button className="ticker-card ticker-card-empty" onClick={onExpand} title="Expand MatchRadar">
          Open MatchRadar
        </button>
      </section>
    );
  const home = teamCode(match.home) || match.home.name;
  const away = teamCode(match.away) || match.away.name;
  // The accessible name must contain the visible codes (WCAG 2.5.3) as well as
  // the full names, so say "Arsenal (ARS)" unless the code fell back to the name.
  const labelled = (name: string, shown: string) => (shown === name ? name : `${name} (${shown})`);
  const score = `${match.homeScore ?? '–'} – ${match.awayScore ?? '–'}`;
  const live = match.status === 'live' || match.status === 'halftime';
  const shootout = shootoutResult(match);
  const centre =
    match.status === 'scheduled' ? (
      <>
        <strong className="ticker-score">{timeLabel(match.kickoff)}</strong>
        <span className="ticker-meta">
          {awaitingKickoffUpdate(match.kickoff) ? 'Awaiting update' : relativeDay(match.kickoff)}
        </span>
      </>
    ) : isInProgress(match) ? (
      <>
        <strong className="ticker-score">{score}</strong>
        <span className="ticker-meta">
          {live && !match.scoreStale && <i className="dot" />}
          {match.scoreStale ? 'SAVED · ' : ''}
          {match.status === 'halftime' ? 'HT' : (match.detail || match.status).toUpperCase()}
        </span>
      </>
    ) : match.status === 'fulltime' ? (
      <>
        <strong className="ticker-score">{score}</strong>
        {shootout ? (
          <span className="ticker-meta">PEN {shootout.tally}</span>
        ) : (
          <span className="ticker-meta">{resultLabel(match)}</span>
        )}
      </>
    ) : (
      <>
        <strong className="ticker-score">{timeLabel(match.kickoff)}</strong>
        <span className="ticker-meta">{(match.detail || match.status).toUpperCase()}</span>
      </>
    );
  return (
    <section className="ticker" aria-label="Match ticker" data-tauri-drag-region>
      <div className="ticker-stage">
        {navigation && (
          <button
            className="ticker-step"
            aria-label="Previous ticker match"
            title="Previous match"
            disabled={!navigation.canCycle}
            onClick={navigation.onPrevious}
          >
            <ChevronLeft size={14} />
          </button>
        )}
        <button
          className="ticker-card"
          onClick={onOpen ?? onExpand}
          title={onOpen ? 'Open this match in MatchRadar' : 'Expand MatchRadar'}
        >
          {/* The team code sits beside the crest, so a missing crest shows nothing rather than the code twice. */}
          <Badge team={match.home} fallback={false} />
          <span className="ticker-team home">{home}</span>
          <span className={'ticker-centre' + (live && !match.scoreStale ? ' is-live' : '')}>{centre}</span>
          <span className="ticker-team away">{away}</span>
          <Badge team={match.away} fallback={false} />
          {/* Content-derived name: visible codes stay in it verbatim (2.5.3) and
              the descriptive sentence follows as sr-only detail. */}
          <span className="sr-only">
            {`. ${
              `${labelled(match.home.name, home)} versus ${labelled(match.away.name, away)}, ` +
              (match.status === 'scheduled'
                ? `kickoff ${timeLabel(match.kickoff)}`
                : `score ${score}, ${match.detail || match.status}`) +
              (shootout ? `, ${shootout.outcome}` : '') +
              (match.scoreStale ? ', saved score' : '') +
              (onOpen ? '. Open this match' : '. Expand MatchRadar')
            }`}
          </span>
        </button>
        {navigation && (
          <button
            className="ticker-step"
            aria-label="Next ticker match"
            title="Next match"
            disabled={!navigation.canCycle}
            onClick={navigation.onNext}
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
}
