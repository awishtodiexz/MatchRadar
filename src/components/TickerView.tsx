import type { Match } from '../types';
import { Badge } from './WidgetUi';
import { relativeDay, resultLabel, timeLabel } from '../presentation';
import { teamCode } from '../teams';
import { isInProgress } from '../fixtures';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { awaitingKickoffUpdate } from '../countdown';

// Slim ticker mode: one match, a draggable strip above it, and a single click to expand.
export function TickerView({match,onExpand,navigation}:{match:Match|null;onExpand:()=>void;navigation?:{canCycle:boolean;onPrevious:()=>void;onNext:()=>void}}) {
  if(!match) return <section className="ticker" aria-label="Match ticker" data-tauri-drag-region>
    <p className="ticker-empty">No live or upcoming matches</p>
    <button className="ticker-card ticker-card-empty" onClick={onExpand} title="Expand MatchRadar">Open MatchRadar</button>
  </section>;
  const home = teamCode(match.home) || match.home.name;
  const away = teamCode(match.away) || match.away.name;
  const score = `${match.homeScore ?? '–'} – ${match.awayScore ?? '–'}`;
  const live = match.status==='live'||match.status==='halftime';
  const centre = match.status==='scheduled' ? <>
      <strong className="ticker-score">{timeLabel(match.kickoff)}</strong>
      <span className="ticker-meta">{awaitingKickoffUpdate(match.kickoff)?'Awaiting update':relativeDay(match.kickoff)}</span>
    </> : isInProgress(match) ? <>
      <strong className="ticker-score">{score}</strong>
      <span className="ticker-meta">{live&&!match.scoreStale&&<i className="dot"/>}{match.scoreStale?'SAVED · ':''}{match.status==='halftime'?'HT':(match.detail||match.status).toUpperCase()}</span>
    </> : match.status==='fulltime' ? <>
      <strong className="ticker-score">{score}</strong>
      <span className="ticker-meta">{resultLabel(match)}</span>
    </> : <>
      <strong className="ticker-score">{timeLabel(match.kickoff)}</strong>
      <span className="ticker-meta">{(match.detail||match.status).toUpperCase()}</span>
    </>;
  return <section className="ticker" aria-label="Match ticker" data-tauri-drag-region>
    <div className="ticker-stage">
    {navigation&&<button className="ticker-step" aria-label="Previous ticker match" title="Previous match · locks your selection" disabled={!navigation.canCycle} onClick={navigation.onPrevious}><ChevronLeft size={14}/></button>}
    <button className="ticker-card" onClick={onExpand} title="Expand MatchRadar">
      <Badge team={match.home}/>
      <span className="ticker-team home">{home}</span>
      <span className={'ticker-centre'+(live&&!match.scoreStale?' is-live':'')}>{centre}</span>
      <span className="ticker-team away">{away}</span>
      <Badge team={match.away}/>
    </button>
    {navigation&&<button className="ticker-step" aria-label="Next ticker match" title="Next match · locks your selection" disabled={!navigation.canCycle} onClick={navigation.onNext}><ChevronRight size={14}/></button>}
    </div>
  </section>;
}
