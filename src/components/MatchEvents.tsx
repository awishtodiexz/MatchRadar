import { ArrowLeftRight, Flag, MonitorPlay, Play, Square } from 'lucide-react';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

type Event = MatchSummary['events'][number];
import { eventLabel, isGoal, isCard, isSubstitution, isVarReview } from './matchEventKinds';
export { keyEvent } from './matchEventKinds';
const periodLabel = (period:number) => period===0?'Before match':period===1?'First half':period===2?'Second half':period===3?'Extra time · first half':period===4?'Extra time · second half':'Penalties';

// Provider clock values can disagree with the minute it displays. Added-time
// commentary often carries elapsed seconds past the recorded final whistle
// (e.g. 90'+4' = 5632) while the final whistle is capped at 5400. Order by the
// minute the provider shows, then use the numeric clock only as a tie-breaker.
const minuteSeconds = (minute:string) => {
  const match=/^\s*(\d+)(?:\s*[′']?\s*\+\s*(\d+))?/.exec(minute);
  if(!match) return null;
  return Number(match[1])*60+Number(match[2]??0);
};
const eventSeconds = (event:Event) => minuteSeconds(event.minute)??event.seconds;
const chronological = (events:Event[]) => [...events].sort((a,b)=>a.period-b.period||eventSeconds(a)-eventSeconds(b)||a.seconds-b.seconds||a.id.localeCompare(b.id));

function EventIcon({kind}:{kind:string}) {
  const props = {size:13,'aria-hidden':true} as const;
  if(isVarReview(kind)) return <MonitorPlay {...props}/>;
  if(/\bred\b|yellow|card/i.test(kind)) return <Square {...props} fill="currentColor"/>;
  if(/sub/i.test(kind)) return <ArrowLeftRight {...props}/>;
  if(/goal|penalty/i.test(kind)) return <svg className="football-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="10.5" fill="#f3f6f7" stroke="#59666d" strokeWidth="1"/>
    <path d="M12 7 16.8 10.5 15 16H9l-1.8-5.5Z M8.5 2.1l1.2 3h4.6l1.2-3 M21.4 7.3l-3.2.5-1.4 4.4 2.5 2.2 3.1-1 M18.8 20.1l-.6-3.2-3.7 2.7-.4 2.7 M5.2 20.1l.6-3.2 3.7 2.7.4 2.7 M2.6 7.3l3.2.5 1.4 4.4-2.5 2.2-3.1-1" fill="#172128"/>
    <path d="m12 7 0-2 M16.8 10.5l1.4-2.7 M15 16l-.5 3.6 M9 16l.5 3.6 M7.2 10.5 5.8 7.8" fill="none" stroke="#59666d" strokeWidth=".8"/>
  </svg>;
  if(/kickoff/i.test(kind)) return <Play {...props}/>;
  return <Flag {...props}/>;
}

export function MatchEvents({match,events,commentary=false,groupByPeriod=true,newestFirst=true}:{match:Match;events:Event[];commentary?:boolean;groupByPeriod?:boolean;newestFirst?:boolean}) {
  const ordered = chronological(events);
  const goals=ordered.filter(event=>isGoal(event.kind));
  const complete=!match.scoreStale&&match.homeScore!=null&&match.awayScore!=null
    &&!goals.some(event=>event.period>=5||event.kind==='own-goal')
    &&goals.filter(event=>event.teamId===match.home.id).length===match.homeScore
    &&goals.filter(event=>event.teamId===match.away.id).length===match.awayScore;
  const scores=new Map<string,string>();
  let home=0,away=0;
  if(complete) for(const goal of goals) {
    if(goal.teamId===match.home.id)home++;else if(goal.teamId===match.away.id)away++;
    scores.set(goal.id,`${home}–${away}`);
  }
  if(commentary&&newestFirst) ordered.reverse();
  const periods = groupByPeriod?[...new Set(ordered.map(event=>event.period))]:[0];
  return <div className={commentary?'commentary':'match-events'}>{periods.map(period=><section key={period}>
    {groupByPeriod&&<h4 className="timeline-period"><span>{periodLabel(period)}</span>{!commentary&&complete&&period>0&&<small aria-label="Period score">{goals.filter(event=>event.period===period&&event.teamId===match.home.id).length}–{goals.filter(event=>event.period===period&&event.teamId===match.away.id).length}</small>}</h4>}
    <ol className="event-list">{ordered.filter(event=>!groupByPeriod||event.period===period).map(event=>{
      const side = event.teamId===match.home.id?'home':event.teamId===match.away.id?'away':'neutral';
      const team = side==='home'?match.home:side==='away'?match.away:null;
      const kindClass = /red|second-yellow/i.test(event.kind)&&isCard(event.kind)?'red':isCard(event.kind)?'yellow':isGoal(event.kind)?'goal':'';
      const names = event.participants??[];
      const label = names[0] || event.shortText || (event.kind==='kickoff'?'Kick-off':event.text.length<=65?event.text:eventLabel(event.kind));
      return <li key={event.id} className={'event '+side+' '+kindClass} title={commentary?undefined:event.text} aria-label={commentary?undefined:`${event.minute} ${team?.name??'Match'}: ${eventLabel(event.kind)}, ${label}${/sub/i.test(event.kind)&&names[1]?`, for ${names[1]}`:''}`}>
        <time>{event.minute || (event.kind==='kickoff'?"0'":'—')}</time>
        {commentary?<div className="event-body"><div className="event-meta"><span className="event-kind"><EventIcon kind={event.kind}/>{eventLabel(event.kind)}</span>{scores.has(event.id)&&<strong className="incident-score">{scores.get(event.id)}</strong>}{team&&<span className="event-team">{team.short}</span>}</div><p>{event.text}</p></div>:<>
          <span className="summary-icon" role="img" aria-label={eventLabel(event.kind)}><EventIcon kind={event.kind}/></span>
          <div className="summary-names"><span>{scores.has(event.id)&&<b className="incident-score">{scores.get(event.id)}</b>}{isSubstitution(event.kind)&&<small className="incident-tag sub-on">On </small>}<span className="incident-player">{label}</span>{/penalty.*scored/i.test(event.kind)&&<small className="incident-tag"> (pen)</small>}{event.kind==='own-goal'&&<small className="incident-tag"> (OG)</small>}</span>{isSubstitution(event.kind)&&<small><span className="sub-off">Off </span>{names[1]||'Player not provided'}{event.reason?` (${event.reason})`:''}</small>}{isCard(event.kind)&&<small>{eventLabel(event.kind)}{event.reason?` \u00b7 ${event.reason}`:''}</small>}{isGoal(event.kind)&&names[1]&&<small>Assist: {names[1]}</small>}</div>
          {team&&<span className="summary-team" title={team.name}>{team.short}</span>}
        </>}
      </li>;
    })}</ol>
  </section>)}</div>;
}
