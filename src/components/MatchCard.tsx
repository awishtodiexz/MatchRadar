import { Bell, BellOff, BellRing, ChevronRight, Star } from 'lucide-react';
import { useRef } from 'react';
import { useApp } from '../store';
import { isLive } from '../fixtures';
import type { Match, Settings } from '../types';
import { Badge } from './WidgetUi';
import { matchButtonId, timeLabel } from '../presentation';

function alertPresentation(settings:Settings, match:Match) {
  const preference = settings.matchAlerts[match.id];
  const state = preference ? preference.enabled ? 'on' : 'muted' : 'team';
  const ended = match.status === 'fulltime' || match.status === 'cancelled';
  const description = state === 'on' ? 'Reminders, match start and goals are on for this match.'
    : state === 'muted' ? 'No alerts for this match, even for followed clubs.'
    : 'Using your followed-team alert settings.';
  return {state, ended, description, enabled:state==='on', label:state==='on'?'All alerts on':state==='muted'?'Muted':'Team settings'};
}

export function MatchCard({match, settings, onOpen}: {match:Match; settings:Settings; onOpen:()=>void}) {
  const save = useApp(state=>state.save);
  const alerts = alertPresentation(settings, match);
  const name = `${match.home.name} versus ${match.away.name}`;
  const action = alerts.enabled ? 'Mute match alerts (all alerts on)' : alerts.state==='muted' ? 'Enable all alerts (match muted)' : 'Enable all alerts (using team settings)';
  const title = alerts.ended ? 'This match has ended. Open details to review its alert settings.'
    : `${alerts.description} ${alerts.enabled?'Click to mute.':'Click for reminders, match start and goals.'} Use match details to return to team settings.`;
  return <article className="match-row match-card" data-match-id={match.id}>
    <button id={matchButtonId(match.id)} className="match-open" onClick={onOpen} aria-label={`Match details: ${name}`} title={`View ${name}`}>
      <div className="teams">{[match.home,match.away].map(team=><div className="team-line" key={team.id}>
        <Badge team={team}/><span className="team-name" title={team.name}>{team.name}</span>
        {settings.favorites.includes(team.id) && <Star aria-label={`Following ${team.name}`} role="img" className="fav" size={11} fill="currentColor"/>}
      </div>)}</div>
      <div className={'result '+(match.status==='scheduled'?'scheduled':'')}>
        {match.status==='scheduled' ? <strong className="kickoff">{timeLabel(match.kickoff)}</strong>
          : <div className="scores"><strong>{match.homeScore ?? '–'}</strong><strong>{match.awayScore ?? '–'}</strong></div>}
        <span className={isLive(match)&&!match.scoreStale?'live-text':''}>{match.status==='live'&&!match.scoreStale&&<i className="dot"/>}{match.scoreStale?'Saved · ':''}{match.detail || match.status}</span>
      </div><ChevronRight size={13} className="row-arrow" aria-hidden="true"/>
    </button>
    <button className="icon-button match-bell" data-alert-state={alerts.state} aria-label={alerts.ended?`Match ended: ${name}`:`${action}: ${name}`} aria-pressed={alerts.enabled}
      title={title} disabled={alerts.ended}
      onClick={()=>void save({matchAlerts:{...settings.matchAlerts,[match.id]:{enabled:!alerts.enabled,expiresAt:new Date(Date.parse(match.kickoff)+30*86400000).toISOString()}}})}>
      {alerts.enabled?<BellRing size={16}/>:alerts.state==='muted'?<BellOff size={16}/>:<Bell size={16}/>}
    </button>
  </article>;
}

export function MatchAlertPanel({match, settings}: {match:Match; settings:Settings}) {
  const save = useApp(state=>state.save);
  const heading = useRef<HTMLHeadingElement>(null);
  const alerts = alertPresentation(settings, match);
  const change = (enabled:boolean) => {if(alerts.ended)heading.current?.focus();void save({matchAlerts:{...settings.matchAlerts,[match.id]:{enabled,expiresAt:new Date(Date.parse(match.kickoff)+30*86400000).toISOString()}}});};
  const reset = () => { const next = {...settings.matchAlerts}; delete next[match.id]; heading.current?.focus(); void save({matchAlerts:next}); };
  return <section className="match-alert-panel" aria-labelledby="match-alert-heading">
    <div className="section-line"><h3 id="match-alert-heading" ref={heading} tabIndex={-1}>Match alerts</h3><span className="state-label" data-alert-state={alerts.state}>{alerts.label}</span></div>
    <p>{alerts.ended?(alerts.state==='on'?'This match has ended. You can mute or reset its alerts.':alerts.state==='muted'?'This match has ended. You can reset its muted setting.':'This match has ended.'):alerts.description}</p>
    {(!alerts.ended||alerts.state!=='team')&&<div className="inline-actions">
      {(!alerts.ended||alerts.enabled)&&<button className="outline-button" onClick={()=>change(!alerts.enabled)}>{alerts.enabled?<BellOff size={15}/>:<BellRing size={15}/>} {alerts.enabled?'Mute this match':'Notify me about this match'}</button>}
      {alerts.state!=='team'&&<button className="text-button" onClick={reset}>Use team settings</button>}
    </div>}
  </section>;
}
