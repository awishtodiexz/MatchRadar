import { MatchCentre } from './MatchCentre';
import type { Match, Settings } from '../types';
import { isLive } from '../fixtures';
import { Badge, LeagueMark, ViewHeading } from './WidgetUi';
import { dateLabel, timeLabel } from '../presentation';
import { MatchAlertPanel } from './MatchCard';

export function MatchDetails({match, settings, back}: {match:Match; settings:Settings; back:()=>void}) {
  return <>
    <ViewHeading title="Match details" eyebrow="MATCH CENTRE" back={back}/>
    <div className="detail-body">
      <div className="detail-league"><LeagueMark/>{match.competition}</div>
      <div className="versus">
        <div><Badge team={match.home}/><b title={match.home.name}>{match.home.name}</b></div>
        <div className="detail-score">{match.status==='scheduled'?timeLabel(match.kickoff):`${match.homeScore ?? '–'} : ${match.awayScore ?? '–'}`}<small className={isLive(match)&&!match.scoreStale?'live-text':''}>{match.detail || match.status}{match.scoreStale?' · saved':''}</small></div>
        <div><Badge team={match.away}/><b title={match.away.name}>{match.away.name}</b></div>
      </div>
      <p className="detail-date"><time dateTime={match.kickoff}>{dateLabel(match.kickoff)} · {timeLabel(match.kickoff)}</time> local time</p>
      <MatchCentre key={match.id} match={match} demo={settings.mock || match.id.startsWith("demo-")}/>
      <MatchAlertPanel match={match} settings={settings}/>
    </div>
  </>;
}
