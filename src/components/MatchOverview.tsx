import { MapPin, Users, Flag, Clock, Trophy, Tv, Thermometer, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Match } from '../types';
import type { MatchScorer, MatchSummary } from '../useMatchSummary';
import { MatchEvents } from './MatchEvents';
import { isGoal, isIncident } from './matchEventKinds';
import { closedNote, formatMinute, isForfeit } from '../presentation';
import { teamCode } from '../teams';

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
  const text=(value:unknown)=>typeof value==='string'?value.trim():'';
  const competition=text(match.competition);
  const matchweek=data?.matchweek;
  const season=text(data?.seasonName).match(/\b(\d{4}[-–/]\d{2,4})\b/)?.[1];
  const competitionSub=typeof matchweek==='number'&&Number.isInteger(matchweek)&&matchweek>=1?`Matchweek ${matchweek}`:season?`Season ${season}`:text(match.leg);
  const broadcasts=(data?.broadcasts??[]).map(text).filter(Boolean);
  const celsius=typeof data?.weather?.temperatureF==='number'&&Number.isFinite(data.weather.temperatureF)?Math.round((data.weather.temperatureF-32)*5/9):null;
  const condition=text(data?.weather?.condition);
  const weatherRules:Array<[RegExp,ReactNode]>=[[/rain|shower|drizzle/i,<CloudRain size={14}/>],[/snow|sleet/i,<CloudSnow size={14}/>],[/storm|thunder/i,<CloudLightning size={14}/>],[/cloud|overcast/i,<Cloud size={14}/>],[/fog|mist|haze/i,<CloudFog size={14}/>],[/sun|clear/i,<Sun size={14}/>]];
  const weatherIcon=weatherRules.find(([pattern])=>pattern.test(condition))?.[1]??<Thermometer size={14}/>;
  const referee=text(data?.referee);
  const facts=[
    competition&&{key:'competition',icon:<Trophy size={14}/>,label:'Competition',value:competition,sub:competitionSub||undefined},
    data?.venue&&{key:'venue',icon:<MapPin size={14}/>,label:'Stadium',value:data.venue,sub:[data.venueCity,data.capacity&&`Capacity ${data.capacity.toLocaleString()}`].filter(Boolean).join(' · ')},
    !!broadcasts.length&&{key:'broadcast',icon:<Tv size={14}/>,label:'Broadcast',value:broadcasts.slice(0,3).join(' · '),sub:broadcasts.length>3?`+${broadcasts.length-3} more`:undefined,title:broadcasts.join(' · '),clamp:true},
    referee&&{key:'referee',icon:<Flag size={14}/>,label:'Referee',value:referee},
    (celsius!==null||condition)&&{key:'weather',icon:weatherIcon,label:'Kick-off weather',value:celsius!==null?`${celsius}°C`:condition,sub:celsius!==null&&condition?condition:undefined},
    data?.attendance!=null&&Number.isFinite(data.attendance)&&{key:'attendance',icon:<Users size={14}/>,label:'Attendance',value:data.attendance.toLocaleString()},
  ].filter(Boolean) as Array<{key:string;icon:ReactNode;label:string;value:string;sub?:string;title?:string;clamp?:boolean}>;
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
        const minute=scorer.minute?formatMinute(scorer.minute):'Time unavailable';
        minutes.push(`${minute}${scorer.penalty?' (pen)':''}${scorer.ownGoal?' (OG)':''}`);
        grouped.set(scorer.name,minutes);
      }
      const score=index===0?match.homeScore:match.awayScore;
      return <section key={team.id} aria-label={`${team.name} scorers`}><span className="overview-team" title={team.name}>{teamCode(team)}</span>
        {grouped.size?<ul>{[...grouped].map(([name,minutes])=><li key={name}><strong>{name}</strong><span>{minutes.join(', ')}</span></li>)}</ul>:<p>{score===0?'No goals':'Scorers unavailable'}</p>}
      </section>;
    })}</div>:<p className="overview-goalless">{match.status==='fulltime'?'No goals in this match.':'No goals yet.'}</p>}</OverviewCard>}
    {note&&<p className={'ov-hint'+(match.status==='scheduled'?'':' is-warning')}><Clock size={14} aria-hidden="true"/><span>{note}</span></p>}
    <OverviewCard title="Match information" label="Match information" className="match-information">
      {facts.length?<dl>{facts.map(fact=><div key={fact.key}>
        <dt><span className="ov-icon" aria-hidden="true">{fact.icon}</span>{fact.label}</dt>
        <dd title={fact.title} className={fact.clamp?'ov-clamp':undefined}><strong>{fact.value}</strong>{fact.sub&&<small>{fact.sub}</small>}</dd>
      </div>)}</dl>:<p className="ov-empty">Venue and officials have not been announced yet.</p>}
    </OverviewCard>
  </article>;
}
