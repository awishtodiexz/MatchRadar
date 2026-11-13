import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Maximize2, Minimize2, Pin, Radio, RefreshCw, Settings2, X } from 'lucide-react';
import logo from './assets/logo.png';
import { groupFixtures, isInProgress, isLive } from './fixtures';
import { competitionLeagues, competitionName, competitionSlug, competitionStatus, rateLimitedUntil, resultsStatus, updateStatus } from './freshness';
import { useApp } from './store';
import { useLocalDay } from './useLocalDay';
import { useNotificationNavigation } from './useNotificationNavigation';
import { useRecentResults } from './useRecentResults';
import { mergeResults, matchesView } from './matchViews';
import { liveEmptyState } from './emptyState';
import type { MatchView } from './matchViews';
import type { Match } from './types';
import { dateLabel, matchButtonId, relativeAge, timeLabel } from './presentation';
import { useNow } from './countdown';
import { MatchCard } from './components/MatchCard';
import { MatchDetails } from './components/MatchDetails';
import { SettingsPanel } from './components/SettingsPanel';
import { CompetitionPicker } from './components/CompetitionPicker';
import { TickerView } from './components/TickerView';

const VIEWS = ['All','Live','Following','Upcoming','Results'] as const;
// The global-shortcut conflict lasts until the other app releases the keys, so
// repeating it on every launch only costs vertical space. Show it once.
const SHORTCUT_NOTICE_KEY = 'matchradar.shortcutNoticeShown';
const SHORTCUT_MESSAGE = 'Ctrl+Shift+M is used by another app, so the MatchRadar shortcut is off. Open the widget from the tray icon instead.';
const followsTeam = (match:Match, favorites:string[]) => favorites.includes(match.home.id)||favorites.includes(match.away.id);

export default function App() {
  const {snapshot,loading,load,refresh,save,error,opacityPreview} = useApp();
  const [view,setView] = useState<'home'|'settings'|'detail'>('home');
  const [themeHint] = useState<'dark'|'light'>(()=>{try{const theme=localStorage.getItem('matchradar.theme');return theme==='light'||(theme==='system'&&window.matchMedia?.('(prefers-color-scheme: light)').matches)?'light':'dark';}catch{return 'dark';}});
  const [matchView,setMatchView] = useState<MatchView>('All');
  const [selected,setSelected] = useState<Match|null>(null);
  const [notificationRequest,setNotificationRequest] = useState(0);
  const [refreshing,setRefreshing] = useState(false);
  const [systemTheme,setSystemTheme] = useState<'dark'|'light'>(()=>window.matchMedia?.('(prefers-color-scheme: light)').matches?'light':'dark');
  // Session-only slim mode; the widget's full size is remembered so it can be restored.
  const [ticker,setTicker] = useState(false);
  const tickerRestoreSize = useRef<{width:number;height:number}|null>(null);
  const root = useRef<HTMLElement>(null);
  const restoreFocus = useRef('settings-control');
  const homeScroll = useRef(0);
  const previousView = useRef(view);
  const notificationFocus = useRef(0);
  const recoveryFocus = useRef(false);
  const day = useLocalDay();
  const now = useNow(30_000);
  const native = isTauri();
  const settings = snapshot?.settings;
  const allMatches = snapshot?.matches;
  const opacityValue = opacityPreview ?? settings?.opacity ?? 96;
  const panelOpacity = Math.min(100, Math.max(70, opacityValue));
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
    const base=historyView?mergeResults(recent.data.matches,(allMatches??[]).filter(m=>m.status==='fulltime')):(allMatches??[]);
    return base.filter(m=>included.includes(m.league??'premierLeague'));
  },[historyView,recent.data.matches,allMatches,competitionView]);
  const listError=historyView?viewResults.error:viewStatus.error;
  const detailMatch = selected ? mergeResults([selected],mergeResults(recent.data.matches,allMatches??[])).find(m=>m.id===selected.id)??selected : null;
  // Ticker shows the match in front of the user: the open detail, else the first confirmed live match, else the next kick-off.
  const tickerMatch = (view==='detail'&&detailMatch)
    ? detailMatch
    : competitionMatches.find(m=>isLive(m)&&!m.scoreStale)
      ?? [...competitionMatches].filter(m=>m.status==='scheduled'&&Date.parse(m.kickoff)>Date.now()).sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff))[0]
      ?? null;
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
      notificationFocus.current=target.requestId;
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
      return fresh??(isInProgress(current)&&!current.scoreStale?{...current,scoreStale:true}:current);
    });
  },[allMatches]);
  useEffect(()=>{
    void load();
    if(!native) return;
    let disposed=false;
    const listeners:Array<()=>void>=[];
    for(const [event,callback] of [['snapshot-updated',()=>{void load();}],['open-settings',()=>{homeScroll.current=root.current?.querySelector('.match-list')?.scrollTop??homeScroll.current;restoreFocus.current='settings-control';setView('settings');}],['shortcut-unavailable',()=>{let shown=false;try{shown=localStorage.getItem(SHORTCUT_NOTICE_KEY)==='1';localStorage.setItem(SHORTCUT_NOTICE_KEY,'1');}catch{/* Storage unavailable: show the notice this session. */}if(!shown)useApp.setState({error:SHORTCUT_MESSAGE});}]] as const) {
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
  // The shortcut notice is informational; do not let it hold space for the whole session.
  useEffect(()=>{
    if(error!==SHORTCUT_MESSAGE) return;
    const timer=setTimeout(()=>{if(useApp.getState().error===SHORTCUT_MESSAGE)useApp.setState({error:null});},12_000);
    return ()=>clearTimeout(timer);
  },[error]);
  // A new filter or competition is a new list; do not strand the viewport at
  // the old scroll offset. Returning from details is handled above instead.
  useEffect(()=>{
    if(view!=='home') return;
    const list=root.current?.querySelector<HTMLElement>('.match-list');
    if(list) list.scrollTop=0;
  },[competitionView,matchView]);
  useEffect(()=>{
    if(settings?.followedOnly) setMatchView('Following');
    else setMatchView(current=>current==='Following'?'All':current);
  },[settings?.followedOnly]);
  useEffect(()=>{
    const preference=window.matchMedia?.('(prefers-color-scheme: light)');
    if(!preference) return;
    const changed=()=>setSystemTheme(preference.matches?'light':'dark');
    preference.addEventListener('change',changed);
    return ()=>preference.removeEventListener('change',changed);
  },[]);
  useEffect(()=>{
    if(view!=='detail'||!selected||!notificationFocus.current) return;
    const timer=setTimeout(()=>{
      notificationFocus.current=0;
      const target=root.current?.querySelector<HTMLElement>('.match-centre [role="tab"][aria-selected="true"]')
        ?? root.current?.querySelector<HTMLElement>('[data-view-heading]');
      target?.focus();
    },0);
    return ()=>clearTimeout(timer);
  },[view,selected,notificationRequest]);
  const viewMatches = useMemo(()=>matchesView(sourceMatches??[],matchView,settings?.favorites??[]),[sourceMatches,matchView,settings?.favorites]);
  const matches = viewMatches;
  const groups = useMemo(()=>groupFixtures(matches,historyView?[]:settings?.favorites??[],day,historyView?'results':'fixtures'),[matches,settings?.favorites,day,historyView]);
  // Tab counts make empty views visible before they are opened. Results only has a
  // count once its history has loaded; an unknown count is left blank, not 0.
  const viewCounts = useMemo(()=>{
    const favorites=settings?.favorites??[];
    if(!snapshot) return {};
    const visible=(items:Match[])=>items;
    const counts:Partial<Record<MatchView,number>>={};
    for(const name of VIEWS) if(name!=='Results') counts[name]=visible(matchesView(competitionMatches,name,favorites)).length;
    if(recent.data.updatedAt||recent.data.matches.length) {
      const included=competitionLeagues(competitionView);
      counts.Results=visible(mergeResults(recent.data.matches,competitionMatches).filter(m=>m.status==='fulltime'&&included.includes(m.league??'premierLeague'))).length;
    }
    return counts;
  },[competitionMatches,competitionView,recent.data.matches,recent.data.updatedAt,settings?.favorites,snapshot]);
  // Status is scoped to the selected competition(s), independent of card filters.
  const live = competitionMatches.filter(isInProgress).length;
  const savedLive = competitionMatches.some(m=>isInProgress(m)&&m.scoreStale);
  const unchecked = snapshot?.leagueStatus
    ? competitionLeagues(competitionView).some(league=>!snapshot.leagueStatus?.[competitionSlug(league)]?.updatedAt)
    : !viewStatus.updatedAt;
  const feedUnavailable = !snapshot&&!loading;
  // No confirmed score timestamp and no recorded failure means the first score
  // check for this competition has not completed. That is a checking state, not
  // an unavailable one, even when no refresh happens to be in flight (for
  // example immediately after switching to a cold Champions League view).
  const scoresUnconfirmed = !viewStatus.updatedAt&&!viewStatus.error&&!viewStatus.scoreError;
  const liveChecking = !feedUnavailable&&!live&&!savedLive&&scoresUnconfirmed;
  const liveUnknown = !live&&!savedLive&&!liveChecking&&(!!viewStatus.scoreError||unchecked);
  const viewEmpty = viewMatches.length===0;
  const followingEmpty = matchView==='Following' && viewEmpty;
  const upcomingEmpty = matchView==='Upcoming' && viewEmpty;
  const windowLabel = competitionView==='both'?30:competitionView==='championsLeague'?30:14;
  const selectMatchView = (next:MatchView) => {setMatchView(next);if(settings&&settings.followedOnly!==(next==='Following')) void save({followedOnly:next==='Following'});};
  const showAllMatches = () => {recoveryFocus.current=true;selectMatchView('All');};
  const liveStatusUnavailable=!liveChecking&&(!!viewStatus.scoreError||unchecked);
  const liveEmpty = liveEmptyState({checking:liveChecking,scoreError:liveStatusUnavailable,savedLive,live,followedOnly:false,view:matchView,competition:competitionView==='both'?'live':competitionName(competitionView),both:competitionView==='both'});
  const emptyTitle = feedUnavailable ? 'Unable to load matches' : liveEmpty?.title ?? (
    listError ? (historyView?'Unable to update results':viewStatus.partial?'Some updates are unavailable':'Unable to update matches')
    : followingEmpty ? 'No matches involving followed clubs'
    : upcomingEmpty ? 'No upcoming matches'
    : historyView ? 'No recent results'
    : viewEmpty ? 'No fixtures in this window'
    : 'No matches'
  );
  const emptyMessage = feedUnavailable ? (error ?? 'The widget’s saved fixtures could not be loaded. Try again in a moment.') : liveEmpty?.message ?? (
    listError ? (historyView?'Could not update results. Any saved results remain available.':viewStatus.partial?'Available data was saved, but some updates could not be confirmed.':'Could not update the feed. Any saved fixtures remain available.')
    : followingEmpty ? (settings?.favorites.length?'Your followed clubs have no matches in this competition window.':'Follow a club in Settings to see its matches here.')
    : upcomingEmpty ? `No ${competitionMatchesLabel} are scheduled in the next ${windowLabel} days.`
    : historyView ? `No completed ${competitionMatchesLabel} were found in the previous 14 days.`
    : `No ${competitionMatchesLabel} are available for the next ${windowLabel} days.`
  );
  const emptyAction = feedUnavailable ? 'retry'
    : liveEmpty?.canShowAll||followingEmpty||upcomingEmpty ? 'show'
    : (liveEmpty&&liveStatusUnavailable||listError ? 'retry' : null);
  const waiting = historyView?recent.loading&&!matches.length:!allMatches?.length&&(loading||!!snapshot?.refreshing&&!viewStatus.updatedAt&&!viewStatus.fixtureUpdatedAt&&!viewStatus.error);
  const busy = refreshing||!!snapshot?.refreshing;
  const status = updateStatus(snapshot,competitionView);
  const limitedUntil = rateLimitedUntil(snapshot);
  const statusLabel = feedUnavailable?'NOT CONNECTED':status.label;
  const statusAbsolute = status.timestamp?`${dateLabel(status.timestamp)} ${timeLabel(status.timestamp)}`:undefined;
  // A rate-limit deadline is in the future, so it keeps its clock time.
  const statusTime = status.timestamp?(limitedUntil?timeLabel(status.timestamp):relativeAge(status.timestamp,now.getTime())):undefined;
  const doRefresh = async () => {setRefreshing(true);try{await refresh();}finally{setRefreshing(false);}};
  const retryFeed = () => {recoveryFocus.current=true;if(historyView) recent.retry();else void doRefresh();};
  // The control that triggered recovery disappears once content returns. Put
  // keyboard focus on the recovered list (or the active view tab if it is
  // still empty) instead of dropping it onto the document body.
  useEffect(()=>{
    if(view!=='home'){recoveryFocus.current=false;return;}
    if(!recoveryFocus.current||busy||(historyView&&recent.loading)) return;
    const list=root.current?.querySelector<HTMLElement>('.match-list');
    const target=matches.length
      ? list?.querySelector<HTMLElement>('.match-open')
      : !feedUnavailable&&!listError ? list?.querySelector<HTMLElement>('.centre-tabs button[aria-pressed="true"]') : null;
    if(target){recoveryFocus.current=false;target.focus({preventScroll:true});}
  },[busy,matches.length,matchView,view,listError,error,historyView,recent.loading,feedUnavailable]);
  const toggleAlwaysOnTop = async () => {
    if(!settings) return;
    const next = !settings.alwaysOnTop;
    if(native) {
      try{await getCurrentWindow().setAlwaysOnTop(next);}
      catch{useApp.setState({error:'Could not change always-on-top.'});return;}
    }
    void save({alwaysOnTop:next});
  };
  const toggleTicker = async () => {
    const next = !ticker;
    if(native) {
      const win = getCurrentWindow();
      try{
        if(next) {
          const size = (await win.innerSize()).toLogical(await win.scaleFactor());
          tickerRestoreSize.current = {width:size.width,height:size.height};
          await win.setMinSize(new LogicalSize(320,112));
          await win.setSize(new LogicalSize(Math.max(320,Math.min(size.width,420)),112));
        } else {
          const saved = tickerRestoreSize.current ?? {width:390,height:700};
          await win.setSize(new LogicalSize(saved.width,saved.height));
          await win.setMinSize(new LogicalSize(320,460));
        }
      } catch {
        // Best effort: never leave the window stuck at the ticker's minimum height.
        if(next) void win.setMinSize(new LogicalSize(320,460)).catch(()=>{});
        useApp.setState({error:'Could not resize the widget.'});
        return;
      }
    }
    setTicker(next);
  };
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
    if(event.key==='Escape'&&!event.defaultPrevented&&!(event.target instanceof HTMLSelectElement)) {
      if(root.current?.querySelector('.alert-menu')) {event.preventDefault();return;}
      if(ticker) {event.preventDefault();void toggleTicker();}
      else if(view!=='home') {event.preventDefault();back();}
    }
  };
  return <main ref={root} onKeyDown={keyDown} onContextMenu={contextMenu} className={'shell theme-'+(settings?.theme==='system'?systemTheme:settings?.theme??themeHint)+' '+(panelOpacity<85?'transparent-panel ':'')+(settings?.compact?'compact-view ':'')+(settings?.reducedMotion?'reduced ':'')+(ticker?'ticker-mode':'')} style={{'--panel-opacity':panelOpacity/100} as CSSProperties}>
    <header className="header" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region><span className="brand-icon"><img src={logo} alt=""/></span><div data-tauri-drag-region><h1>match<span>radar</span></h1></div></div>
      <div className="header-actions">
        <button className="icon-button" title={settings?.alwaysOnTop?'Always on top is on · unpin widget':'Always on top is off · keep widget above other windows'} disabled={!settings} onClick={()=>void toggleAlwaysOnTop()} aria-label="Always on top" aria-pressed={!!settings?.alwaysOnTop}><Pin size={15} fill={settings?.alwaysOnTop?'currentColor':'none'}/></button>
        <button className="icon-button" title={ticker?'Expand the full widget':'Collapse to a slim match ticker'} onClick={()=>void toggleTicker()} aria-label="Ticker mode" aria-pressed={ticker}>{ticker?<Maximize2 size={15}/>:<Minimize2 size={15}/>}</button>
        <button className="icon-button close" title={native?'Hide to system tray':'Hide is available in the desktop app'} disabled={!native} onClick={()=>void getCurrentWindow().hide().catch(()=>useApp.setState({error:'Could not hide the widget.'}))} aria-label="Hide widget"><X size={16}/></button>
      </div>
    </header>
    {ticker?<TickerView match={tickerMatch} onExpand={()=>void toggleTicker()}/>
      :view==='settings'&&settings?<SettingsPanel settings={settings} matches={allMatches??[]} save={save} back={back} refresh={()=>void doRefresh()} refreshing={busy}/>
      :view==='detail'&&selected&&settings?<MatchDetails key={`${selected.id}:${notificationRequest}`} match={detailMatch??selected} settings={settings} back={back}/>
      :<>
        <div className="summary"><CompetitionPicker value={competitionView} onChange={value=>void save({competitionView:value})} disabled={!settings}/><span className={'live-pill '+(!live?'quiet':'')} aria-label={`${competitionTitle}: ${live?`${live} ${savedLive?'in-progress matches, including saved scores awaiting confirmation':'live matches'}`:savedLive?'saved scores, awaiting live update':liveChecking?'checking live status':liveUnknown?'live status unavailable':'no confirmed live matches'}`} title="In-progress matches, including half-time and suspended games."><i className="dot"/>{live?`${live} ${savedLive?'LIVE · SAVED':'LIVE'}`:savedLive?'SAVED LIVE':liveChecking?'CHECKING LIVE':liveUnknown?'LIVE UNAVAILABLE':'NO LIVE MATCHES'}</span></div>
        <div className="match-list">
          <nav className="centre-tabs" aria-label="Fixture views">{VIEWS.map(name=>{const count=viewCounts[name];return <button key={name} aria-pressed={matchView===name} className={count===0?'is-empty':undefined} title={count===undefined?undefined:`${count} ${count===1?'match':'matches'}`} onClick={()=>selectMatchView(name)}>{name}{count!==undefined&&<span className="tab-count" aria-hidden="true">{count}</span>}</button>;})}</nav>
          <div className="schedule-context"><time dateTime={day.toISOString()}>{dateLabel(day.toISOString())}</time><p className="schedule-note">{historyView?'Results · latest first':`Next ${windowLabel} days`}</p></div>
          {listError&&!!sourceMatches?.length&&<div className="offline-banner" role="status" title={listError}><span>{historyView?'Results update failed - cached results retained':viewStatus.partial?'Partial update · some data may be stale':'Update failed · saved data is unchanged'}</span><button onClick={retryFeed} disabled={historyView?recent.loading:busy}>Retry</button></div>}
          {historyView&&viewResults.updatedAt&&<p className="field-note">Results checked {`${dateLabel(viewResults.updatedAt)} ${timeLabel(viewResults.updatedAt)}`}</p>}
          {waiting?<div className="skeletons" role="status" aria-label="Loading fixtures"><div/><div/><div/></div>
            :!matches.length?<div className="empty" role={feedUnavailable?'alert':undefined}><Radio size={25}/><h2>{emptyTitle}</h2>
              <p>{emptyMessage}</p>
              {emptyAction==='show'?<button className="outline-button" onClick={showAllMatches}>Show all matches</button>:emptyAction==='retry'?<button className="outline-button" onClick={retryFeed} disabled={historyView?recent.loading:busy}><RefreshCw size={14}/>Retry</button>:null}
            </div>
            :settings&&groups.map(({key,label,matches:items})=><section key={key} aria-labelledby={'date-group-'+key}><h2 id={'date-group-'+key} className={'group-title '+(key==='live'&&items.some(m=>!m.scoreStale)?'live-group':'')}><span>{label}</span><span>{items.length} {items.length===1?'match':'matches'}</span></h2>{items.map((match,index)=>{
              // Followed clubs lead each day; label the split so the order does not read as a sorting bug.
              const followed=followsTeam(match,settings.favorites);
              const split=!historyView&&key!=='live'&&matchView!=='Following'&&items.some(m=>followsTeam(m,settings.favorites))&&items.some(m=>!followsTeam(m,settings.favorites));
              const heading=split&&(index===0||followsTeam(items[index-1],settings.favorites)!==followed)?<p className="group-subtitle" key={match.id+'-heading'}>{followed?'Your clubs':'Other matches'}</p>:null;
              return [heading,<MatchCard key={match.id} match={match} settings={settings} now={now} onOpen={()=>openMatch(match)} showCompetition={competitionView==='both'}/>];
            })}</section>)}
        </div>
      </>}
    {error&&!feedUnavailable&&<div className="error-banner" role="alert"><span data-copyable>{error}</span><button className="icon-button" aria-label="Dismiss message" title="Dismiss message" onClick={()=>useApp.setState({error:null})}><X size={14}/></button></div>}
    {!ticker&&<footer>
      <div className="connection-info" role="status" title={[statusLabel,statusAbsolute,'Live scores refresh about every 60 seconds'].filter(Boolean).join(' · ')}><span className={'connection '+(viewStatus.error||feedUnavailable?'error':!viewStatus.updatedAt?'pending':'')} aria-hidden="true"/><div className="status-copy"><span>{statusLabel}</span>{statusTime&&<time dateTime={status.timestamp??undefined}>{statusTime}</time>}</div></div>
      <div className="footer-actions">
        <button id="settings-control" className="icon-button" title={view==='settings'?'Return to matches (Esc)':'Open Settings'} onClick={()=>view==='settings'?back():openSettings()} aria-label="Settings" aria-pressed={view==='settings'}><Settings2 size={16}/></button>
        <button className="icon-button" title={busy?'Updating fixtures…':limitedUntil?`ESPN is rate limiting requests · updates resume automatically at ${timeLabel(limitedUntil)}`:'Refresh fixtures and scores only · use Refresh match details for lineups, statistics and commentary'} onClick={()=>void doRefresh()} disabled={busy} aria-label="Refresh" aria-busy={busy}><RefreshCw size={16} className={busy?'spin':''}/></button>
      </div>
    </footer>}
  </main>;
}
