import { MapPin, Users, Landmark, Flag } from 'lucide-react';
import type { Match } from '../types';
import type { MatchScorer, MatchSummary } from '../useMatchSummary';
import { MatchEvents } from './MatchEvents';
import { isGoal, isIncident } from './matchEventKinds';

function goalScorers(data:MatchSummary|null):MatchScorer[] {
  const goals=data?.events.filter(event=>isGoal(event.kind))??[];
  // Some cached summaries predate scorer rows. Use structured participants only.
  const fallback=goals.flatMap(event=>event.teamId&&event.participants?.[0]?[{
    teamId:event.teamId,teamName:'',name:event.participants[0],minute:event.minute,
    ownGoal:event.kind==='own-goal',penalty:/^penalty/.test(event.kind),
  }]:[]);
  const unique=new Map<string,MatchScorer>();
  for(const scorer of [...(data?.scorers??[]),...fallback]) {
    const key=`${scorer.teamId}:${scorer.name}:${scorer.minute.replace(/[′']/g,'')}`;
    if(!unique.has(key)) unique.set(key,scorer);
  }
  return [...unique.values()];
}

export function MatchOverview({match,data}:{match:Match;data:MatchSummary|null}) {
  const scorers=goalScorers(data);
  const playing=['live','halftime','fulltime','suspended'].includes(match.status);
  const hasGoals=scorers.length>0||(match.homeScore??0)+(match.awayScore??0)>0;
  const incidents=(data?.events??[]).filter(event=>isIncident(event.kind));
  return <article className="overview-report" aria-label="Match overview">
    {!!incidents.length&&<MatchEvents match={match} events={incidents}/>}
    {playing&&!incidents.some(event=>isGoal(event.kind))&&(hasGoals?<div className="overview-scorers" aria-label="Goalscorers">{[match.home,match.away].map((team,index)=>{
      const grouped=new Map<string,string[]>();
      for(const scorer of scorers.filter(scorer=>scorer.teamId===team.id)) {
        const minutes=grouped.get(scorer.name)??[];
        const minute=scorer.minute?`${scorer.minute.replace(/[′']$/,'')}′`:'Time unavailable';
        minutes.push(`${minute}${scorer.penalty?' (pen)':''}${scorer.ownGoal?' (OG)':''}`);
        grouped.set(scorer.name,minutes);
      }
      const score=index===0?match.homeScore:match.awayScore;
      return <section key={team.id} aria-label={`${team.name} scorers`}><span className="overview-team" title={team.name}>{team.short}</span>
        {grouped.size?<ul>{[...grouped].map(([name,minutes])=><li key={name}><strong>{name}</strong><span>{minutes.join(', ')}</span></li>)}</ul>:<p>{score===0?'No goals':'Scorers unavailable'}</p>}
      </section>;
    })}</div>:<p className="overview-goalless">{match.status==='fulltime'?'No goals in this match.':'No goals yet.'}</p>)}
    <section className="match-information" aria-label="Match information"><h3>Match information</h3><dl>
      <div><dt><Flag size={13} aria-hidden="true"/>Referee</dt><dd>{data?.referee||'Not provided'}</dd></div>
      <div><dt><MapPin size={13} aria-hidden="true"/>Stadium</dt><dd>{data?.venue?`${data.venue}${data.venueCity?` (${data.venueCity})`:''}`:'Not provided'}</dd></div>
      <div><dt><Landmark size={13} aria-hidden="true"/>Capacity</dt><dd>{data?.capacity?.toLocaleString()??'Not provided'}</dd></div>
      <div><dt><Users size={13} aria-hidden="true"/>Attendance</dt><dd>{data?.attendance?.toLocaleString()??'Not provided'}</dd></div>
    </dl></section>
    {match.status==='scheduled'&&<p className="field-note">Lineups and match coverage will appear when available.</p>}
    {match.status==='postponed'&&<p className="field-note">This match has been postponed.</p>}
    {match.status==='cancelled'&&<p className="field-note">This match was cancelled.</p>}
    {match.status==='unknown'&&<p className="field-note">Match status is unavailable. Check back for updates.</p>}
  </article>;
}
