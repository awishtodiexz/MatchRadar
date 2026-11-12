import { useId, useState } from 'react';
import type { Match } from '../types';
import { isLive } from '../fixtures';
import { useMatchSummary } from '../useMatchSummary';
import { MatchStats } from './MatchStats';
import { MatchLineups } from './MatchLineups';
import { MatchPreview } from './MatchPreview';
import { MatchEvents, keyEvent } from './MatchEvents';
import { MatchOverview } from './MatchOverview';
import { isCard, isGoal } from './matchEventKinds';

export function MatchCentre({match}:{match:Match}) {
  const summary = useMatchSummary(match.id,isLive(match),match.status==='fulltime');
  const {loading,error,retry}=summary;
  const data=summary.data;
  const [selected,setSelected]=useState('Overview');
  const [eventFilter,setEventFilter]=useState<'all'|'key'>('all');
  const [eventType,setEventType]=useState('all');
  const [newestFirst,setNewestFirst]=useState(true);
  const tabs=['Overview',...(data?.statistics.length?['Stats']:[]),...(data?.players.length?['Lineups']:[]),...(data?.events.length?['Commentary']:[])];
  const tab=tabs.includes(selected)?selected:'Overview';
  const sectionId=useId();
  const events=data?.events??[];
  const visibleEvents=events.filter(event=>(eventFilter==='all'||keyEvent(event.kind))&&(eventType==='all'||(eventType==='goals'?isGoal(event.kind):eventType==='cards'?isCard(event.kind):eventType==='substitutions'?event.kind==='substitution':eventType==='shots'?/shot|attempt|chance/i.test(event.kind):/var|delay|injury|review/i.test(event.kind))));
  const filtered=visibleEvents.length!==events.length;
  const resetFilters=()=>{setEventFilter('all');setEventType('all');};
  const select=(name:string)=>{
    setSelected(name);
    requestAnimationFrame(()=>document.querySelector<HTMLElement>('.detail-body')?.scrollTo({top:0}));
  };
  return <section className="match-centre" aria-label="Match centre" aria-busy={loading}>
    <div className="centre-tabs" role="tablist" aria-label="Match centre sections">{tabs.map((name,index)=><button key={name} role="tab" id={sectionId+'-'+name} aria-controls={sectionId+'-panel'} aria-selected={tab===name} tabIndex={tab===name?0:-1} onClick={()=>select(name)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:undefined;
      if(next===undefined)return;event.preventDefault();select(tabs[next]);document.getElementById(sectionId+'-'+tabs[next])?.focus();
    }}>{name}</button>)}</div>
    <div className="centre-panel" role="tabpanel" id={sectionId+'-panel'} aria-labelledby={sectionId+'-'+tab} tabIndex={0}>
    {loading&&!data&&<div className="skeletons" role="status" aria-label="Loading match details"><div/></div>}
    {error&&<p role="status">{error} <button className="text-button" onClick={retry}>Retry details</button></p>}

    {tab==='Overview'&&(!loading||data)&&<>
      <MatchOverview match={match} data={data}/>
      <MatchPreview match={match} data={data}/>
      {data&&<p className="overview-freshness">{data.stale?'Saved details':'Details checked'} · {data.stale?new Date(data.updatedAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):new Date(data.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p>}
    </>}
    {tab==='Commentary'&&<>
      <div className="timeline-toolbar">
        <span>{newestFirst?'Latest first':'Oldest first'} · {filtered?`${visibleEvents.length} of ${events.length} events`:`${events.length} ${events.length===1?'event':'events'}`}</span>
        <div className="timeline-filter" role="group" aria-label="Commentary filter">
          <button aria-pressed={eventFilter==='all'&&eventType==='all'} onClick={()=>{setEventFilter('all');setEventType('all');}}>All</button>
          <button aria-pressed={eventFilter==='key'} onClick={()=>{setEventFilter('key');setEventType('all');}}>Key events</button>
        </div>
      </div>
      <div className="commentary-options"><select aria-label="Commentary event type" value={eventType} onChange={event=>{setEventType(event.target.value);setEventFilter('all');}}><option value="all">All event types</option><option value="goals">Goals</option><option value="cards">Cards</option><option value="substitutions">Substitutions</option><option value="shots">Shots &amp; chances</option><option value="stoppages">VAR &amp; stoppages</option></select><select aria-label="Commentary order" value={newestFirst?'newest':'oldest'} onChange={event=>setNewestFirst(event.target.value==='newest')}><option value="newest">Latest first</option><option value="oldest">Oldest first</option></select></div>
      {visibleEvents.length?<MatchEvents match={match} events={visibleEvents} commentary newestFirst={newestFirst}/>:<p className="field-note commentary-empty">No events match this filter. <button type="button" className="text-button" onClick={resetFilters}>Clear filters</button></p>}
    </>}
    {tab==='Stats'&&data&&<>{data.statisticsNote&&<p className="field-note" role="status">{data.statisticsNote}</p>}<MatchStats match={match} statistics={data.statistics}/></>}
    {tab==='Lineups'&&data&&<MatchLineups match={match} players={data.players} substitutions={data.substitutions} formations={data.formations} coaches={data.coaches}/>}
    </div>
  </section>;
}
