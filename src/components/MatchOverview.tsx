import { MapPin, Users, Flag, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Match } from '../types';
import type { MatchScorer, MatchSummary } from '../useMatchSummary';
import { MatchEvents } from './MatchEvents';
import { isGoal, isIncident } from './matchEventKinds';
import { closedNote, isForfeit } from '../presentation';

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

/** A titled surface shared by every Overview section. */
export function OverviewCard({title,note,label,children,className=''}:{title:ReactNode;note?:ReactNode;label:string;children:ReactNode;className?:string}) {
  return <section className={'ov-card '+className} aria-label={label}>
    <header className="ov-card-head"><h3>{title}</h3>{note&&<span className="ov-card-note">{note}</span>}</header>
    {children}
  </section>;
}

export function MatchOverview({match,data}:{match:Match;data:MatchSummary|null}) {
  const scorers=goalScorers(data);
  // An awarded forfeit score has no goalscorers to report.
  const playing=['live','halftime','fulltime','suspended'].includes(match.status)&&!isForfeit(match);
  const hasGoals=scorers.length>0||(match.homeScore??0)+(match.awayScore??0)>0;
  const incidents=(data?.events??[]).filter(event=>isIncident(event.kind));
  // Only show facts the provider supplied; a column of "Not provided" is noise.
  const facts=[
    data?.venue&&{key:'venue',icon:<MapPin size={14}/>,label:'Stadium',value:data.venue,sub:[data.venueCity,data.capacity&&`Capacity ${data.capacity.toLocaleString()}`].filter(Boolean).join(' · ')},
    data?.referee&&{key:'referee',icon:<Flag size={14}/>,label:'Referee',value:data.referee},
    data?.attendance!=null&&{key:'attendance',icon:<Users size={14}/>,label:'Attendance',value:data.attendance.toLocaleString()},
  ].filter(Boolean) as Array<{key:string;icon:ReactNode;label:string;value:string;sub?:string}>;
  const note=match.status==='scheduled'?'Lineups and live coverage appear closer to kick-off.'
    :match.status==='postponed'?'This match has been postponed.'
    :match.status==='cancelled'?closedNote(match)
    :isForfeit(match)?'Result awarded by forfeit; the match was not played to completion.'
    :match.status==='unknown'?'Match status is unavailable. Check back for updates.':null;
  return <article className="overview-report" aria-label="Match overview">
    {!!incidents.length&&<OverviewCard title="Key moments" label="Key moments" className="ov-moments"><MatchEvents match={match} events={incidents}/></OverviewCard>}
    {playing&&!incidents.some(event=>isGoal(event.kind))&&<OverviewCard title="Goals" label="Goals">{hasGoals?<div className="overview-scorers" aria-label="Goalscorers">{[match.home,match.away].map((team,index)=>{
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
    })}</div>:<p className="overview-goalless">{match.status==='fulltime'?'No goals in this match.':'No goals yet.'}</p>}</OverviewCard>}
    {note&&<p className={'ov-hint'+(match.status==='scheduled'?'':' is-warning')}><Clock size={14} aria-hidden="true"/><span>{note}</span></p>}
    <OverviewCard title="Match information" label="Match information" className="match-information">
      {facts.length?<dl>{facts.map(fact=><div key={fact.key}>
        <dt><span className="ov-icon" aria-hidden="true">{fact.icon}</span>{fact.label}</dt>
        <dd><strong>{fact.value}</strong>{fact.sub&&<small>{fact.sub}</small>}</dd>
      </div>)}</dl>:<p className="ov-empty">Venue and officials have not been announced yet.</p>}
    </OverviewCard>
  </article>;
}
