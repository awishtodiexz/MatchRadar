import { Bell, BellOff, BellRing, ChevronRight, Star } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { isLive } from '../fixtures';
import type { Match, Settings } from '../types';
import { Badge } from './WidgetUi';
import { closedNote, resultLabel, matchButtonId, timeLabel } from '../presentation';
import { countdownLabel, shortCountdown } from '../countdown';

const clockText = (detail:string) => {
  const stoppage = detail.match(/^(\d+)'\+(\d+)'?$/);
  return stoppage ? `${stoppage[1]}+${stoppage[2]}'` : detail;
};
// A damaged saved kickoff must not make the alert controls throw. Fall back to
// now for the (display-only) subscription expiry; Rust clamps it to the fixture.
const alertExpiry = (kickoff:string) => {
  const parsed = Date.parse(kickoff);
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + 30 * 86400000).toISOString();
};

function alertPresentation(settings:Settings, match:Match) {
  const preference = settings.matchAlerts[match.id];
  const state = preference ? preference.enabled ? 'on' : 'muted' : 'team';
  const ended = match.status === 'fulltime';
  const cancelled = match.status === 'cancelled';
  const postponed = match.status === 'postponed';
  const closed = ended || cancelled;
  const base = state === 'on' ? 'Kick-off reminders, match start and goal alerts are on for this match.'
    : state === 'muted' ? 'No alerts for this match, even for followed clubs.'
    : 'Using your followed-team alert settings.';
  // A cancelled match has not "ended", and a postponed one can still alert later.
  const description = ended ? 'This match has ended.'
    : cancelled ? closedNote(match)
    : postponed ? 'This match is postponed; alerts resume if it is rescheduled.'
    : base;
  return {state, ended, cancelled, closed, postponed, description, enabled:state==='on', label:state==='on'?'On':state==='muted'?'Muted':'Team default'};
}

export function MatchCard({match, settings, onOpen, showCompetition=false, now}: {match:Match; settings:Settings; onOpen:()=>void; showCompetition?:boolean; now?:Date}) {
  const alerts = alertPresentation(settings, match);
  const detailId = useId();
  const cardDetail = (match.status==='scheduled'
    ? `Kick-off ${timeLabel(match.kickoff)}`
    : `${match.homeScore ?? '–'} to ${match.awayScore ?? '–'}, ${isLive(match) ? (match.status==='halftime' ? 'half-time' : clockText(match.detail||'live')) : (match.detail || match.status)}${match.scoreStale?' (saved)':''}`)
    + (showCompetition ? `, ${match.league==='championsLeague'?'Champions League':'Premier League'}` : '');
  return <article className="match-row match-card" data-match-id={match.id} aria-labelledby={matchButtonId(match.id)}>
    <button id={matchButtonId(match.id)} className="match-open" onClick={onOpen} aria-describedby={detailId} title="View match details">
      <span className="sr-only">Match details: </span>
      <div className={'fixture-time '+(isLive(match)&&!match.scoreStale?'is-live':'')}>
        <span>{match.status==='scheduled'?timeLabel(match.kickoff):isLive(match)?match.status==='halftime'?'HT':clockText(match.detail||'LIVE'):match.status==='fulltime'?resultLabel(match):match.detail||match.status}</span>
        {match.scoreStale&&<small>Saved</small>}
        {showCompetition&&<small className="competition-tag">{match.league==='championsLeague'?'UCL':'PL'}</small>}
      </div>
      <div className="teams">{[match.home,match.away].map(team=><div className="team-line" key={team.id}>
        <Badge team={team}/><span className="team-name" title={team.name}>{team.name}</span>
        {settings.favorites.includes(team.id) && <Star aria-hidden="true" className="fav" size={11} fill="currentColor"/>}
      </div>)}</div>
      <div className={'match-state '+(isLive(match)&&!match.scoreStale?'is-live':'')}>
        <div className={'result '+(match.status==='scheduled'?'scheduled':'')}>
          {match.status==='scheduled' ? <span className="scheduled-score" title={countdownLabel(match.kickoff, now)??undefined}>{shortCountdown(match.kickoff, now) ?? '–'}</span>
            : <div className="scores"><strong>{match.homeScore ?? '–'}</strong><strong>{match.awayScore ?? '–'}</strong></div>}
        </div>
      </div><ChevronRight size={13} className="row-arrow" aria-hidden="true"/>
    </button>
    <span id={detailId} className="sr-only">{cardDetail}</span>
    {!alerts.closed&&<MatchAlertsButton match={match} settings={settings} list/>}
  </article>;
}

export function MatchAlertsButton({match, settings, list=false}: {match:Match; settings:Settings; list?:boolean}) {
  const save = useApp(state=>state.save);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position,setPosition] = useState({top:0,left:0});
  const [open,setOpen] = useState(false);
  const menuId = useId();
  const alerts = alertPresentation(settings, match);
  const [feedback,setFeedback] = useState('');
  useLayoutEffect(()=>{
    if(!open) return;
    const place = () => {
      if(!trigger.current || !menu.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = menu.current.getBoundingClientRect();
      const below = anchor.bottom + 6;
      const top = below + bounds.height <= window.innerHeight - 12 ? below : anchor.top - bounds.height - 6;
      setPosition({top:Math.max(12,Math.min(top,window.innerHeight-bounds.height-12)),left:Math.max(12,Math.min(anchor.right-bounds.width,window.innerWidth-bounds.width-12))});
    };
    place();
    window.addEventListener('resize',place);
    window.addEventListener('scroll',place,true);
    return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,feedback]);
  useEffect(()=>{
    if(!open) return;
    heading.current?.focus({preventScroll:true});
    const close = (event:MouseEvent) => {if(!(event.target instanceof Node)||!trigger.current?.parentElement?.contains(event.target))setOpen(false);};
    const focus = (event:FocusEvent) => {if(!(event.target instanceof Node)||!trigger.current?.parentElement?.contains(event.target))setOpen(false);};
    const key = (event:KeyboardEvent) => {if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('mousedown',close);
    document.addEventListener('focusin',focus);
    document.addEventListener('keydown',key);
    return ()=>{document.removeEventListener('mousedown',close);document.removeEventListener('focusin',focus);document.removeEventListener('keydown',key);};
  },[open]);
  const persist = async (matchAlerts:Settings['matchAlerts'], label:string) => {
    setFeedback('Saving alert preference…');
    const saved = await save({matchAlerts});
    setFeedback(saved?`Match alerts: ${label}.`:'Could not save alert preference. Please try again.');
  };
  const change = (enabled:boolean) => {void persist({...settings.matchAlerts,[match.id]:{enabled,expiresAt:alertExpiry(match.kickoff)}},enabled?'On':'Muted');};
  const reset = () => {const next = {...settings.matchAlerts};delete next[match.id];void persist(next,'Team default');};
  if(alerts.closed) return null;
  return <div className="alert-control">
    <button ref={trigger} className={'icon-button alert-trigger'+(list?' match-bell':'')} data-alert-state={alerts.state}
      aria-label={`Match alerts: ${match.home.name} versus ${match.away.name}, ${alerts.label}`} aria-haspopup="dialog" aria-expanded={open} title={titleFor(alerts)}
      onClick={()=>setOpen(value=>!value)}>
      {alerts.enabled?<BellRing size={17} fill="currentColor"/>:alerts.state==='muted'?<BellOff size={17}/>:<Bell size={17}/>}
    </button>
    {open&&<div ref={menu} className="alert-menu" style={position} role="dialog" aria-labelledby={menuId} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
      <div className="alert-menu-head"><h3 id={menuId} ref={heading} tabIndex={-1}>Match alerts</h3><span className="state-label" data-alert-state={alerts.state}>{alerts.label}</span></div>
      <p className="field-note">{alerts.description}</p>
      <div className="inline-actions">
        <button className="outline-button compact" aria-pressed={alerts.state==='team'} onClick={reset}>Team default</button>
        <button className="outline-button compact" aria-pressed={alerts.state==='on'} onClick={()=>change(true)}>On</button>
        <button className="outline-button compact" aria-pressed={alerts.state==='muted'} onClick={()=>change(false)}>Muted</button>
      </div>
      <p className="field-note" role="status">{feedback}</p>
    </div>}
  </div>;
}

// Tooltip for the details-header bell only; the list-card bell keeps its own title.
function titleFor(alerts:ReturnType<typeof alertPresentation>) {
  if(alerts.closed) return alerts.description;
  if(alerts.enabled) return 'Match alerts: On';
  if(alerts.state==='muted') return 'Match alerts: Muted';
  return 'Match alerts: Team default';
}
