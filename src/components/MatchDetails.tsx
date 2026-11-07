import { MatchCentre } from './MatchCentre';
import type { Match, Settings } from '../types';
import { isLive } from '../fixtures';
import { Badge, CompetitionMark, ViewHeading } from './WidgetUi';
import { dateLabel, timeLabel } from '../presentation';
import { MatchAlertsButton } from './MatchCard';

export function MatchDetails({match, settings, back}: {match:Match; settings:Settings; back:()=>void}) {
  const live = isLive(match);
  const status = live
    ? (match.status==='halftime'?'HALF-TIME':`LIVE ${match.detail || ''}`.trim())
    : match.status==='fulltime'?'FULL-TIME':match.status==='scheduled'?'SCHEDULED':(match.detail||match.status).toUpperCase();
  return <>
    <ViewHeading title="Match details" eyebrow="MATCH CENTRE" back={back} actions={<MatchAlertsButton match={match} settings={settings}/>}/>
    <div className="detail-body">
      <div className="detail-league"><CompetitionMark league={match.league}/>{match.competition}<span className={'match-status-pill '+match.status}>{live&&!match.scoreStale&&<i className="dot"/>}{status}</span></div>
      <div className="versus">
        <div><Badge team={match.home}/><b title={match.home.name}>{match.home.name}</b></div>
        <div className="detail-score">{match.status==='scheduled'?timeLabel(match.kickoff):`${match.homeScore ?? '–'} : ${match.awayScore ?? '–'}`}{match.scoreStale&&<small>Saved</small>}</div>
        <div><Badge team={match.away}/><b title={match.away.name}>{match.away.name}</b></div>
      </div>
      <p className="detail-date"><time dateTime={match.kickoff}>{dateLabel(match.kickoff)} · {timeLabel(match.kickoff)}</time> local time</p>
      <MatchCentre key={match.id} match={match}/>
    </div>
  </>;
}
