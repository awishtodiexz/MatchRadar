import { useId, useState } from 'react';
import type { Match, Team } from '../types';
import { isLive } from '../fixtures';
import { useMatchSummary } from '../useMatchSummary';
import { MatchStats } from './MatchStats';
import { MatchLineups } from './MatchLineups';
import { Badge } from './WidgetUi';

const periodLabel = (period:number) => period<=1?'First half':period===2?'Second half':period<=4?'Extra time':'Penalties';
const kindLabel = (kind:string) => {
  const key = kind.toLowerCase();
  if(key.includes('goal')) return 'GOAL';
  if(key.includes('red')) return 'RED';
  if(key.includes('yellow')) return 'YELLOW';
  if(key.includes('sub')) return 'SUB';
  if(key.includes('shot on target')) return 'ON TARGET';
  if(key.includes('shot off target')) return 'OFF TARGET';
  if(key.includes('attempt saved')) return 'SAVED';
  if(key.includes('corner')) return 'CORNER';
  if(key.includes('offside')) return 'OFFSIDE';
  if(key.includes('foul')) return 'FOUL';
  if(key==='kickoff') return 'KICKOFF';
  if(key==='start-delay'||key==='end-delay') return '';
  return key.replaceAll('-',' ').toUpperCase().slice(0,20) || 'EVENT';
};
const kindClass = (kind:string) => kind.toLowerCase().replace(/[^a-z0-9-]/g,'');
const minuteLabel = (event:{minute:string;kind:string}) => event.minute || (event.kind==='kickoff'?"0'":'—');
const keyStats = [
  ['possessionPct','Possession'],
  ['totalShots','Shots'],
  ['shotsOnTarget','On target'],
  ['wonCorners','Corners']
] as const;

export function MatchCentre({match}:{match:Match}) {
  const summary = useMatchSummary(match.id,isLive(match));
  const {loading,error,retry}=summary;
  const data=summary.data;
  const [selected,setSelected]=useState('Overview');
  const tabs=['Overview',...(data?.events.length?['Timeline']:[]),...(data?.statistics.length?['Stats']:[]),...(data?.players.length?['Lineups']:[])];
  const tab=tabs.includes(selected)?selected:'Overview';
  const sectionId=useId();
  const teamFor=(id:string|null):Team|undefined=>id===match.home.id?match.home:id===match.away.id?match.away:undefined;
  const teamName=(id:string|null)=>teamFor(id)?.name??'Match';
  const scorers=data?.scorers??[];
  const events=data?.events??[];
  const recent=[...events].sort((a,b)=>a.period-b.period||a.seconds-b.seconds).slice(-3).reverse();
  const stats=keyStats.flatMap(([name,label])=>{
    const home=data?.statistics.find(stat=>stat.name===name&&stat.teamId===match.home.id);
    const away=data?.statistics.find(stat=>stat.name===name&&stat.teamId===match.away.id);
    return home||away?[{name,label,home:home?.value??'—',away:away?.value??'—'}]:[];
  });
  const periodGroups=[...new Set(events.map(event=>event.period))].sort((a,b)=>a-b).map(period=>({period,events:events.filter(event=>event.period===period)}));
  const goTo=(name:string)=>setSelected(name);
  return <section className="match-centre" aria-label="Match centre" aria-busy={loading}>
    <div className="centre-tabs" role="tablist" aria-label="Match centre sections">{tabs.map((name,index)=><button key={name} role="tab" id={sectionId+'-'+name} aria-controls={sectionId+'-panel'} aria-selected={tab===name} tabIndex={tab===name?0:-1} onClick={()=>setSelected(name)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:undefined;
      if(next===undefined)return;event.preventDefault();setSelected(tabs[next]);document.getElementById(sectionId+'-'+tabs[next])?.focus();
    }}>{name}</button>)}</div>
    <div role="tabpanel" id={sectionId+'-panel'} aria-labelledby={sectionId+'-'+tab} tabIndex={0}>
    {loading&&!data&&<div className="skeletons" role="status" aria-label="Loading match details"><div/></div>}
    {error&&<p role="status">{error} <button className="text-button" onClick={retry}>Retry details</button></p>}
    {data&&<p className="field-note">{data.stale?'Saved details':'Details checked'} · {new Date(data.updatedAt).toLocaleString()}{isLive(match)?' · live details refresh about every 60 seconds':''}</p>}
    {tab==='Overview'&&(!loading||data)&&<>
      {data?.venue&&<><h3>Venue</h3><p>{data.venue}</p></>}
      {match.status!=='scheduled'&&<>
        <h3>Goals</h3>
        {scorers.length?<ul className="goal-list">{scorers.map((scorer,index)=><li key={`${scorer.name}-${scorer.minute}-${index}`}>
          <span className="goal-minute">{scorer.minute}</span>
          {teamFor(scorer.teamId)&&<Badge team={teamFor(scorer.teamId)!}/>}
          <span className="goal-name">{scorer.name}</span>
          <small>{scorer.teamName||teamName(scorer.teamId)}{scorer.penalty?' · pen':''}{scorer.ownGoal?' · OG':''}</small>
        </li>)}</ul>:<p>No goals yet.</p>}
      </>}
      {!!stats.length&&<><h3>Key stats</h3><div className="overview-stats">{stats.map(row=><div className="overview-stat" key={row.name}><strong>{row.home}</strong><span>{row.label}</span><strong>{row.away}</strong></div>)}</div></>}
      {!!data?.events.length&&<><div className="section-line"><h3>Latest</h3><button className="text-button" onClick={()=>goTo('Timeline')}>Full timeline</button></div>
        <ol className="event-list compact-events">{recent.map(event=><li key={event.id}><time>{minuteLabel(event)}</time><div><small>{teamFor(event.teamId)?teamName(event.teamId)+' · ':''}{kindLabel(event.kind)}</small><p>{event.text}</p></div></li>)}</ol></>}
      {match.status==='scheduled'?!error&&<p>Match information will appear when available.</p>:(!error||!!data?.events.length)&&<p>{data?.events.length?`${data.events.length} ${data.events.length===1?'event':'events'} available in Timeline.`:'No event timeline is available for this match.'}</p>}
    </>}
    {tab==='Timeline'&&<div className="timeline">{periodGroups.map(group=><section key={group.period} aria-labelledby={sectionId+'-period-'+group.period}>
      <h4 id={sectionId+'-period-'+group.period} className="timeline-period">{periodLabel(group.period)}</h4>
      <ol className="event-list">{group.events.map(event=><li key={event.id} className={'event '+kindClass(event.kind)}>
        <time>{minuteLabel(event)}</time>
        <div className="event-body">
          <div className="event-meta">{teamFor(event.teamId)&&<><Badge team={teamFor(event.teamId)!}/><strong>{teamName(event.teamId)}</strong></>}{kindLabel(event.kind)&&<span className={'event-kind '+kindClass(event.kind)}>{kindLabel(event.kind)}</span>}</div>
          <p>{event.text}</p>
        </div>
      </li>)}</ol>
    </section>)}</div>}
    {tab==='Stats'&&data&&<MatchStats match={match} statistics={data.statistics}/>}
    {tab==='Lineups'&&data&&<MatchLineups match={match} players={data.players} formations={data.formations}/>}
    </div>
  </section>;
}
