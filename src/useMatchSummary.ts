import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
export interface MatchScorer { teamId:string; teamName:string; name:string; minute:string; ownGoal:boolean; penalty:boolean }
export interface MatchSummary {
  matchId:string; matchState?:string|null; updatedAt:string; stale:boolean; error:string|null;
  venue:string|null;
  venueCity?:string|null;
  referee?:string|null;
  capacity?:number|null;
  statisticsNote?:string|null;
  events:Array<{id:string;minute:string;period:number;seconds:number;kind:string;text:string;teamId:string|null;participants?:string[];shortText?:string|null;reason?:string|null}>;
  statistics:Array<{teamId:string;name:string;label:string;value:string}>;
  players:Array<{teamId:string;name:string;position:string;starter:boolean;jersey?:string|null;formationPlace?:number|null;subbedIn?:boolean;subbedOut?:boolean}>;
  coaches?:Array<{teamId:string;name:string}>;
  scorers?:MatchScorer[];
  substitutions?:Array<{teamId:string;playerIn:string;playerOut:string;minute:string}>;
  formations?:Record<string,string>;
  attendance?:number|null;
  form?:Record<string,Array<{opponent:string;opponentId:string;result:string;score:string;atHome:boolean;date?:string|null}>>;
  leaders?:Array<{teamId:string;category:string;name:string;jersey?:string|null;position:string;value:string;athleteId?:string|null;apps?:number|null}>;
  /** ESPN header.season.name, e.g. "2026-27 English Premier League". */
  seasonName?:string|null;
  /** Only when ESPN supplies a week number; soccer summaries usually do not. */
  matchweek?:number|null;
  /** Deduplicated TV/streaming network names. */
  broadcasts?:string[];
  /** ESPN reports temperature in Fahrenheit. */
  weather?:{temperatureF?:number|null;condition?:string|null}|null;
  /** Percentages normalised to sum to 100. source 'odds' = implied from bookmaker moneylines. */
  predictor?:{home:number;draw:number;away:number;source:'espn'|'odds';provider?:string|null}|null;
  /** Table rows for the two clubs in this match only. */
  standings?:Array<{teamId:string;rank:number;points:number;played?:number|null}>;
}
type SummaryState={id:string;data:MatchSummary|null;loading:boolean;error:string|null};
export function useMatchSummary(id:string, active:boolean, finished=false) {
  const [state,setState]=useState<SummaryState>({id,data:null,loading:true,error:null});
  const [retry,setRetry]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const currentId=useRef(id);const mounted=useRef(true);const refreshingRef=useRef(false);
  useEffect(()=>{currentId.current=id;},[id]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let disposed=false;let inFlight=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const visible=()=>document.visibilityState!=='hidden';
    const native=isTauri();
    setState(old=>({id,data:old.id===id?old.data:null,loading:native,error:!native?'Match details are available in the desktop app.':null}));
    const read=async()=>{
      if(disposed||inFlight||!visible())return;
      inFlight=true;
      let needsFinal=finished;
      try {
        const data=await invoke<MatchSummary>('get_match_details',{id});
        if(data.matchId!==id)throw new Error('Summary identity mismatch');
        needsFinal=finished&&(data.matchState!=='post'||data.stale||!!data.error);
        if(!disposed)setState({id,data,loading:false,error:data.error});
      } catch {
        if(!disposed)setState(old=>({...old,data:old.data?{...old.data,stale:true}:null,loading:false,error:'Match details unavailable. Saved information is retained when available.'}));
      } finally {
        inFlight=false;
        if(!disposed&&(active||needsFinal)&&visible())timer=setTimeout(()=>void read(),60000);
      }
    };
    const visibility=()=>{clearTimeout(timer);if(visible()&&native)void read();};
    if(native)void read();
    document.addEventListener('visibilitychange',visibility);
    return ()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
  },[id,active,finished,retry]);
  // Manual refresh bypasses the 15-minute provider cache (Rust enforces a 30s floor).
  // Results for a match the user has navigated away from are dropped.
  const refresh=()=>{
    if(!isTauri()||refreshingRef.current)return;
    const target=id;const alive=()=>mounted.current&&currentId.current===target;
    refreshingRef.current=true;setRefreshing(true);
    const request=(async()=>{
      try {
        const data=await invoke<MatchSummary>('get_match_details',{id:target,force:true});
        if(data.matchId!==target)throw new Error('Summary identity mismatch');
        if(alive())setState({id:target,data,loading:false,error:data.error});
      } catch {
        if(alive())setState(old=>({...old,data:old.data?{...old.data,stale:true}:null,loading:false,error:'Match details unavailable. Saved information is retained when available.'}));
      }
    })();
    void Promise.all([request,new Promise(resolve=>setTimeout(resolve,600))]).finally(()=>{refreshingRef.current=false;if(mounted.current)setRefreshing(false);});
  };
  const visible=state.id===id?state:{id,data:null,loading:true,error:null};
  return {...visible,retry:()=>setRetry(n=>n+1),refresh,refreshing};
}
