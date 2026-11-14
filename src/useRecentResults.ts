import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { competitionLeagues, competitionSlug } from './freshness';
import type { CompetitionView, LeagueResults, Match } from './types';

export interface RecentResults {matches:Match[];updatedAt:string|null;error:string|null;leagues?:Record<string,LeagueResults>}
const empty:RecentResults={matches:[],updatedAt:null,error:null,leagues:{}};
const REFRESH_MS = 300000;

// Results are fetched on demand, kept warm for six hours by the backend, and
// refreshed quietly while the Results view is open.
export function useRecentResults(enabled:boolean, view:CompetitionView='premierLeague'){
 const [data,setData]=useState(empty);
 const [loading,setLoading]=useState(false);
 const [revision,setRevision]=useState(0);
 const [attempted,setAttempted]=useState(false);
 // Which competition the retained data belongs to. Switching competition must
 // show a pending state, not a stale "No recent results" empty state, until the
 // new league's request settles.
 const [requestedView,setRequestedView]=useState<CompetitionView|null>(null);
 const attemptedRef=useRef(false);
 const forceNext=useRef(false);
 useEffect(()=>{
   let disposed=false;let inFlight=false;let timer:ReturnType<typeof setInterval>|undefined;
   const load=(initial:boolean)=>{
     if(disposed||inFlight)return;
      if(document.visibilityState==='hidden'){
        if(initial&&!attemptedRef.current){attemptedRef.current=true;setAttempted(true);}
        setLoading(false);
        return;
      }
     inFlight=true;
     if(initial)setLoading(true);
     const leagues=competitionLeagues(view).map(competitionSlug);
     const force=forceNext.current;
     forceNext.current=false;
     void invoke<RecentResults>('get_recent_results',force?{leagues,force:true}:{leagues})
       .then(result=>{if(!disposed){setData(result);setRequestedView(view);}})
       .catch(()=>{if(!disposed){
         const error='Could not load recent results. Cached results remain available.';
         setData(old=>({...old,error,leagues:{...old.leagues,...Object.fromEntries(leagues.map(league=>[league,{...old.leagues?.[league],error}]))}}));
         setRequestedView(view);
       }})
       .finally(()=>{
         inFlight=false;
         if(disposed)return;
         if(!attemptedRef.current){attemptedRef.current=true;setAttempted(true);}
         setLoading(false);
       });
   };
   const visible=()=>{if(document.visibilityState!=='hidden'&&enabled)load(false);};
   if(enabled){
     load(!attemptedRef.current);
     timer=setInterval(()=>load(false),REFRESH_MS);
     document.addEventListener('visibilitychange',visible);
   }else setLoading(false);
   return()=>{disposed=true;if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[enabled,revision,view]);
 const pendingView=requestedView!==null&&requestedView!==view;
 return {data:enabled?data:empty,loading:enabled&&(loading||!attempted||pendingView),retry:()=>{forceNext.current=true;if(enabled)setLoading(true);setRevision(n=>n+1);}};
}
