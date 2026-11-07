import { useId, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, ChevronRight, CircleDot, CornerDownRight, Crosshair, Flag, MapPin, Play, Square, Users } from 'lucide-react';
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
const statNumber = (value?:string) => {
  if(!value) return null;
  const cleaned=value.trim().replace(/[,\s%]/g,'');
  return /^-?\d*\.?\d+$/.test(cleaned)?Number.parseFloat(cleaned):null;
};
const statDisplay = (name:string,value?:string) => {
  if(value===undefined) return '—';
  if(name.endsWith('Pct')) {
    const n=statNumber(value);
    if(n!==null) return `${Number.isInteger(n)?n:Number(n.toFixed(1))}%`;
  }
  return value;
};
const keyKind = (kind:string) => /goal|card|sub|penalty|kickoff/i.test(kind);
const EventIcon = ({kind}:{kind:string}) => {
  const key=kind.toLowerCase();
  const props={size:10,'aria-hidden':true} as const;
  if(key.includes('goal')) return <CircleDot {...props}/>;
  if(key.includes('red')||key.includes('yellow')) return <Square {...props} fill="currentColor"/>;
  if(key.includes('sub')) return <ArrowLeftRight {...props}/>;
  if(key==='kickoff') return <Play {...props}/>;
  if(key.includes('corner')) return <CornerDownRight {...props}/>;
  if(key.includes('offside')) return <Flag {...props}/>;
  if(key.includes('foul')) return <AlertTriangle {...props}/>;
  if(key.includes('shot')||key.includes('saved')||key.includes('target')) return <Crosshair {...props}/>;
  return null;
};
const formScore = (score:string, atHome:boolean) => {
  const parts=score.split('-').map(Number);
  if(parts.length!==2||parts.some(n=>!Number.isFinite(n))) return score;
  return atHome?`${parts[0]}–${parts[1]}`:`${parts[1]}–${parts[0]}`;
};
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
  const [eventFilter,setEventFilter]=useState<'all'|'key'>('all');
  const tabs=['Overview',...(data?.events.length?['Timeline']:[]),...(data?.statistics.length?['Stats']:[]),...(data?.players.length?['Lineups']:[])];
  const tab=tabs.includes(selected)?selected:'Overview';
  const sectionId=useId();
  const teamFor=(id:string|null):Team|undefined=>id===match.home.id?match.home:id===match.away.id?match.away:undefined;
  const teamName=(id:string|null)=>teamFor(id)?.name??'Match';
  const scorers=data?.scorers??[];
  const events=data?.events??[];
  const visibleEvents=eventFilter==='key'?events.filter(event=>keyKind(event.kind)):events;
  const stats=keyStats.flatMap(([name,label])=>{
    const home=data?.statistics.find(stat=>stat.name===name&&stat.teamId===match.home.id);
    const away=data?.statistics.find(stat=>stat.name===name&&stat.teamId===match.away.id);
    const left=statNumber(home?.value),right=statNumber(away?.value);
    const peak=left!==null&&right!==null?Math.max(left,right):0;
    return home||away?[{
      name,label,
      home:statDisplay(name,home?.value),
      away:statDisplay(name,away?.value),
      leftWidth:left!==null&&peak>0?Math.round((left/peak)*100):0,
      rightWidth:right!==null&&peak>0?Math.round((right/peak)*100):0,
      homeLeads:left!==null&&right!==null&&left>right,
      awayLeads:left!==null&&right!==null&&right>left
    }]:[];
  });
  const teams=[match.home,match.away];
  const formTeams=teams.filter(team=>(data?.form?.[team.id]?.length??0)>0);
  const leaderTeams=teams.filter(team=>data?.leaders?.some(leader=>leader.teamId===team.id));
  const periodGroups=[...new Set(visibleEvents.map(event=>event.period))].sort((a,b)=>a-b).map(period=>({period,events:visibleEvents.filter(event=>event.period===period)}));
  const select=(name:string)=>{
    setSelected(name);
    requestAnimationFrame(()=>document.querySelector<HTMLElement>('.detail-body')?.scrollTo({top:0}));
  };
  return <section className="match-centre" aria-label="Match centre" aria-busy={loading}>
    <div className="centre-tabs" role="tablist" aria-label="Match centre sections">{tabs.map((name,index)=><button key={name} role="tab" id={sectionId+'-'+name} aria-controls={sectionId+'-panel'} aria-selected={tab===name} tabIndex={tab===name?0:-1} onClick={()=>select(name)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:undefined;
      if(next===undefined)return;event.preventDefault();select(tabs[next]);document.getElementById(sectionId+'-'+tabs[next])?.focus();
    }}>{name}</button>)}</div>
    <div role="tabpanel" id={sectionId+'-panel'} aria-labelledby={sectionId+'-'+tab} tabIndex={0}>
    {loading&&!data&&<div className="skeletons" role="status" aria-label="Loading match details"><div/></div>}
    {error&&<p role="status">{error} <button className="text-button" onClick={retry}>Retry details</button></p>}
    {data&&<p className="field-note">{data.stale?'Saved details':'Details checked'} · {new Date(data.updatedAt).toLocaleString()}{isLive(match)?' · live details refresh about every 60 seconds':''}</p>}
    {tab==='Overview'&&(!loading||data)&&<>
      {(data?.venue||data?.attendance)&&<div className="match-facts">
        {data.venue&&<div><MapPin size={13} aria-hidden="true"/><span>Venue</span><strong>{data.venue}</strong></div>}
        {data.attendance&&<div><Users size={13} aria-hidden="true"/><span>Attendance</span><strong>{data.attendance.toLocaleString()}</strong></div>}
      </div>}
      {match.status!=='scheduled'&&<>
        <h3>Goals</h3>
        {scorers.length?<ul className="goal-list">{scorers.map((scorer,index)=><li key={`${scorer.name}-${scorer.minute}-${index}`}>
          <span className="goal-minute">{scorer.minute}</span>
          {teamFor(scorer.teamId)&&<Badge team={teamFor(scorer.teamId)!}/>}
          <span className="goal-name">{scorer.name}</span>
          <small>{scorer.teamName||teamName(scorer.teamId)}{scorer.penalty?' · pen':''}{scorer.ownGoal?' · OG':''}</small>
        </li>)}</ul>:<p>{match.status==='fulltime'?'No goals in this match.':'No goals yet.'}</p>}
      </>}
      {!!stats.length&&<>
        <div className="section-line"><h3>Key stats</h3>{!!data?.statistics.length&&<button className="text-button" onClick={()=>select('Stats')}>All stats</button>}</div>
        <div className="overview-stats">{stats.map(row=><div className="overview-stat" key={row.name}>
          <strong>{row.home}</strong><span>{row.label}</span><strong>{row.away}</strong>
          <div className="stat-bar overview-bar" aria-hidden="true"><span className={'bar-home '+(row.homeLeads?'winning':'')}><i style={{width:`${row.leftWidth}%`}}/></span><span className={'bar-away '+(row.awayLeads?'winning':'')}><i style={{width:`${row.rightWidth}%`}}/></span></div>
        </div>)}</div>
      </>}
      {!!formTeams.length&&<>
        <h3>Form <small className="section-note">last five</small></h3>
        <div className="form-grid">{formTeams.map(team=>{
          const games=data?.form?.[team.id]??[];
          const latest=games[games.length-1];
          return <div className="form-team" key={team.id}>
            <div className="form-head"><Badge team={team}/><span title={team.name}>{team.short}</span><small>{team.name}</small></div>
            <div className="form-pills">{games.map((game,index)=><span key={`${game.opponentId}-${index}`} role="img"
              className={'form-pill '+game.result.toLowerCase()}
              title={`${game.atHome?'vs':'@'} ${game.opponent} · ${formScore(game.score,game.atHome)}`}
              aria-label={`${game.result==='W'?'Win':game.result==='L'?'Loss':'Draw'} ${game.atHome?'against':'at'} ${game.opponent}, ${formScore(game.score,game.atHome)}`}>{game.result}</span>)}</div>
            {latest&&<small className="form-last">{latest.atHome?'vs':'@'} {latest.opponent} · {formScore(latest.score,latest.atHome)}</small>}
          </div>;
        })}</div>
      </>}
      {!!leaderTeams.length&&<>
        <h3>Team leaders</h3>
        <div className="leaders-grid">{leaderTeams.map(team=>{
          const rows=data?.leaders?.filter(leader=>leader.teamId===team.id).slice(0,3)??[];
          return <div className="leader-team" key={team.id}>
            <div className="leader-head"><Badge team={team}/><span title={team.name}>{team.short}</span></div>
            <ul className="leader-list">{rows.map(leader=><li key={`${leader.category}-${leader.name}`}>
              <div><span>{leader.category}</span><strong title={leader.name}>{leader.jersey?`#${leader.jersey} `:''}{leader.name}</strong></div><b>{leader.value}</b>
            </li>)}</ul>
          </div>;
        })}</div>
      </>}
      {match.status==='scheduled'?!error&&<p>Match information will appear when available.</p>:events.length?<button className="overview-cta" onClick={()=>select('Timeline')}><span>Full timeline</span><small>{events.length} {events.length===1?'event':'events'}</small><ChevronRight size={14} aria-hidden="true"/></button>:<p>No event timeline is available for this match.</p>}
    </>}
    {tab==='Timeline'&&<>
      <div className="timeline-toolbar">
        <span>{visibleEvents.length} {visibleEvents.length===1?'event':'events'}</span>
        <div className="timeline-filter" role="group" aria-label="Timeline filter">
          <button aria-pressed={eventFilter==='all'} onClick={()=>setEventFilter('all')}>All</button>
          <button aria-pressed={eventFilter==='key'} onClick={()=>setEventFilter('key')}>Key events</button>
        </div>
      </div>
      {periodGroups.length?<div className="timeline">{periodGroups.map(group=><section key={group.period} aria-labelledby={sectionId+'-period-'+group.period}>
        <h4 id={sectionId+'-period-'+group.period} className="timeline-period">{periodLabel(group.period)}</h4>
        <ol className="event-list">{group.events.map(event=><li key={event.id} className={'event '+kindClass(event.kind)}>
          <time>{minuteLabel(event)}</time>
          <div className="event-body">
            <div className="event-meta">{teamFor(event.teamId)&&<><Badge team={teamFor(event.teamId)!}/><strong>{teamName(event.teamId)}</strong></>}{kindLabel(event.kind)&&<span className={'event-kind '+kindClass(event.kind)}><EventIcon kind={event.kind}/>{kindLabel(event.kind)}</span>}</div>
            <p>{event.text}</p>
          </div>
        </li>)}</ol>
      </section>)}</div>:<p className="field-note">No key events are available for this match.</p>}
    </>}
    {tab==='Stats'&&data&&<MatchStats match={match} statistics={data.statistics}/>}
    {tab==='Lineups'&&data&&<MatchLineups match={match} players={data.players} substitutions={data.substitutions} formations={data.formations}/>}
    </div>
  </section>;
}
