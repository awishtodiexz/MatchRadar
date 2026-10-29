import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
export interface MatchSummary {
  matchId:string; updatedAt:string; stale:boolean; error:string|null;
  events:Array<{id:string;minute:string;period:number;seconds:number;kind:string;text:string;teamId:string|null}>;
  statistics:Array<{teamId:string;name:string;label:string;value:string}>;
  players:Array<{teamId:string;name:string;position:string;starter:boolean}>;
}
export function useMatchSummary(id:string, active:boolean, demo:boolean) {
  const [state,setState]=useState<{id:string;data:MatchSummary|null;loading:boolean;error:string|null}>({id,data:null,loading:true,error:null});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;
    setState({id,data:null,loading:!demo,error:null});
    const read=async()=>{
      try {const data=await invoke<MatchSummary>('get_match_details',{id});if(!disposed)setState({id,data,loading:false,error:data.error});}
      catch {if(!disposed)setState(old=>({...old,loading:false,error:'Match details unavailable. Saved information is retained when available.'}));}
      finally {if(!disposed&&active)timer=setTimeout(()=>void read(),60000);}
    };
    if(!demo&&isTauri())void read();
    return ()=>{disposed=true;clearTimeout(timer);};
  },[id,active,demo,retry]);
  return {...(state.id===id?state:{id,data:null,loading:!demo,error:null}),retry:()=>setRetry(n=>n+1)};
}
