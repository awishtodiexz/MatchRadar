import { useEffect,useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { LeagueResults, Match } from './types';
export interface RecentResults {matches:Match[];updatedAt:string|null;error:string|null;leagues?:Record<string,LeagueResults>}
const empty:RecentResults={matches:[],updatedAt:null,error:null,leagues:{}};
export function useRecentResults(enabled:boolean){
 const [data,setData]=useState(empty);const [loading,setLoading]=useState(false);const [revision,setRevision]=useState(0);const [attempted,setAttempted]=useState(false);
 useEffect(()=>{let disposed=false;if(enabled){setLoading(true);void invoke<RecentResults>('get_recent_results').then(d=>{if(!disposed)setData(d);}).catch(()=>{if(!disposed)setData(old=>({...old,error:'Could not load recent results. Cached results remain available.'}));}).finally(()=>{if(!disposed){setLoading(false);setAttempted(true);}});}else setLoading(false);return()=>{disposed=true;};},[enabled,revision]);
 return {data:enabled?data:empty,loading:enabled&&(loading||!attempted),retry:()=>setRevision(n=>n+1)};
}
