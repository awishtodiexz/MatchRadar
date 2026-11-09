import { useId, useState } from 'react';
import type { Match } from '../types';
import { isLive } from '../fixtures';
import { useMatchSummary } from '../useMatchSummary';
import { MatchStats } from './MatchStats';
import { MatchLineups } from './MatchLineups';
import { Badge } from './WidgetUi';
import { MatchEvents, keyEvent } from './MatchEvents';
import { MatchOverview } from './MatchOverview';
import { isCard, isGoal } from './matchEventKinds';

const formScore = (score:string, atHome:boolean) => {
  const parts=score.split('-').map(Number);
  if(parts.length!==2||parts.some(n=>!Number.isFinite(n))) return score;
  return atHome?`${parts[0]}–${parts[1]}`:`${parts[1]}–${parts[0]}`;
};
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
  const teams=[match.home,match.away];
  const formTeams=teams.filter(team=>(data?.form?.[team.id]?.length??0)>0);
  const leaderTeams=teams.filter(team=>data?.leaders?.some(leader=>leader.teamId===team.id));
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
      {(!!formTeams.length||!!leaderTeams.length)&&<details className="match-background" open={match.status==='scheduled'}><summary>Form &amp; team leaders</summary>
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
      </details>}
      {data&&<p className="overview-freshness">{data.stale?'Saved details':'Details checked'} · {data.stale?new Date(data.updatedAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):new Date(data.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p>}
    </>}
    {tab==='Commentary'&&<>
      <div className="timeline-toolbar">
        <span>{newestFirst?'Latest first':'Oldest first'} · {visibleEvents.length} {visibleEvents.length===1?'event':'events'}</span>
        <div className="timeline-filter" role="group" aria-label="Commentary filter">
          <button aria-pressed={eventFilter==='all'&&eventType==='all'} onClick={()=>{setEventFilter('all');setEventType('all');}}>All</button>
          <button aria-pressed={eventFilter==='key'} onClick={()=>{setEventFilter('key');setEventType('all');}}>Key events</button>
        </div>
      </div>
      <div className="commentary-options"><select aria-label="Commentary event type" value={eventType} onChange={event=>{setEventType(event.target.value);setEventFilter('all');}}><option value="all">All event types</option><option value="goals">Goals</option><option value="cards">Cards</option><option value="substitutions">Substitutions</option><option value="shots">Shots &amp; chances</option><option value="stoppages">VAR &amp; stoppages</option></select><select aria-label="Commentary order" value={newestFirst?'newest':'oldest'} onChange={event=>setNewestFirst(event.target.value==='newest')}><option value="newest">Latest first</option><option value="oldest">Oldest first</option></select></div>
      {visibleEvents.length?<MatchEvents match={match} events={visibleEvents} commentary newestFirst={newestFirst}/>:<p className="field-note">No events match this filter.</p>}
    </>}
    {tab==='Stats'&&data&&<>{data.statisticsNote&&<p className="field-note" role="status">{data.statisticsNote}</p>}<MatchStats match={match} statistics={data.statistics}/></>}
    {tab==='Lineups'&&data&&<MatchLineups match={match} players={data.players} substitutions={data.substitutions} formations={data.formations} coaches={data.coaches}/>}
    </div>
  </section>;
}
