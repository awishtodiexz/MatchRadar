import { useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { MatchCentre } from './MatchCentre';
import type { Match, Settings } from '../types';
import { isLive } from '../fixtures';
import { Badge, CompetitionMark } from './WidgetUi';
import { dateLabel, isForfeit, relativeDay, timeLabel, timeParts } from '../presentation';
import { MatchAlertsButton } from './MatchCard';

export function MatchDetails({match, settings, back}: {match:Match; settings:Settings; back:()=>void}) {
  const [collapsed,setCollapsed] = useState(false);
  const hero = useRef<HTMLDivElement>(null);
  const live = isLive(match);
  const scheduled = match.status==='scheduled';
  const status = live
    ? (match.status==='halftime'?'HALF-TIME':`LIVE ${match.detail || ''}`.trim())
    : match.status==='fulltime'?(isForfeit(match)?'FORFEIT':'FULL-TIME'):scheduled?`Kick-off · ${relativeDay(match.kickoff)}`:(match.detail||match.status).toUpperCase();
  const statusText = match.scoreStale ? `${status} · Saved` : status;
  const awaitingScore = match.homeScore==null&&match.awayScore==null;
  const showKickoff = scheduled||(awaitingScore&&(match.status==='postponed'||match.status==='cancelled'||match.status==='unknown'));
  const score = showKickoff?timeLabel(match.kickoff):`${match.homeScore ?? '–'} – ${match.awayScore ?? '–'}`;
  const [clock,meridiem] = timeParts(score);
  const context = [match.leg,match.aggregate&&`Aggregate ${match.aggregate}`].filter(Boolean).join(' · ');
  const winner = match.status==='fulltime'&&match.homeScore!=null&&match.awayScore!=null&&match.homeScore!==match.awayScore
    ? (match.homeScore>match.awayScore?'home':'away') : null;
  return <>
    <div className="detail-route">
      <button className="back-link" onClick={back} aria-label="Back to matches" title="Back to matches (Esc)"><ArrowLeft size={16}/>Matches</button>
      <h2 className="sr-only" data-view-heading tabIndex={-1}>Match details</h2>
      {collapsed?<div className="mini-score" aria-label={`${match.home.name} ${score} ${match.away.name}, ${statusText}`}><span>{match.home.short}</span><strong>{score}</strong><span>{match.away.short}</span></div>:<div className="detail-league"><CompetitionMark league={match.league}/><span>{match.competition}</span></div>}
      <MatchAlertsButton match={match} settings={settings}/>
    </div>
    <div className="detail-body" onScroll={event=>setCollapsed(event.currentTarget.scrollTop >= (hero.current?.offsetHeight??180)-24)}>
      <div className={'detail-hero'+(live?' is-live':'')} ref={hero}>
      <div className="versus">
        <div className={winner==='away'?'is-beaten':undefined}><span className="crest-ring"><Badge team={match.home}/></span><b title={match.home.name}>{match.home.name}</b><small>Home</small></div>
        <div className="detail-score">
          <span className={showKickoff?'is-time':undefined}>{clock}{meridiem&&<small>{meridiem}</small>}</span>
          <small className={'detail-status '+match.status+(match.scoreStale?' saved':'')}>{live&&!match.scoreStale&&<i className="dot"/>}{statusText}</small>
        </div>
        <div className={winner==='home'?'is-beaten':undefined}><span className="crest-ring"><Badge team={match.away}/></span><b title={match.away.name}>{match.away.name}</b><small>Away</small></div>
      </div>
      <p className="detail-date"><time dateTime={match.kickoff}>{dateLabel(match.kickoff)}{showKickoff?'':` · ${timeLabel(match.kickoff)}`}</time>{context&&<> · {context}</>}</p>
      </div>
      <MatchCentre key={match.id} match={match}/>
    </div>
  </>;
}
