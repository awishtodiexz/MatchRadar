import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ListFilter, Minus, Pin, Radio, RefreshCw, Settings2, X } from 'lucide-react';
import logo from './assets/logo-mark.png';
import { groupFixtures, isLive } from './fixtures';
import { competitionLeagues, competitionName, competitionSlug, competitionStatus, resultsStatus, updateStatus } from './freshness';
import { useApp } from './store';
import { useLocalDay } from './useLocalDay';
import { useNotificationNavigation } from './useNotificationNavigation';
import { useRecentResults } from './useRecentResults';
import { matchesView } from './matchViews';
import { liveEmptyState } from './emptyState';
import type { MatchView } from './matchViews';
import type { Match } from './types';
import { dateLabel, matchButtonId, timeLabel } from './presentation';
import { MatchCard } from './components/MatchCard';
import { MatchDetails } from './components/MatchDetails';
import { SettingsPanel } from './components/SettingsPanel';
import { CompetitionPicker } from './components/CompetitionPicker';

export default function App() {
  const {snapshot,loading,load,refresh,save,error} = useApp();
  const [view,setView] = useState<'home'|'settings'|'detail'>('home');
  const [themeHint] = useState<'dark'|'light'>(()=>{try{return localStorage.getItem('matchradar.theme')==='light'?'light':'dark';}catch{return 'dark';}});
  const [matchView,setMatchView] = useState<MatchView>('All');
  const [selected,setSelected] = useState<Match|null>(null);
  const [notificationRequest,setNotificationRequest] = useState(0);
  const [refreshing,setRefreshing] = useState(false);
  const root = useRef<HTMLElement>(null);
  const restoreFocus = useRef('settings-control');
  const homeScroll = useRef(0);
  const previousView = useRef(view);
  const day = useLocalDay();
  const native = isTauri();
  const settings = snapshot?.settings;
  const allMatches = snapshot?.matches;
  const competitionView = settings?.competitionView ?? 'premierLeague';
  const competitionTitle = competitionView==='both' ? 'Both competitions' : competitionName(competitionView);
  const competitionMatchesLabel = competitionView==='both' ? 'matches from either competition' : `${competitionName(competitionView)} matches`;
  const historyView=matchView==='Results';
  const recent=useRecentResults(historyView,competitionView);
  const viewStatus=competitionStatus(snapshot,competitionView);
  const viewResults=resultsStatus(recent.data,competitionView);
  const competitionMatches=useMemo(()=>{
    const included=competitionLeagues(competitionView);
    return (allMatches??[]).filter(m=>included.includes(m.league??'premierLeague'));
  },[allMatches,competitionView]);
  const sourceMatches=useMemo(()=>{
    const included=competitionLeagues(competitionView);
    const base=historyView?[...new Map([...recent.data.matches,...(allMatches??[]).filter(m=>m.status==='fulltime')].map(m=>[m.id,m])).values()]:(allMatches??[]);
    return base.filter(m=>included.includes(m.league??'premierLeague'));
  },[historyView,recent.data.matches,allMatches,competitionView]);
  const listError=historyView?viewResults.error:viewStatus.error;
  const rememberHome = () => { homeScroll.current=root.current?.querySelector('.match-list')?.scrollTop??0; };
  const back = () => setView('home');
  const openSettings = () => {
    if(view==='home') rememberHome();
    restoreFocus.current='settings-control';setView('settings');
  };
  const openMatch = (match:Match) => {rememberHome();restoreFocus.current=matchButtonId(match.id);setSelected(match);setView('detail');};
  useNotificationNavigation(native,target=>{
    homeScroll.current=root.current?.querySelector('.match-list')?.scrollTop??homeScroll.current;
    if(target.match) {
      setNotificationRequest(target.requestId);
      restoreFocus.current=matchButtonId(target.match.id);
      setSelected(target.match);
      setView('detail');
      void load();
    } else {
      setSelected(null);
      setView('home');
      if(target.matchId) useApp.setState({error:'This notification’s match is no longer in the local fixture cache. Refresh matches to check availability.'});
    }
  });
  useEffect(()=>{
    setSelected(current=>{
      if(!current)return current;
      const fresh=allMatches?.find(m=>m.id===current.id);
      return fresh??(isLive(current)&&!current.scoreStale?{...current,scoreStale:true}:current);
    });
  },[allMatches]);
  useEffect(()=>{
    void load();
    if(!native) return;
    let disposed=false;
    const listeners:Array<()=>void>=[];
    for(const [event,callback] of [['snapshot-updated',()=>{void load();}],['open-settings',()=>{homeScroll.current=root.current?.querySelector('.match-list')?.scrollTop??homeScroll.current;restoreFocus.current='settings-control';setView('settings');}],['shortcut-unavailable',()=>{useApp.setState({error:'Ctrl+Shift+M is already used by another app. Use the tray icon instead.'});}]] as const) {
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
    return matchesView(sourceMatches??[],matchView,favorites).filter(m=>!settings?.followedOnly||favorites.includes(m.home.id)||favorites.includes(m.away.id));
  },[sourceMatches,matchView,settings?.favorites,settings?.followedOnly]);
  const groups = useMemo(()=>groupFixtures(matches,settings?.favorites??[],day),[matches,settings?.favorites,day]);
  // Status is scoped to the selected competition(s), independent of card filters.
  const live = competitionMatches.filter(m=>isLive(m)&&!m.scoreStale).length;
  const savedLive = competitionMatches.some(m=>isLive(m)&&m.scoreStale);
  const unchecked = snapshot?.leagueStatus
    ? competitionLeagues(competitionView).some(league=>!snapshot.leagueStatus?.[competitionSlug(league)]?.updatedAt)
    : !viewStatus.updatedAt;
  const liveUnknown = !live&&!savedLive&&(!!viewStatus.scoreError||unchecked);
  const filteredEmpty = (!!settings?.followedOnly||matchView!=='All')&&!!sourceMatches?.length&&!matches.length;
  const liveStatusUnavailable=!!viewStatus.scoreError||unchecked;
  const liveEmpty = liveEmptyState({scoreError:liveStatusUnavailable,savedLive,live,followedOnly:!!settings?.followedOnly,view:matchView,competition:competitionView==='both'?'live':competitionName(competitionView),both:competitionView==='both'});
  const waiting = historyView?recent.loading&&!matches.length:!allMatches?.length&&(loading||!!snapshot?.refreshing&&!viewStatus.updatedAt&&!viewStatus.fixtureUpdatedAt&&!viewStatus.error);
  const busy = refreshing||!!snapshot?.refreshing;
  const status = updateStatus(snapshot,competitionView);
  const statusLabel = status.label;
  const statusTime = status.timestamp?`${dateLabel(status.timestamp)} ${timeLabel(status.timestamp)}`:undefined;
  const doRefresh = async () => {setRefreshing(true);try{await refresh();}finally{setRefreshing(false);}};
  const contextMenu = (event:MouseEvent) => {
    const target = event.target;
    if (target instanceof Element) {
      if (target.closest('input, textarea, select, [data-copyable]')) return;
      const editable = target.closest('[contenteditable]')?.getAttribute('contenteditable')?.toLowerCase();
      if (editable === '' || editable === 'true' || editable === 'plaintext-only') return;
    }
    event.preventDefault();
  };
  const keyDown = (event:KeyboardEvent) => {
    if(event.key==='Escape'&&!event.defaultPrevented&&view!=='home'&&!(event.target instanceof HTMLSelectElement)) {event.preventDefault();back();}
  };
  return <main ref={root} onKeyDown={keyDown} onContextMenu={contextMenu} className={'shell theme-'+(settings?.theme??themeHint)+' '+((settings?.opacity??96)<85?'transparent-panel ':'')+(settings?.compact?'compact-view ':'')+(settings?.reducedMotion?'reduced':'')} style={{'--panel-opacity':Math.min(100,Math.max(70,settings?.opacity??96))/100} as CSSProperties}>
    <header className="header" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region><span className="brand-icon"><img src={logo} alt=""/></span><div data-tauri-drag-region><h1>match<span>radar</span><i>®</i></h1></div></div>
      <div className="header-actions">
        <button className="icon-button" title={native?'Hide to system tray':'Hide is available in the desktop app'} disabled={!native} onClick={()=>void getCurrentWindow().hide().catch(()=>useApp.setState({error:'Could not hide the widget.'}))} aria-label="Minimize widget"><Minus size={17}/></button>
        <button className="icon-button close" title={native?'Hide to system tray':'Hide is available in the desktop app'} disabled={!native} onClick={()=>void getCurrentWindow().hide().catch(()=>useApp.setState({error:'Could not hide the widget.'}))} aria-label="Hide widget"><X size={16}/></button>
      </div>
    </header>
    {view==='settings'&&settings?<SettingsPanel settings={settings} matches={allMatches??[]} save={save} back={back} refresh={()=>void doRefresh()} refreshing={busy}/>
      :view==='detail'&&selected&&settings?<MatchDetails key={`${selected.id}:${notificationRequest}`} match={allMatches?.find(m=>m.id===selected.id)??selected} settings={settings} back={back}/>
      :<>
        <div className="hero"><div><h2>Matchday</h2><p>Fixtures, scores and the clubs you follow</p></div><time>{dateLabel(new Date().toISOString())}</time></div>
        <div className="summary"><CompetitionPicker value={competitionView} onChange={value=>void save({competitionView:value})} disabled={!settings}/><span className={'live-pill '+(!live?'quiet':'')} aria-label={`${competitionTitle}: ${live?`${live} live matches`:savedLive?'saved scores, awaiting live update':liveUnknown?'live status unavailable':'no confirmed live matches'}`} title="Competition status, including matches hidden by your filter. Live scores refresh about every 60 seconds."><i className="dot"/>{live?`${live} LIVE`:savedLive?'SAVED LIVE':liveUnknown?'LIVE UNAVAILABLE':'NO LIVE MATCHES'}</span></div>
        <div className="match-list">
          <nav className="centre-tabs" aria-label="Fixture views">{(['All','Live','Following','Upcoming','Results'] as const).map(name=><button key={name} aria-pressed={matchView===name} onClick={()=>setMatchView(name)}>{name}</button>)}</nav>
          <div className="schedule-context"><p className="schedule-note">{matchView==='Results'?'Results \u00b7 previous 14 days':competitionView==='championsLeague'?'Fixtures \u00b7 approximately the next 30 days':competitionView==='both'?'Fixtures \u00b7 chronological, up to 30 days ahead':'Fixtures \u00b7 approximately the next 14 days'}</p>{settings?.followedOnly&&<span className="filter-label"><ListFilter size={12}/>Following only</span>}</div>
          {listError&&!!sourceMatches?.length&&<div className="offline-banner" role="status" title={listError}><span>{historyView?'Results update failed - cached results retained':viewStatus.partial?'Partial update · some data may be stale':'Update failed · saved data is unchanged'}</span><button onClick={()=>historyView?recent.retry():void doRefresh()} disabled={historyView?recent.loading:busy}>Retry</button></div>}
          {historyView&&viewResults.updatedAt&&<p className="field-note">Results checked {new Date(viewResults.updatedAt).toLocaleString()}</p>}
          {waiting?<div className="skeletons" role="status" aria-label="Loading fixtures"><div/><div/><div/></div>
            :!matches.length?<div className="empty"><Radio size={25}/><h3>{liveEmpty?.title??(filteredEmpty?(matchView==='All'?'No followed-team matches':matchView==='Following'?'No matches involving followed clubs':`No ${matchView.toLowerCase()} matches`):listError?(historyView?'Unable to update results':viewStatus.partial?'Some updates are unavailable':'Unable to update matches'):historyView?'No recent results':'No fixtures in this window')}</h3>
              <p>{liveEmpty?.message??(filteredEmpty?`Your active filters hide the other ${competitionMatchesLabel}. Show all matches or choose another view.`:listError?(historyView?'Could not update results. Any saved results remain available.':viewStatus.partial?'Available data was saved, but some updates could not be confirmed.':'Could not update the feed. Any saved fixtures remain available.'):historyView?`No completed ${competitionMatchesLabel} were found in the previous 14 days.`:`No ${competitionMatchesLabel} are available for approximately the next ${competitionView==='both'?30:competitionView==='championsLeague'?30:14} days.`)}</p>
              {(liveEmpty?.canShowAll||!liveEmpty&&filteredEmpty)?<button className="outline-button" onClick={()=>{setMatchView('All');void save({followedOnly:false});}}>Show all matches</button>:(liveEmpty&&liveStatusUnavailable||!liveEmpty&&listError)?<button className="outline-button" onClick={()=>historyView?recent.retry():void doRefresh()} disabled={historyView?recent.loading:busy}><RefreshCw size={14}/>Retry</button>:null}
            </div>
            :settings&&groups.map(({key,label,matches:items})=><section key={key} aria-labelledby={'date-group-'+key}><h3 id={'date-group-'+key} className={'group-title '+(key==='live'&&items.some(m=>!m.scoreStale)?'live-group':'')}><span>{label}</span><span>{items.length.toString().padStart(2,'0')}</span></h3>{items.map(match=><MatchCard key={match.id} match={match} settings={settings} onOpen={()=>openMatch(match)} showCompetition={competitionView==='both'}/>)}</section>)}
        </div>
      </>}
    {error&&<div className="error-banner" role="alert"><span data-copyable>{error}</span><button className="icon-button" aria-label="Dismiss message" title="Dismiss message" onClick={()=>useApp.setState({error:null})}><X size={14}/></button></div>}
    <footer>
      <div className="connection-info" role="status" title={[statusLabel,statusTime,'Live scores refresh about every 60 seconds'].filter(Boolean).join(' · ')}><span className={'connection '+(viewStatus.error?'error':'')} aria-hidden="true"/><div className="status-copy"><span>{statusLabel}</span>{statusTime&&<time dateTime={status.timestamp??undefined}>{statusTime}</time>}</div></div>
      <div className="footer-actions">
        <button id="settings-control" className="icon-button" title={view==='settings'?'Return to matches (Esc)':'Open Settings'} onClick={()=>view==='settings'?back():openSettings()} aria-label="Settings" aria-pressed={view==='settings'}><Settings2 size={16}/></button>
        <button className="icon-button" title={settings?.alwaysOnTop?'Always on top is on · unpin widget':'Always on top is off · keep widget above other windows'} disabled={!settings} onClick={()=>settings&&void save({alwaysOnTop:!settings.alwaysOnTop})} aria-label="Always on top" aria-pressed={!!settings?.alwaysOnTop}><Pin size={16}/></button>
        <button className="icon-button" title={settings?.followedOnly?'Following only is on · show all matches':'Showing all matches · filter to followed clubs'} disabled={!settings} onClick={()=>settings&&void save({followedOnly:!settings.followedOnly})} aria-label="Following only" aria-pressed={!!settings?.followedOnly}><ListFilter size={16}/>{settings?.followedOnly&&<span className="filter-dot"/>}</button>
        <button className="icon-button" title={busy?'Updating fixtures…':'Refresh fixtures and scores'} onClick={()=>void doRefresh()} disabled={busy} aria-label="Refresh" aria-busy={busy}><RefreshCw size={16} className={busy?'spin':''}/></button>
      </div>
    </footer>
  </main>;
}
