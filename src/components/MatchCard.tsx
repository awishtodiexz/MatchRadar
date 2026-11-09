import { Bell, BellOff, BellRing, ChevronRight, Star } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../store';
import { isLive } from '../fixtures';
import type { Match, Settings } from '../types';
import { Badge } from './WidgetUi';
import { matchButtonId, timeLabel } from '../presentation';

const clockText = (detail:string) => {
  const stoppage = detail.match(/^(\d+)'\+(\d+)'?$/);
  return stoppage ? `${stoppage[1]}+${stoppage[2]}'` : detail;
};

function alertPresentation(settings:Settings, match:Match) {
  const preference = settings.matchAlerts[match.id];
  const state = preference ? preference.enabled ? 'on' : 'muted' : 'team';
  const ended = match.status === 'fulltime' || match.status === 'cancelled';
  const description = state === 'on' ? 'Reminders, match start and goals are on for this match.'
    : state === 'muted' ? 'No alerts for this match, even for followed clubs.'
    : 'Using your followed-team alert settings.';
  return {state, ended, description, enabled:state==='on', label:state==='on'?'All alerts on':state==='muted'?'Muted':'Team settings'};
}

export function MatchCard({match, settings, onOpen, showCompetition=false}: {match:Match; settings:Settings; onOpen:()=>void; showCompetition?:boolean}) {
  const save = useApp(state=>state.save);
  const alerts = alertPresentation(settings, match);
  const detailId = useId();
  const name = `${match.home.name} versus ${match.away.name}`;
  const action = alerts.enabled ? 'Mute match alerts (all alerts on)' : alerts.state==='muted' ? 'Enable all alerts (match muted)' : 'Enable all alerts (using team settings)';
  const title = alerts.ended ? 'This match has ended. Open details to review its alert settings.'
    : `${alerts.description} ${alerts.enabled?'Click to mute.':'Click for reminders, match start and goals.'} Use match details to return to team settings.`;
  // The score and status are aria-hidden so the button keeps one predictable
  // name; the same facts are exposed as its accessible description.
  const cardDetail = match.status==='scheduled'
    ? `Kick-off ${timeLabel(match.kickoff)}`
    : `${match.homeScore ?? '–'} to ${match.awayScore ?? '–'}, ${isLive(match) ? (match.status==='halftime' ? 'half-time' : clockText(match.detail||'live')) : (match.detail || match.status)}${match.scoreStale?' (saved)':''}`;
  return <article className="match-row match-card" data-match-id={match.id}>
    <button id={matchButtonId(match.id)} className="match-open" onClick={onOpen} aria-label={`Match details: ${name}`} aria-describedby={detailId} title={`View ${name}. ${cardDetail}`}>
      <div className={'fixture-time '+(isLive(match)&&!match.scoreStale?'is-live':'')} aria-hidden="true">
        <span>{match.status==='scheduled'?timeLabel(match.kickoff):isLive(match)?match.status==='halftime'?'HT':clockText(match.detail||'LIVE'):match.status==='fulltime'?'FT':match.detail||match.status}</span>
        {match.scoreStale&&<small>Saved</small>}
        {showCompetition&&<small className="competition-tag">{match.league==='championsLeague'?'UCL':'PL'}</small>}
      </div>
      <div className="teams" aria-hidden="true">{[match.home,match.away].map(team=><div className="team-line" key={team.id}>
        <Badge team={team}/><span className="team-name" title={team.name}>{team.name}</span>
        {settings.favorites.includes(team.id) && <Star aria-label={`Following ${team.name}`} role="img" className="fav" size={11} fill="currentColor"/>}
      </div>)}</div>
      <div className={'match-state '+(isLive(match)&&!match.scoreStale?'is-live':'')} aria-hidden="true">
        <div className={'result '+(match.status==='scheduled'?'scheduled':'')}>
          {match.status==='scheduled' ? <span className="scheduled-score">–</span>
            : <div className="scores"><strong>{match.homeScore ?? '–'}</strong><strong>{match.awayScore ?? '–'}</strong></div>}
        </div>
      </div><span id={detailId} className="sr-only">{cardDetail}</span><ChevronRight size={13} className="row-arrow" aria-hidden="true"/>
    </button>
    <button className="icon-button match-bell" data-alert-state={alerts.state} aria-label={alerts.ended?`Match ended: ${name}`:`${action}: ${name}`} aria-pressed={alerts.enabled}
      title={title} disabled={alerts.ended}
      onClick={()=>void save({matchAlerts:{...settings.matchAlerts,[match.id]:{enabled:!alerts.enabled,expiresAt:new Date(Date.parse(match.kickoff)+30*86400000).toISOString()}}})}>
      {alerts.enabled?<BellRing size={16}/>:alerts.state==='muted'?<BellOff size={16}/>:<Bell size={16}/>}
    </button>
  </article>;
}

export function MatchAlertsButton({match, settings}: {match:Match; settings:Settings}) {
  const save = useApp(state=>state.save);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open,setOpen] = useState(false);
  const menuId = useId();
  const alerts = alertPresentation(settings, match);
  useEffect(()=>{
    if(!open) return;
    heading.current?.focus();
    const close = (event:MouseEvent) => {if(!(event.target instanceof Node)||!trigger.current?.parentElement?.contains(event.target))setOpen(false);};
    const key = (event:KeyboardEvent) => {if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('mousedown',close);
    document.addEventListener('keydown',key);
    return ()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};
  },[open]);
  const change = (enabled:boolean) => {if(alerts.ended)heading.current?.focus();void save({matchAlerts:{...settings.matchAlerts,[match.id]:{enabled,expiresAt:new Date(Date.parse(match.kickoff)+30*86400000).toISOString()}}});};
  const reset = () => { const next = {...settings.matchAlerts}; delete next[match.id]; heading.current?.focus(); void save({matchAlerts:next}); };
  return <div className="alert-control">
    <button ref={trigger} className="icon-button alert-trigger" data-alert-state={alerts.state}
      aria-label={`Match alerts: ${alerts.label}`} aria-haspopup="dialog" aria-expanded={open} title={titleFor(alerts)}
      onClick={()=>setOpen(value=>!value)}>
      {alerts.enabled?<BellRing size={17}/>:alerts.state==='muted'?<BellOff size={17}/>:<Bell size={17}/>}
    </button>
    {open&&<div className="alert-menu" role="dialog" aria-labelledby={menuId} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
      <div className="alert-menu-head"><h3 id={menuId} ref={heading} tabIndex={-1}>Match alerts</h3><span className="state-label" data-alert-state={alerts.state}>{alerts.label}</span></div>
      <p className="field-note">{alerts.ended?(alerts.state==='on'?'This match has ended. Mute it or use team settings.':alerts.state==='muted'?'This match has ended. Reset it to use team settings.':'This match has ended.'):alerts.description}</p>
      <div className="inline-actions">
        {(!alerts.ended||alerts.enabled)&&<button className="outline-button compact" onClick={()=>change(!alerts.enabled)}>{alerts.enabled?<BellOff size={15}/>:<BellRing size={15}/>} {alerts.enabled?'Mute this match':'Notify me about this match'}</button>}
        {alerts.state!=='team'&&<button className="text-button" onClick={reset}>Use team settings</button>}
      </div>
    </div>}
  </div>;
}

function titleFor(alerts:ReturnType<typeof alertPresentation>) {
  return alerts.ended?'This match has ended.':`${alerts.description} ${alerts.enabled?'Click to mute.':'Click for reminders, match start and goals.'} Use Match alerts to return to team settings.`;
}
