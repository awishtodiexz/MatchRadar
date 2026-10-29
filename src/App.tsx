import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ListFilter, Minus, Pin, Radio, RefreshCw, Settings2, X } from 'lucide-react';
import { groupFixtures, isLive } from './fixtures';
import { updateStatus } from './freshness';
import { useApp } from './store';
import { useLocalDay } from './useLocalDay';
import type { Match } from './types';
import { LeagueMark } from './components/WidgetUi';
import { dateLabel, matchButtonId, timeLabel } from './presentation';
import { MatchCard } from './components/MatchCard';
import { MatchDetails } from './components/MatchDetails';
import { SettingsPanel } from './components/SettingsPanel';

export default function App() {
  const {snapshot,loading,load,refresh,save,error} = useApp();
  const [view,setView] = useState<'home'|'settings'|'detail'>('home');
  const [selected,setSelected] = useState<Match|null>(null);
  const [refreshing,setRefreshing] = useState(false);
  const root = useRef<HTMLElement>(null);
  const restoreFocus = useRef('settings-control');
  const homeScroll = useRef(0);
  const previousView = useRef(view);
  const day = useLocalDay();
  const native = isTauri();
  const settings = snapshot?.settings;
  const allMatches = snapshot?.matches;
  const rememberHome = () => { homeScroll.current=root.current?.querySelector('.match-list')?.scrollTop??0; };
  const back = () => setView('home');
  const openSettings = () => {
    if(view==='home') rememberHome();
    restoreFocus.current='settings-control';setView('settings');
  };
  const openMatch = (match:Match) => {rememberHome();restoreFocus.current=matchButtonId(match.id);setSelected(match);setView('detail');};
  useEffect(()=>{
    void load();
    if(!native) return;
    let disposed=false;
    const listeners:Array<()=>void>=[];
    for(const [event,callback] of [['snapshot-updated',()=>{void load();}],['open-settings',()=>{homeScroll.current=root.current?.querySelector('.match-list')?.scrollTop??homeScroll.current;restoreFocus.current='settings-control';setView('settings');}]] as const) {
      void listen(event,callback).then(fn=>{if(disposed) fn();else listeners.push(fn);}).catch(()=>useApp.setState({error:'Could not subscribe to desktop updates.'}));
    }
    return ()=>{disposed=true;listeners.forEach(fn=>fn());};
  },[load,native]);
  useEffect(()=>{
    if(previousView.current===view) return;
    previousView.current=view;
    if(view==='home') {
      const list=root.current?.querySelector('.match-list');if(list) list.scrollTop=homeScroll.current;
      (document.getElementById(restoreFocus.current)??document.getElementById('settings-control'))?.focus({preventScroll:true});
    } else root.current?.querySelector<HTMLElement>('[data-view-heading]')?.focus();
  },[view]);
  const matches = useMemo(()=>{
    const favorites=settings?.favorites??[];
    return (allMatches??[]).filter(m=>!settings?.followedOnly||favorites.includes(m.home.id)||favorites.includes(m.away.id));
  },[allMatches,settings?.favorites,settings?.followedOnly]);
  const groups = useMemo(()=>groupFixtures(matches,settings?.favorites??[],day),[matches,settings?.favorites,day]);
  // League status is independent of the cards filter, and excludes saved/unconfirmed scores.
  const live = (allMatches??[]).filter(m=>isLive(m)&&!m.scoreStale).length;
  const savedLive = (allMatches??[]).some(m=>isLive(m)&&m.scoreStale);
  const liveUnknown = !live&&!savedLive&&!!snapshot?.scoreError;
  const filteredEmpty = !!settings?.followedOnly&&!!allMatches?.length&&!matches.length;
  const waiting = !allMatches?.length&&(loading||!!snapshot?.refreshing&&!snapshot.updatedAt&&!snapshot.fixtureUpdatedAt&&!snapshot.error);
  const busy = refreshing||!!snapshot?.refreshing;
  const status = updateStatus(snapshot);
  const demo = !native||!!settings?.mock;
  const statusLabel = demo?'DEMO DATA':status.label;
  const statusTime = !demo&&status.timestamp?`${dateLabel(status.timestamp)} ${timeLabel(status.timestamp)}`:undefined;
  const doRefresh = async () => {setRefreshing(true);try{await refresh();}finally{setRefreshing(false);}};
  const keyDown = (event:KeyboardEvent) => {
    if(event.key==='Escape'&&!event.defaultPrevented&&view!=='home'&&!(event.target instanceof HTMLSelectElement)) {event.preventDefault();back();}
  };
  return <main ref={root} onKeyDown={keyDown} className={'shell theme-'+(settings?.theme??'dark')+' '+((settings?.opacity??96)<85?'transparent-panel ':'')+(settings?.compact?'compact-view ':'')+(settings?.reducedMotion?'reduced':'')} style={{'--panel-opacity':Math.min(100,Math.max(70,settings?.opacity??96))/100} as CSSProperties}>
    <header className="header" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region><span className="brand-icon"><Radio size={19}/></span><div data-tauri-drag-region><h1>match<span>radar</span><i>®</i></h1><p>YOUR MATCHDAY COMPANION</p></div></div>
      <div className="header-actions">
        <button className="icon-button" title={native?'Minimize to taskbar':'Minimize is available in the desktop app'} disabled={!native} onClick={()=>void getCurrentWindow().minimize().catch(()=>useApp.setState({error:'Could not minimize the widget.'}))} aria-label="Minimize widget"><Minus size={17}/></button>
        <button className="icon-button close" title={native?'Hide to system tray':'Hide is available in the desktop app'} disabled={!native} onClick={()=>void getCurrentWindow().hide().catch(()=>useApp.setState({error:'Could not hide the widget.'}))} aria-label="Hide widget"><X size={16}/></button>
      </div>
    </header>
    {view==='settings'&&settings?<SettingsPanel settings={settings} matches={allMatches??[]} save={save} back={back} refresh={()=>void doRefresh()} refreshing={busy}/>
      :view==='detail'&&selected&&settings?<MatchDetails match={allMatches?.find(m=>m.id===selected.id)??selected} settings={settings} back={back}/>
      :<>
        <div className={'hero '+(allMatches?.length?'has-matches':'')}><div><span className="eyebrow"><span className="tiny-line"/>THE BEAUTIFUL GAME, AT A GLANCE</span><h2>Matchday<span>.</span></h2><p>{new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long'}).format(day)}</p></div><div className="hero-orbit" aria-hidden="true"><span className="orbit-one"/><span className="orbit-two"/><span className="orbit-dot"/><Radio size={22}/></div></div>
        <div className="summary"><div><LeagueMark/><span><b>Premier League</b><small>ENGLAND · MATCH CENTRE</small></span></div><span className={'live-pill '+(!live?'quiet':'')} aria-label={`Premier League: ${live?`${live} live matches`:savedLive?'saved scores, awaiting live update':liveUnknown?'live status unavailable':'no confirmed live matches'}`} title="League-wide status, including matches hidden by your filter"><i className="dot"/>{live?`${live} LIVE`:savedLive?'SAVED LIVE':liveUnknown?'LIVE UNAVAILABLE':'NO LIVE MATCHES'}</span></div>
        <div className="match-list">
          <div className="schedule-context"><p className="schedule-note">Fixtures · approximately the next 14 days</p>{settings?.followedOnly&&<span className="filter-label"><ListFilter size={12}/>Following only</span>}</div>
          {snapshot?.error&&!!allMatches?.length&&<div className="offline-banner" role="status" title={snapshot.error}><span>{snapshot.partial?'Partial update · some data may be stale':'Update failed · saved data is unchanged'}</span><button onClick={()=>void doRefresh()} disabled={busy}>Retry</button></div>}
          {waiting?<div className="skeletons" role="status" aria-label="Loading fixtures"><div/><div/><div/></div>
            :!matches.length?<div className="empty"><Radio size={25}/><h3>{filteredEmpty?'No followed-team matches':snapshot?.error?(snapshot.partial?'Some updates are unavailable':'Unable to update matches'):'No fixtures in this window'}</h3>
              <p>{filteredEmpty?'Your filter hides the other Premier League matches. Show all matches or choose more clubs in Settings.':snapshot?.error?(snapshot.partial?'Available data was saved, but some updates could not be confirmed.':'We couldn’t update the feed. Any saved fixtures will appear here when available.'):'No Premier League fixtures are available for approximately the next 14 days.'}</p>
              {filteredEmpty?<button className="outline-button" onClick={()=>void save({followedOnly:false})}>Show all matches</button>:snapshot?.error?<button className="outline-button" onClick={()=>void doRefresh()} disabled={busy}><RefreshCw size={14}/>Retry</button>:null}
            </div>
            :settings&&groups.map(({key,label,matches:items})=><section key={key} aria-labelledby={'date-group-'+key}><h3 id={'date-group-'+key} className={'group-title '+(key==='live'&&items.some(m=>!m.scoreStale)?'live-group':'')}><span>{label}</span><span>{items.length.toString().padStart(2,'0')}</span></h3>{items.map(match=><MatchCard key={match.id} match={match} settings={settings} onOpen={()=>openMatch(match)}/>)}</section>)}
        </div>
      </>}
    {error&&<div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" title="Dismiss message" onClick={()=>useApp.setState({error:null})}><X size={14}/></button></div>}
    <footer>
      <div className="connection-info" role="status" title={[statusLabel,statusTime].filter(Boolean).join(' · ')}><span className={'connection '+(snapshot?.error?'error':'')} aria-hidden="true"/><div className="status-copy"><span>{statusLabel}</span>{statusTime&&<time dateTime={status.timestamp??undefined}>{statusTime}</time>}</div></div>
      <div className="footer-actions">
        <button id="settings-control" className="icon-button" title={view==='settings'?'Return to matches (Esc)':'Open Settings'} onClick={()=>view==='settings'?back():openSettings()} aria-label="Settings" aria-pressed={view==='settings'}><Settings2 size={16}/></button>
        <button className="icon-button" title={settings?.alwaysOnTop?'Always on top is on · unpin widget':'Always on top is off · keep widget above other windows'} disabled={!settings} onClick={()=>settings&&void save({alwaysOnTop:!settings.alwaysOnTop})} aria-label="Always on top" aria-pressed={!!settings?.alwaysOnTop}><Pin size={16}/></button>
        <button className="icon-button" title={settings?.followedOnly?'Following only is on · show all Premier League matches':'Showing all matches · filter to followed clubs'} disabled={!settings} onClick={()=>settings&&void save({followedOnly:!settings.followedOnly})} aria-label="Following only" aria-pressed={!!settings?.followedOnly}><ListFilter size={16}/>{settings?.followedOnly&&<span className="filter-dot"/>}</button>
        <button className="icon-button" title={busy?'Updating fixtures…':'Refresh fixtures and scores'} onClick={()=>void doRefresh()} disabled={busy} aria-label="Refresh" aria-busy={busy}><RefreshCw size={16} className={busy?'spin':''}/></button>
      </div>
    </footer>
  </main>;
}
