import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
export interface MatchScorer { teamId:string; teamName:string; name:string; minute:string; ownGoal:boolean; penalty:boolean }
export interface MatchSummary {
  matchId:string; updatedAt:string; stale:boolean; error:string|null;
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
  form?:Record<string,Array<{opponent:string;opponentId:string;result:string;score:string;atHome:boolean}>>;
  leaders?:Array<{teamId:string;category:string;name:string;jersey?:string|null;position:string;value:string}>;
}
type SummaryState={id:string;data:MatchSummary|null;loading:boolean;error:string|null};
export function useMatchSummary(id:string, active:boolean) {
  const [state,setState]=useState<SummaryState>({id,data:null,loading:true,error:null});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let disposed=false;let inFlight=false;let timer:ReturnType<typeof setTimeout>|undefined;
    const visible=()=>document.visibilityState!=='hidden';
    const native=isTauri();
    setState(old=>({id,data:old.id===id?old.data:null,loading:native,error:!native?'Match details are available in the desktop app.':null}));
    const read=async()=>{
      if(disposed||inFlight||!visible())return;
      inFlight=true;
      try {
        const data=await invoke<MatchSummary>('get_match_details',{id});
        if(data.matchId!==id)throw new Error('Summary identity mismatch');
        if(!disposed)setState({id,data,loading:false,error:data.error});
      } catch {
        if(!disposed)setState(old=>({...old,data:old.data?{...old.data,stale:true}:null,loading:false,error:'Match details unavailable. Saved information is retained when available.'}));
      } finally {
        inFlight=false;
        if(!disposed&&active&&visible())timer=setTimeout(()=>void read(),60000);
      }
    };
    const visibility=()=>{clearTimeout(timer);if(visible()&&native)void read();};
    if(native)void read();
    document.addEventListener('visibilitychange',visibility);
    return ()=>{disposed=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
  },[id,active,retry]);
  const visible=state.id===id?state:{id,data:null,loading:true,error:null};
  return {...visible,retry:()=>setRetry(n=>n+1)};
}
