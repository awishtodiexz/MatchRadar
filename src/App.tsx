import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Lock, Maximize2, Minimize2, Pin, Radio, RefreshCw, Settings2, Star, Unlock, X } from 'lucide-react';
import logo from './assets/logo.png';
import { groupFixtures, isInProgress } from './fixtures';
import {
  competitionLeagues,
  competitionName,
  competitionSlug,
  competitionStatus,
  rateLimitedUntil,
  resultsStatus,
  updateStatus,
} from './freshness';
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
import { tickerMatches } from './ticker';
import type { MatchDetailsHandle } from './components/MatchDetails';
import type { MatchMemory } from './matchMemory';

const VIEWS = ['All', 'Live', 'Upcoming', 'Results'] as const;
// The global-shortcut conflict lasts until the other app releases the keys, so
// repeating it on every launch only costs vertical space. Show it once.
const SHORTCUT_NOTICE_KEY = 'matchradar.shortcutNoticeShown';
const SHORTCUT_MESSAGE =
  'Ctrl+Shift+M is used by another app, so the MatchRadar shortcut is off. Open the widget from the tray icon instead.';
const SCORE_CHANGE_MS = 3 * 60_000;
type ScoreChange = { at: number; home: boolean; away: boolean };
const followsTeam = (match: Match, favorites: string[]) =>
  favorites.includes(match.home.id) || favorites.includes(match.away.id);

export default function App() {
  const { snapshot, loading, load, refresh, save, error, opacityPreview } = useApp();
  const [view, setView] = useState<'home' | 'settings' | 'detail'>('home');
  const [themeHint] = useState<'dark' | 'light'>(() => {
    try {
      const theme = localStorage.getItem('matchradar.theme');
      return theme === 'light' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches)
        ? 'light'
        : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [matchView, setMatchView] = useState<MatchView>('All');
  const [selected, setSelected] = useState<Match | null>(null);
  const [notificationRequest, setNotificationRequest] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [systemTheme, setSystemTheme] = useState<'dark' | 'light'>(() =>
    window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  );
  // Session-only slim mode; the widget's full size is remembered so it can be restored.
  const [ticker, setTicker] = useState(false);
  const [tickerPinned, setTickerPinned] = useState<Match | null>(null);
  const detailRefresh = useRef<MatchDetailsHandle>(null);
  const matchSessions = useRef(new Map<string, MatchMemory>());
  const settingsReturn = useRef<'home' | 'detail'>('home');
  const [detailBusy, setDetailBusy] = useState(false);
  const tickerRestoreSize = useRef<{ width: number; height: number } | null>(null);
  const root = useRef<HTMLElement>(null);
  const restoreFocus = useRef('settings-control');
  const homeScroll = useRef(0);
  const previousView = useRef(view);
  const notificationFocus = useRef(0);
  const recoveryFocus = useRef(false);
  const focusClubSearch = useRef(false);
  // Scores seen on the previous snapshot, to flag a change for a few minutes.
  const previousScores = useRef(new Map<string, [number | null | undefined, number | null | undefined]>());
  const [scoreChanges, setScoreChanges] = useState<Record<string, ScoreChange>>({});
  const day = useLocalDay();
  const now = useNow(30_000);
  const native = isTauri();
  const settings = snapshot?.settings;
  const allMatches = snapshot?.matches;
  const opacityValue = opacityPreview ?? settings?.opacity ?? 96;
  const panelOpacity = Math.min(100, Math.max(70, opacityValue));
  const competitionView = settings?.competitionView ?? 'premierLeague';
  const competitionTitle = competitionView === 'both' ? 'Both competitions' : competitionName(competitionView);
  const competitionMatchesLabel =
    competitionView === 'both' ? 'matches from either competition' : `${competitionName(competitionView)} matches`;
  const historyView = matchView === 'Results';
  const recent = useRecentResults(historyView, competitionView);
  const viewStatus = competitionStatus(snapshot, competitionView);
  const viewResults = resultsStatus(recent.data, competitionView);
  const competitionMatches = useMemo(() => {
    const included = competitionLeagues(competitionView);
    return (allMatches ?? []).filter((m) => included.includes(m.league ?? 'premierLeague'));
  }, [allMatches, competitionView]);
  const sourceMatches = useMemo(() => {
    const included = competitionLeagues(competitionView);
    const base = historyView
      ? mergeResults(
          recent.data.matches,
          (allMatches ?? []).filter((m) => m.status === 'fulltime'),
        )
      : (allMatches ?? []);
    return base.filter((m) => included.includes(m.league ?? 'premierLeague'));
  }, [historyView, recent.data.matches, allMatches, competitionView]);
  const listError = historyView ? viewResults.error : viewStatus.error;
  const detailMatch = selected
    ? (mergeResults([selected], mergeResults(recent.data.matches, allMatches ?? [])).find(
        (m) => m.id === selected.id,
      ) ?? selected)
    : null;
  const tickerOptions = useMemo(
    () => tickerMatches(competitionMatches, settings?.favorites ?? [], now.getTime()),
    [competitionMatches, settings?.favorites, now],
  );
  const pinnedMatch = tickerPinned
    ? (allMatches?.find((match) => match.id === tickerPinned.id) ?? {
        ...tickerPinned,
        scoreStale: isInProgress(tickerPinned) || tickerPinned.scoreStale,
      })
    : null;
  const tickerMatch = pinnedMatch ?? (view === 'detail' ? detailMatch : null) ?? tickerOptions[0] ?? null;
  const tickerChoices =
    tickerMatch && !tickerOptions.some((match) => match.id === tickerMatch.id)
      ? [tickerMatch, ...tickerOptions]
      : tickerOptions;
  const cycleTicker = (direction: number) => {
    const index = tickerChoices.findIndex((match) => match.id === tickerMatch?.id);
    const next = tickerChoices[(index + direction + tickerChoices.length) % tickerChoices.length];
    if (next) setTickerPinned(next);
  };
  const rememberHome = () => {
    homeScroll.current = root.current?.querySelector('.match-list')?.scrollTop ?? 0;
  };
  const back = () => setView(view === 'settings' ? settingsReturn.current : 'home');
  const openSettings = () => {
    if (view === 'home') {
      rememberHome();
      restoreFocus.current = 'settings-control';
    }
    settingsReturn.current = view === 'detail' ? 'detail' : 'home';
    setView('settings');
  };
  const openMatch = (match: Match) => {
    rememberHome();
    restoreFocus.current = matchButtonId(match.id);
    setSelected(match);
    setView('detail');
  };
  useNotificationNavigation(native, (target) => {
    homeScroll.current = root.current?.querySelector('.match-list')?.scrollTop ?? homeScroll.current;
    if (target.match) {
      matchSessions.current.delete(target.match.id);
      setNotificationRequest(target.requestId);
      notificationFocus.current = target.requestId;
      restoreFocus.current = matchButtonId(target.match.id);
      setSelected(target.match);
      setView('detail');
      void load();
    } else {
      setSelected(null);
      setView('home');
      if (target.matchId)
        useApp.setState({
          error:
            'This notification’s match is no longer in the local fixture cache. Refresh matches to check availability.',
        });
    }
  });
  useEffect(() => {
    setSelected((current) => {
      if (!current) return current;
      const fresh = allMatches?.find((m) => m.id === current.id);
      return fresh ?? (isInProgress(current) && !current.scoreStale ? { ...current, scoreStale: true } : current);
    });
  }, [allMatches]);
  useEffect(() => {
    if (!allMatches) return;
    const changed: Record<string, ScoreChange> = {};
    for (const match of allMatches) {
      const previous = previousScores.current.get(match.id);
      if (
        previous &&
        previous[0] != null &&
        previous[1] != null &&
        match.homeScore != null &&
        match.awayScore != null &&
        (previous[0] !== match.homeScore || previous[1] !== match.awayScore)
      )
        changed[match.id] = {
          at: Date.now(),
          home: previous[0] !== match.homeScore,
          away: previous[1] !== match.awayScore,
        };
      previousScores.current.set(match.id, [match.homeScore, match.awayScore]);
    }
    if (Object.keys(changed).length) setScoreChanges((current) => ({ ...current, ...changed }));
  }, [allMatches]);
  useEffect(() => {
    setTickerPinned((current) => {
      if (!current) return current;
      return (
        allMatches?.find((match) => match.id === current.id) ??
        (isInProgress(current) && !current.scoreStale ? { ...current, scoreStale: true } : current)
      );
    });
  }, [allMatches]);
  useEffect(() => {
    void load();
    if (!native) return;
    let disposed = false;
    const listeners: Array<() => void> = [];
    for (const [event, callback] of [
      [
        'snapshot-updated',
        () => {
          void load();
        },
      ],
      [
        'open-settings',
        () => {
          homeScroll.current = root.current?.querySelector('.match-list')?.scrollTop ?? homeScroll.current;
          if (previousView.current !== 'settings')
            settingsReturn.current = previousView.current === 'detail' ? 'detail' : 'home';
          if (previousView.current === 'home') restoreFocus.current = 'settings-control';
          setView('settings');
        },
      ],
      [
        'shortcut-unavailable',
        () => {
          let shown = false;
          try {
            shown = localStorage.getItem(SHORTCUT_NOTICE_KEY) === '1';
            localStorage.setItem(SHORTCUT_NOTICE_KEY, '1');
          } catch {
            /* Storage unavailable: show the notice this session. */
          }
          if (!shown) useApp.setState({ error: SHORTCUT_MESSAGE });
        },
      ],
    ] as const) {
      void listen(event, callback)
        .then((fn) => {
          if (disposed) fn();
          else listeners.push(fn);
        })
        .catch(() => useApp.setState({ error: 'Could not subscribe to desktop updates.' }));
    }
    return () => {
      disposed = true;
      listeners.forEach((fn) => fn());
    };
  }, [load, native]);
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    if (view === 'home') {
      const list = root.current?.querySelector('.match-list');
      if (list) list.scrollTop = homeScroll.current;
      (document.getElementById(restoreFocus.current) ?? document.getElementById('settings-control'))?.focus({
        preventScroll: true,
      });
    } else if (view === 'settings' && focusClubSearch.current) {
      focusClubSearch.current = false;
      root.current?.querySelector<HTMLElement>('.settings-body input[type="search"]')?.focus();
    } else root.current?.querySelector<HTMLElement>('[data-view-heading]')?.focus();
  }, [view]);
  // The shortcut notice is informational; do not let it hold space for the whole session.
  useEffect(() => {
    if (error !== SHORTCUT_MESSAGE) return;
    const timer = setTimeout(() => {
      if (useApp.getState().error === SHORTCUT_MESSAGE) useApp.setState({ error: null });
    }, 12_000);
    return () => clearTimeout(timer);
  }, [error]);
  // A new filter or competition is a new list; do not strand the viewport at
  // the old scroll offset. Returning from details is handled above instead.
  useEffect(() => {
    if (view !== 'home') return;
    const list = root.current?.querySelector<HTMLElement>('.match-list');
    if (list) list.scrollTop = 0;
  }, [competitionView, matchView, settings?.followedOnly]);
  useEffect(() => {
    setTickerPinned(null);
  }, [competitionView]);
  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!preference) return;
    const changed = () => setSystemTheme(preference.matches ? 'light' : 'dark');
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (view !== 'detail' || !selected || !notificationFocus.current) return;
    const timer = setTimeout(() => {
      notificationFocus.current = 0;
      const target =
        root.current?.querySelector<HTMLElement>('.match-centre [role="tab"][aria-selected="true"]') ??
        root.current?.querySelector<HTMLElement>('[data-view-heading]');
      target?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [view, selected, notificationRequest]);
  const viewMatches = useMemo(
    () => matchesView(sourceMatches ?? [], matchView, settings?.favorites ?? [], settings?.followedOnly ?? false),
    [sourceMatches, matchView, settings?.favorites, settings?.followedOnly],
  );
  const matches = viewMatches;
  const groups = useMemo(
    () =>
      groupFixtures(matches, historyView ? [] : (settings?.favorites ?? []), day, historyView ? 'results' : 'fixtures'),
    [matches, settings?.favorites, day, historyView],
  );
  // Tab counts make empty views visible before they are opened. Results only has a
  // count once its history has loaded; an unknown count is left blank, not 0.
  const viewCounts = useMemo(() => {
    const favorites = settings?.favorites ?? [];
    if (!snapshot) return {};
    const visible = (items: Match[]) =>
      settings?.followedOnly ? items.filter((match) => followsTeam(match, favorites)) : items;
    const counts: Partial<Record<MatchView, number>> = {};
    for (const name of VIEWS)
      if (name !== 'Results') counts[name] = visible(matchesView(competitionMatches, name, favorites)).length;
    if (recent.data.updatedAt || recent.data.matches.length) {
      const included = competitionLeagues(competitionView);
      counts.Results = visible(
        mergeResults(recent.data.matches, competitionMatches).filter(
          (m) => m.status === 'fulltime' && included.includes(m.league ?? 'premierLeague'),
        ),
      ).length;
    }
    return counts;
  }, [
    competitionMatches,
    competitionView,
    recent.data.matches,
    recent.data.updatedAt,
    settings?.favorites,
    settings?.followedOnly,
    snapshot,
  ]);
  // Status is scoped to the selected competition(s), independent of card filters.
  const live = competitionMatches.filter(isInProgress).length;
  const savedLive = competitionMatches.some((m) => isInProgress(m) && m.scoreStale);
  const unchecked = snapshot?.leagueStatus
    ? competitionLeagues(competitionView).some((league) => !snapshot.leagueStatus?.[competitionSlug(league)]?.updatedAt)
    : !viewStatus.updatedAt;
  const feedUnavailable = !snapshot && !loading;
  // No confirmed score timestamp and no recorded failure means the first score
  // check for this competition has not completed. That is a checking state, not
  // an unavailable one, even when no refresh happens to be in flight (for
  // example immediately after switching to a cold Champions League view).
  const scoresUnconfirmed = !viewStatus.updatedAt && !viewStatus.error && !viewStatus.scoreError;
  const liveChecking = !feedUnavailable && !live && !savedLive && scoresUnconfirmed;
  const liveUnknown = !live && !savedLive && !liveChecking && (!!viewStatus.scoreError || unchecked);
  const liveAriaLabel = live
    ? savedLive
      ? `${live} in-progress ${live === 1 ? 'match' : 'matches'}, including saved scores awaiting confirmation`
      : `${live} live ${live === 1 ? 'match' : 'matches'}`
    : savedLive
      ? 'saved scores, awaiting live update'
      : liveChecking
        ? 'checking live status'
        : liveUnknown
          ? 'live status unavailable'
          : 'no confirmed live matches';
  const viewEmpty = viewMatches.length === 0;
  const followingEmpty = !!settings?.followedOnly && viewEmpty;
  const upcomingEmpty = matchView === 'Upcoming' && viewEmpty;
  const windowLabel = competitionView === 'both' ? 30 : competitionView === 'championsLeague' ? 30 : 14;
  const selectMatchView = (next: MatchView) => setMatchView(next);
  const showAllMatches = () => {
    recoveryFocus.current = true;
    if (settings?.followedOnly) void save({ followedOnly: false });
    else selectMatchView('All');
  };
  const liveStatusUnavailable = !liveChecking && (!!viewStatus.scoreError || unchecked);
  const liveEmpty = liveEmptyState({
    checking: liveChecking,
    scoreError: liveStatusUnavailable,
    savedLive,
    live,
    followedOnly: !!settings?.followedOnly,
    view: matchView,
    competition: competitionView === 'both' ? 'live' : competitionName(competitionView),
    both: competitionView === 'both',
  });
  const emptyTitle = feedUnavailable
    ? 'Unable to load matches'
    : (liveEmpty?.title ??
      (listError
        ? historyView
          ? 'Unable to update results'
          : viewStatus.partial
            ? 'Some updates are unavailable'
            : 'Unable to update matches'
        : followingEmpty
          ? 'No matches involving followed clubs'
          : upcomingEmpty
            ? 'No upcoming matches'
            : historyView
              ? 'No recent results'
              : viewEmpty
                ? 'No fixtures in this window'
                : 'No matches'));
  const emptyMessage = feedUnavailable
    ? (error ?? 'The widget’s saved fixtures could not be loaded. Try again in a moment.')
    : (liveEmpty?.message ??
      (listError
        ? historyView
          ? 'Could not update results. Any saved results remain available.'
          : viewStatus.partial
            ? 'Available data was saved, but some updates could not be confirmed.'
            : 'Could not update the feed. Any saved fixtures remain available.'
        : followingEmpty
          ? settings?.favorites.length
            ? 'Your followed clubs have no matches in this competition window.'
            : 'Follow a club in Settings to see its matches here.'
          : upcomingEmpty
            ? `No ${competitionMatchesLabel} are scheduled in the next ${windowLabel} days.`
            : historyView
              ? `No completed ${competitionMatchesLabel} were found in the previous 14 days.`
              : `No ${competitionMatchesLabel} are available for the next ${windowLabel} days.`));
  const emptyAction = feedUnavailable
    ? 'retry'
    : liveEmpty?.canShowAll || followingEmpty || upcomingEmpty
      ? 'show'
      : (liveEmpty && liveStatusUnavailable) || listError
        ? 'retry'
        : null;
  const waiting = historyView
    ? recent.loading && !matches.length
    : !allMatches?.length &&
      (loading ||
        (!!snapshot?.refreshing && !viewStatus.updatedAt && !viewStatus.fixtureUpdatedAt && !viewStatus.error));
  const busy = refreshing || !!snapshot?.refreshing;
  // Only claim completeness for windowed views whose data is confirmed fresh.
  const listComplete =
    !waiting &&
    !!matches.length &&
    matchView !== 'Live' &&
    !listError &&
    (historyView ? !recent.loading : !viewStatus.partial);
  const refreshBusy = view === 'detail' ? busy || detailBusy : view === 'home' && historyView ? recent.loading : busy;
  const refreshLabel =
    view === 'detail'
      ? 'Refresh match details and scores'
      : view === 'home' && historyView
        ? 'Refresh results'
        : 'Refresh fixtures and scores';
  const status = updateStatus(snapshot, competitionView);
  const limitedUntil = rateLimitedUntil(snapshot);
  const statusLabel = feedUnavailable ? 'NOT CONNECTED' : status.label;
  const statusAbsolute = status.timestamp ? `${dateLabel(status.timestamp)} ${timeLabel(status.timestamp)}` : undefined;
  // A rate-limit deadline is in the future, so it keeps its clock time.
  const statusTime = status.timestamp
    ? limitedUntil
      ? timeLabel(status.timestamp)
      : relativeAge(status.timestamp, now.getTime())
    : undefined;
  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };
  const refreshCurrent = () => {
    if (view === 'detail') {
      detailRefresh.current?.refresh();
      void doRefresh();
    } else if (view === 'home' && historyView) recent.retry();
    else void doRefresh();
  };
  const retryFeed = () => {
    recoveryFocus.current = true;
    if (feedUnavailable) {
      void doRefresh();
      return;
    }
    if (historyView) recent.retry();
    else void doRefresh();
  };
  // The control that triggered recovery disappears once content returns. Put
  // keyboard focus on the recovered list (or the active view tab if it is
  // still empty) instead of dropping it onto the document body.
  useEffect(() => {
    if (view !== 'home') {
      recoveryFocus.current = false;
      return;
    }
    if (!recoveryFocus.current || busy || (historyView && recent.loading)) return;
    const list = root.current?.querySelector<HTMLElement>('.match-list');
    const target = matches.length
      ? list?.querySelector<HTMLElement>('.match-open')
      : !feedUnavailable && !listError
        ? list?.querySelector<HTMLElement>('.centre-tabs button[aria-pressed="true"]')
        : null;
    if (target) {
      recoveryFocus.current = false;
      target.focus({ preventScroll: true });
    }
  }, [busy, matches.length, matchView, view, listError, error, historyView, recent.loading, feedUnavailable]);
  const toggleAlwaysOnTop = async () => {
    if (!settings) return;
    const next = !settings.alwaysOnTop;
    if (native) {
      try {
        await getCurrentWindow().setAlwaysOnTop(next);
      } catch {
        useApp.setState({ error: 'Could not change always-on-top.' });
        return;
      }
    }
    void save({ alwaysOnTop: next });
  };
  const toggleTicker = async () => {
    const next = !ticker;
    if (native) {
      const win = getCurrentWindow();
      try {
        if (next) {
          const size = (await win.innerSize()).toLogical(await win.scaleFactor());
          tickerRestoreSize.current = { width: size.width, height: size.height };
          await win.setMinSize(new LogicalSize(320, 112));
          await win.setSize(new LogicalSize(Math.max(320, Math.min(size.width, 420)), 112));
        } else {
          const saved = tickerRestoreSize.current ?? { width: 390, height: 700 };
          await win.setSize(new LogicalSize(saved.width, saved.height));
          await win.setMinSize(new LogicalSize(320, 460));
        }
      } catch {
        // Best effort: never leave the window stuck at the ticker's minimum height.
        if (next) void win.setMinSize(new LogicalSize(320, 460)).catch(() => {});
        useApp.setState({ error: 'Could not resize the widget.' });
        return false;
      }
    }
    setTicker(next);
    if (!next)
      requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLElement>(
            view === 'detail' ? '.match-centre > .centre-tabs [aria-selected="true"]' : '[aria-label="Ticker mode"]',
          )
          ?.focus({ preventScroll: true }),
      );
    return true;
  };
  // Clicking the ticker's match expands straight into that match.
  const openFromTicker = async () => {
    const match = tickerMatch;
    if (!(await toggleTicker()) || !match) return;
    restoreFocus.current = matchButtonId(match.id);
    setSelected(match);
    setView('detail');
  };
  // Step through the list the detail view was opened from, in on-screen order.
  const stepMatch = (direction: 1 | -1) => {
    const ordered = groups.flatMap((group) => group.matches);
    const index = ordered.findIndex((match) => match.id === selected?.id);
    const next = index < 0 ? undefined : ordered[index + direction];
    if (!next) return false;
    restoreFocus.current = matchButtonId(next.id);
    setSelected(next);
    // The details view remounts for the new match; keep keyboard focus in it.
    setTimeout(
      () =>
        (
          root.current?.querySelector<HTMLElement>('.match-centre [role="tab"][aria-selected="true"]') ??
          root.current?.querySelector<HTMLElement>('[data-view-heading]')
        )?.focus({ preventScroll: true }),
      0,
    );
    return true;
  };
  const contextMenu = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element) {
      if (target.closest('input, textarea, select, [data-copyable]')) return;
      const editable = target.closest('[contenteditable]')?.getAttribute('contenteditable')?.toLowerCase();
      if (editable === '' || editable === 'true' || editable === 'plaintext-only') return;
    }
    event.preventDefault();
  };
  type KeyInput = {
    key: string;
    defaultPrevented: boolean;
    target: EventTarget | null;
    preventDefault: () => void;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
  };
  const keyDown = (event: KeyInput) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !(event.target instanceof HTMLSelectElement)) {
      if (root.current?.querySelector('.alert-menu, .card-menu')) {
        event.preventDefault();
        return;
      }
      if (ticker) {
        event.preventDefault();
        void toggleTicker();
      } else if (view !== 'home') {
        event.preventDefault();
        back();
      }
      return;
    }
    // Single-key shortcuts never fire while typing, choosing, or inside a popover.
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || ticker) return;
    if (
      event.target instanceof Element &&
      event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    )
      return;
    if (root.current?.querySelector('.alert-menu, .card-menu')) return;
    const key = event.key;
    if (view === 'home' && /^[1-4]$/.test(key)) {
      event.preventDefault();
      selectMatchView(VIEWS[Number(key) - 1]);
    } else if ((key === 'r' || key === 'R') && !refreshBusy) {
      event.preventDefault();
      refreshCurrent();
    } else if (key === '/' && view !== 'settings') {
      event.preventDefault();
      focusClubSearch.current = true;
      openSettings();
    } else if (view === 'detail' && (key === '[' || key === ']')) {
      if (stepMatch(key === ']' ? 1 : -1)) event.preventDefault();
    }
  };
  // With focus on the page itself (for example after clicking a non-focusable
  // area) key events never reach <main>. Route only those through the same handler.
  const latestKeyDown = useRef(keyDown);
  latestKeyDown.current = keyDown;
  useEffect(() => {
    const unfocused = (event: globalThis.KeyboardEvent) => {
      if (event.target === document.body || event.target === document.documentElement) latestKeyDown.current(event);
    };
    window.addEventListener('keydown', unfocused);
    return () => window.removeEventListener('keydown', unfocused);
  }, []);
  return (
    <main
      ref={root}
      onKeyDown={keyDown}
      onContextMenu={contextMenu}
      className={
        'shell theme-' +
        (settings?.theme === 'system' ? systemTheme : (settings?.theme ?? themeHint)) +
        ' ' +
        (panelOpacity < 85 ? 'transparent-panel ' : '') +
        (settings?.compact ? 'compact-view ' : '') +
        (settings?.reducedMotion ? 'reduced ' : '') +
        (ticker ? 'ticker-mode' : '')
      }
      style={{ '--panel-opacity': panelOpacity / 100 } as CSSProperties}
    >
      <header className="header" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <span className="brand-icon">
            <img src={logo} alt="" />
          </span>
          <div data-tauri-drag-region>
            <h1>
              match<span>radar</span>
            </h1>
          </div>
        </div>
        <div className="header-actions">
          {ticker && (
            <button
              className="icon-button ticker-lock"
              aria-label="Lock ticker match"
              aria-pressed={!!tickerPinned}
              title={tickerPinned ? 'Unlock · automatically choose a match' : 'Lock this match in the ticker'}
              disabled={!tickerMatch}
              onClick={() => setTickerPinned(tickerPinned ? null : tickerMatch)}
            >
              {tickerPinned ? <Lock size={15} /> : <Unlock size={15} />}
            </button>
          )}
          <button
            className="icon-button"
            title={
              settings?.alwaysOnTop
                ? 'Always on top is on · unpin widget'
                : 'Always on top is off · keep widget above other windows'
            }
            disabled={!settings}
            onClick={() => void toggleAlwaysOnTop()}
            aria-label="Always on top"
            aria-pressed={!!settings?.alwaysOnTop}
          >
            <Pin size={15} fill={settings?.alwaysOnTop ? 'currentColor' : 'none'} />
          </button>
          <button
            className="icon-button"
            title={ticker ? 'Expand the full widget' : 'Collapse to a slim match ticker'}
            onClick={() => void toggleTicker()}
            aria-label="Ticker mode"
            aria-pressed={ticker}
          >
            {ticker ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          </button>
          <button
            className="icon-button close"
            title={
              native ? 'Hide to system tray · Ctrl+Shift+M shows it again' : 'Hide is available in the desktop app'
            }
            disabled={!native}
            onClick={() =>
              void getCurrentWindow()
                .hide()
                .catch(() => useApp.setState({ error: 'Could not hide the widget.' }))
            }
            aria-label="Hide widget"
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {ticker ? (
        <TickerView
          match={tickerMatch}
          onExpand={() => void toggleTicker()}
          onOpen={() => void openFromTicker()}
          navigation={{
            canCycle: tickerChoices.length > 1,
            onPrevious: () => cycleTicker(-1),
            onNext: () => cycleTicker(1),
          }}
        />
      ) : view === 'settings' && settings ? (
        <SettingsPanel
          settings={settings}
          matches={allMatches ?? []}
          save={save}
          back={back}
          backLabel={settingsReturn.current === 'detail' ? 'Back to match' : 'Back to matches'}
        />
      ) : view === 'detail' && selected && settings ? (
        <MatchDetails
          ref={detailRefresh}
          onBusyChange={setDetailBusy}
          sessions={matchSessions.current}
          key={`${selected.id}:${notificationRequest}`}
          match={detailMatch ?? selected}
          settings={settings}
          back={back}
        />
      ) : (
        <>
          <div className="summary">
            <CompetitionPicker
              value={competitionView}
              onChange={(value) => void save({ competitionView: value })}
              disabled={!settings}
            />
            <span
              className={'live-pill ' + (!live ? 'quiet' : '')}
              aria-label={`${competitionTitle}: ${liveAriaLabel}${settings?.followedOnly ? ', all clubs' : ''}`}
              title={`In-progress matches${settings?.followedOnly ? ' for all clubs, not only followed ones' : ''}, including half-time and suspended games.`}
            >
              <i className="dot" />
              {live
                ? `${live} ${savedLive ? 'LIVE · SAVED' : 'LIVE'}`
                : savedLive
                  ? 'SAVED LIVE'
                  : liveChecking
                    ? 'CHECKING LIVE'
                    : liveUnknown
                      ? 'LIVE UNAVAILABLE'
                      : 'NO LIVE MATCHES'}
            </span>
          </div>
          <div className="match-list">
            <nav className="centre-tabs" aria-label="Fixture views">
              {VIEWS.map((name) => {
                const count = viewCounts[name];
                return (
                  <button
                    key={name}
                    aria-pressed={matchView === name}
                    className={count === 0 ? 'is-empty' : undefined}
                    title={
                      count === undefined
                        ? name === 'Results'
                          ? 'Open to load recent results'
                          : undefined
                        : `${count} ${count === 1 ? 'match' : 'matches'}`
                    }
                    onClick={() => selectMatchView(name)}
                  >
                    {name}
                    {count !== undefined && (
                      <span className="tab-count" aria-hidden="true">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="schedule-context">
              <div>
                <time dateTime={day.toISOString()}>{dateLabel(day.toISOString())}</time>
                <p
                  className="schedule-note"
                  title={
                    historyView && viewResults.updatedAt
                      ? `Results checked ${dateLabel(viewResults.updatedAt)} ${timeLabel(viewResults.updatedAt)}`
                      : undefined
                  }
                >
                  {historyView
                    ? viewResults.updatedAt
                      ? `Latest first · checked ${relativeAge(viewResults.updatedAt, now.getTime())}`
                      : 'Latest first'
                    : `Next ${windowLabel} days`}
                </p>
              </div>
              <button
                className="following-filter"
                aria-label="Following only"
                title="Show only followed clubs in this view"
                aria-pressed={!!settings?.followedOnly}
                disabled={!settings}
                onClick={() => void save({ followedOnly: !settings?.followedOnly })}
              >
                <Star size={12} fill={settings?.followedOnly ? 'currentColor' : 'none'} aria-hidden="true" />
                Following only
              </button>
            </div>
            {listError && !!sourceMatches?.length && (
              <div className="offline-banner" role="status" title={listError}>
                <span>
                  {historyView
                    ? 'Results update failed · cached results retained'
                    : viewStatus.partial
                      ? 'Partial update · some data may be stale'
                      : 'Update failed · saved data is unchanged'}
                </span>
                <button onClick={retryFeed} disabled={historyView ? recent.loading : busy}>
                  Retry
                </button>
              </div>
            )}
            {waiting ? (
              <div className="skeletons" role="status" aria-label="Loading fixtures">
                <div />
                <div />
                <div />
              </div>
            ) : !matches.length ? (
              <div className="empty" role={feedUnavailable ? 'alert' : undefined}>
                <Radio size={25} />
                <h2>{emptyTitle}</h2>
                <p>{emptyMessage}</p>
                {emptyAction === 'show' ? (
                  <button className="outline-button" onClick={showAllMatches}>
                    Show all matches
                  </button>
                ) : emptyAction === 'retry' ? (
                  <button className="outline-button" onClick={retryFeed} disabled={historyView ? recent.loading : busy}>
                    <RefreshCw size={14} />
                    Retry
                  </button>
                ) : null}
              </div>
            ) : (
              settings &&
              groups.map(({ key, label, matches: items }) => (
                <section key={key} aria-labelledby={'date-group-' + key}>
                  <h2
                    id={'date-group-' + key}
                    className={
                      'group-title ' + (key === 'live' && items.some((m) => !m.scoreStale) ? 'live-group' : '')
                    }
                  >
                    <span>{label}</span>
                    <span>
                      {items.length} {items.length === 1 ? 'match' : 'matches'}
                    </span>
                  </h2>
                  {items.map((match, index) => {
                    // Followed clubs lead each day; label the split so the order does not read as a sorting bug.
                    const followed = followsTeam(match, settings.favorites);
                    const split =
                      !historyView &&
                      key !== 'live' &&
                      !settings.followedOnly &&
                      items.some((m) => followsTeam(m, settings.favorites)) &&
                      items.some((m) => !followsTeam(m, settings.favorites));
                    const heading =
                      split && (index === 0 || followsTeam(items[index - 1], settings.favorites) !== followed) ? (
                        <p className="group-subtitle" key={match.id + '-heading'}>
                          {followed ? 'Your clubs' : 'Other matches'}
                        </p>
                      ) : null;
                    return [
                      heading,
                      <MatchCard
                        key={match.id}
                        match={match}
                        settings={settings}
                        now={now}
                        onOpen={() => openMatch(match)}
                        showCompetition={competitionView === 'both'}
                        scoreChange={
                          scoreChanges[match.id] && now.getTime() - scoreChanges[match.id].at < SCORE_CHANGE_MS
                            ? scoreChanges[match.id]
                            : undefined
                        }
                      />,
                    ];
                  })}
                </section>
              ))
            )}
            {/* Marks a complete list, so a short one does not read as still loading. */}
            {listComplete && (
              <p className="list-end">
                {historyView
                  ? `That’s every result${settings?.followedOnly ? ' for followed clubs' : ''} from the last 14 days`
                  : `That’s everything${settings?.followedOnly ? ' for followed clubs' : ''} in the next ${windowLabel} days`}
              </p>
            )}
          </div>
        </>
      )}
      {error && !feedUnavailable && (
        <div className="error-banner" role="alert">
          <span data-copyable>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            title="Dismiss message"
            onClick={() => useApp.setState({ error: null })}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!ticker && (
        <footer>
          <div
            className="connection-info"
            role="status"
            title={[statusLabel, statusAbsolute, 'Live scores refresh about every 60 seconds']
              .filter(Boolean)
              .join(' · ')}
          >
            <span
              className={
                'connection ' + (viewStatus.error || feedUnavailable ? 'error' : !viewStatus.updatedAt ? 'pending' : '')
              }
              aria-hidden="true"
            />
            <div className="status-copy">
              <span>{statusLabel}</span>
              {statusTime && <time dateTime={status.timestamp ?? undefined}>{statusTime}</time>}
            </div>
          </div>
          <div className="footer-actions">
            <button
              id="settings-control"
              className="icon-button"
              title={
                view === 'settings'
                  ? `Return to ${settingsReturn.current === 'detail' ? 'match' : 'matches'} (Esc)`
                  : 'Open Settings'
              }
              onClick={() => (view === 'settings' ? back() : openSettings())}
              aria-label="Settings"
              aria-pressed={view === 'settings'}
            >
              <Settings2 size={16} />
            </button>
            <button
              className="icon-button"
              title={
                refreshBusy
                  ? 'Updating…'
                  : limitedUntil
                    ? `${refreshLabel} · ESPN is rate limiting requests until ${timeLabel(limitedUntil)}`
                    : refreshLabel
              }
              onClick={refreshCurrent}
              disabled={refreshBusy}
              aria-label="Refresh"
              aria-busy={refreshBusy}
            >
              <RefreshCw size={16} className={refreshBusy ? 'spin' : ''} />
            </button>
          </div>
        </footer>
      )}
    </main>
  );
}
