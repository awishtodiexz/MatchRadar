import type { Match } from '../types';
import { Badge } from './WidgetUi';
import { relativeDay, resultLabel, timeLabel } from '../presentation';
import { teamCode } from '../teams';

// Slim ticker mode: one match, a draggable strip above it, and a single click to expand.
export function TickerView({match,onExpand}:{match:Match|null;onExpand:()=>void}) {
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
      <span className="ticker-meta">{relativeDay(match.kickoff)}</span>
    </> : live ? <>
      <strong className="ticker-score">{score}</strong>
      <span className="ticker-meta"><i className="dot"/>{match.status==='halftime'?'HT':(match.detail||'LIVE').toUpperCase()}</span>
    </> : match.status==='fulltime' ? <>
      <strong className="ticker-score">{score}</strong>
      <span className="ticker-meta">{resultLabel(match)}</span>
    </> : <>
      <strong className="ticker-score">{timeLabel(match.kickoff)}</strong>
      <span className="ticker-meta">{(match.detail||match.status).toUpperCase()}</span>
    </>;
  return <section className="ticker" aria-label="Match ticker" data-tauri-drag-region>
    <button className="ticker-card" onClick={onExpand} title="Expand MatchRadar">
      <Badge team={match.home}/>
      <span className="ticker-team home">{home}</span>
      <span className={'ticker-centre'+(live?' is-live':'')}>{centre}</span>
      <span className="ticker-team away">{away}</span>
      <Badge team={match.away}/>
    </button>
  </section>;
}
