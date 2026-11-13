import { useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Match } from '../types';
import { isLive } from '../fixtures';
import { dateLabel, relativeAge, timeLabel } from '../presentation';
import { useMatchSummary } from '../useMatchSummary';
import { MatchStats } from './MatchStats';
import { MatchLineups } from './MatchLineups';
import { MatchPreview } from './MatchPreview';
import { MatchEvents, keyEvent } from './MatchEvents';
import { MatchOverview } from './MatchOverview';
import { isCard, isGoal } from './matchEventKinds';

export type MatchSummaryState = ReturnType<typeof useMatchSummary>;

export function MatchCentre({match}:{match:Match}) {
  const summary = useMatchSummary(match.id,isLive(match),match.status==='fulltime');
  return <MatchCentreView match={match} summary={summary}/>;
}

/** Match centre driven by a summary the parent already owns (one poller per match). */
export function MatchCentreView({match,summary,onSectionChange}:{match:Match;summary:MatchSummaryState;onSectionChange?:(section:string)=>void}) {
  const {loading,error,retry}=summary;
  const data=summary.data;
  const [selected,setSelected]=useState('Overview');
  const [eventType,setEventType]=useState('all');
  const [newestFirst,setNewestFirst]=useState(true);
  const tabs=['Overview','Stats','Lineups','Commentary'];
  const tab=tabs.includes(selected)?selected:'Overview';
  const sectionId=useId();
  const events=data?.events??[];
  const visibleEvents=events.filter(event=>eventType==='all'||(eventType==='key'?keyEvent(event.kind):eventType==='goals'?isGoal(event.kind):eventType==='cards'?isCard(event.kind):eventType==='substitutions'?event.kind==='substitution':eventType==='shots'?/shot|attempt|chance/i.test(event.kind):/var|delay|injury|review/i.test(event.kind)));
  const filtered=visibleEvents.length!==events.length;
  const resetFilters=()=>setEventType('all');
  const select=(name:string)=>{
    setSelected(name);
    onSectionChange?.(name);
    requestAnimationFrame(()=>{
      const body=document.querySelector<HTMLElement>('.detail-body');
      const centre=body?.querySelector<HTMLElement>('.match-centre');
      if(body)body.scrollTo({top:name==='Lineups'&&centre?body.scrollTop+centre.getBoundingClientRect().top-body.getBoundingClientRect().top:0});
    });
  };
  return <section className="match-centre" aria-label="Match centre" aria-busy={loading}>
    <div className="centre-tabs scoped-tabs" role="tablist" aria-label="Match centre sections">{tabs.map((name,index)=><button key={name} role="tab" id={sectionId+'-'+name} aria-controls={sectionId+'-panel'} aria-selected={tab===name} tabIndex={tab===name?0:-1} onClick={()=>select(name)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:undefined;
      if(next===undefined)return;event.preventDefault();select(tabs[next]);document.getElementById(sectionId+'-'+tabs[next])?.focus();
    }}>{name}</button>)}</div>
    <div className="centre-panel" role="tabpanel" id={sectionId+'-panel'} aria-labelledby={sectionId+'-'+tab} tabIndex={0}>
    {data&&<div className="detail-freshness"><span title={Number.isNaN(Date.parse(data.updatedAt))?undefined:`${dateLabel(data.updatedAt)} ${timeLabel(data.updatedAt)}`}>{data.stale?'Saved details · updated':'Match details updated'} {relativeAge(data.updatedAt)}</span><button type="button" className="icon-button refresh-details" aria-label="Refresh match details" title="Refresh lineups, statistics and commentary" onClick={()=>void summary.refresh()} disabled={summary.refreshing||loading} aria-busy={summary.refreshing}><RefreshCw size={13} className={summary.refreshing?'spin':''}/></button></div>}
    {loading&&!data&&<div className="skeletons" role="status" aria-label="Loading match details"><div/></div>}
    {error&&<p role="status">{error} <button className="text-button" onClick={retry}>Retry details</button></p>}

    {tab==='Overview'&&(!loading||data)&&<>
      <MatchOverview match={match} data={data}/>
      <MatchPreview match={match} data={data}/>
    </>}
    {tab==='Commentary'&&(!loading||data)&&(events.length?<>
      <div className="timeline-toolbar">
        <span>{newestFirst?'Latest first':'Oldest first'} · {filtered?`${visibleEvents.length} of ${events.length} events`:`${events.length} ${events.length===1?'event':'events'}`}</span>
      </div>
      <div className="commentary-options"><select aria-label="Commentary event type" value={eventType} onChange={event=>setEventType(event.target.value)}><option value="all">All event types</option><option value="key">Key events</option><option value="goals">Goals</option><option value="cards">Cards</option><option value="substitutions">Substitutions</option><option value="shots">Shots &amp; chances</option><option value="stoppages">VAR &amp; stoppages</option></select><select aria-label="Commentary order" value={newestFirst?'newest':'oldest'} onChange={event=>setNewestFirst(event.target.value==='newest')}><option value="newest">Latest first</option><option value="oldest">Oldest first</option></select></div>
      {visibleEvents.length?<MatchEvents match={match} events={visibleEvents} commentary newestFirst={newestFirst}/>:<p className="field-note commentary-empty">No events match this filter. <button type="button" className="text-button" onClick={resetFilters}>Clear filters</button></p>}
    </>:<p className="field-note">No commentary is available for this match.</p>)}
    {tab==='Stats'&&data&&<>{data.statisticsNote&&<p className="field-note" role="status">{data.statisticsNote}</p>}<MatchStats match={match} statistics={data.statistics}/></>}
    {tab==='Lineups'&&data&&<MatchLineups match={match} players={data.players} substitutions={data.substitutions} formations={data.formations} coaches={data.coaches} events={data.events}/>}
    {(tab==='Stats'||tab==='Lineups')&&!data&&!loading&&<p className="field-note">{tab} are not available for this match.</p>}
    </div>
  </section>;
}
