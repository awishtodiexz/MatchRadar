import { useId, useState } from 'react';
import type { Match } from '../types';
import { isLive } from '../fixtures';
import { useMatchSummary } from '../useMatchSummary';
import { demoMatchSummary } from '../demo/summary';
import { MatchStats } from './MatchStats';
import { MatchLineups } from './MatchLineups';
export function MatchCentre({match,demo}:{match:Match;demo:boolean}) {
  const summary=useMatchSummary(match.id,isLive(match),demo);
  const {loading,error,retry}=summary;
  const data=demo?demoMatchSummary(match):summary.data;
  const [selected,setSelected]=useState('Overview');
  const tabs=['Overview',...(data?.events.length?['Timeline']:[]),...(data?.statistics.length?['Stats']:[]),...(data?.players.length?['Lineups']:[])];
  const tab=tabs.includes(selected)?selected:'Overview';
  const sectionId=useId();
  const team=(id:string|null)=>id===match.home.id?match.home.name:id===match.away.id?match.away.name:'Match';
  return <section className="match-centre" aria-label="Match centre">
    <div className="centre-tabs" role="tablist" aria-label="Match centre sections">{tabs.map((name,index)=><button key={name} role="tab" id={sectionId+'-'+name} aria-controls={sectionId+'-panel'} aria-selected={tab===name} tabIndex={tab===name?0:-1} onClick={()=>setSelected(name)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:undefined;
      if(next===undefined)return;event.preventDefault();setSelected(tabs[next]);document.getElementById(sectionId+'-'+tabs[next])?.focus();
    }}>{name}</button>)}</div>
    <div role="tabpanel" id={sectionId+'-panel'} aria-labelledby={sectionId+'-'+tab} tabIndex={0}>
    {demo&&<p className="field-note demo-disclaimer">Demo match · Fictional players and events</p>}
    {loading&&<div className="skeletons" role="status" aria-label="Loading match details"><div/></div>}
    {error&&<p role="status">{error} <button className="text-button" onClick={retry}>Retry details</button></p>}
    {data&&!demo&&<p className="field-note">{data.stale?'Saved details':'Details checked'} · {new Date(data.updatedAt).toLocaleString()}</p>}
    {tab==='Overview'&&(!loading||data)&&<><h3>Match events</h3><p>{data?.events.length?`${data.events.length} ${demo?'demo':'provider'} events available in Timeline.`:error?'Details could not be confirmed.':'No event timeline is available for this match.'}</p>{!demo&&<p className="field-note">Scores come from the matchday scoreboard. Match details may update separately.</p>}</>}
    {tab==='Timeline'&&<ol className="event-list">{data?.events.map(e=><li key={e.id}><time>{e.minute||'—'}</time><div><small>{team(e.teamId)} · {e.kind.replaceAll('-',' ')}</small><p>{e.text}</p></div></li>)}</ol>}
    {tab==='Stats'&&data&&<MatchStats match={match} statistics={data.statistics}/>}
    {tab==='Lineups'&&data&&<MatchLineups match={match} players={data.players}/>}
    </div>
  </section>;
}
