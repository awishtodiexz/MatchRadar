import type { Match } from './types';
import type { MatchSummary } from './useMatchSummary';
// Deliberately fictional players and incidents, never a historical claim or native feed.
export function demoMatchSummary(match:Match):MatchSummary|null {
  if(match.status!=='fulltime'||match.home.id!=='331'||match.away.id!=='368')return null;
  const home=match.home.id,away=match.away.id;
  const events=[
    {minute:"15'",seconds:900,period:1,kind:'goal',text:'Alex Hart scores for the home side.',teamId:home},
    {minute:"27'",seconds:1620,period:1,kind:'yellow-card',text:'Sam Vale receives a yellow card.',teamId:away},
    {minute:"45+2'",seconds:2820,period:1,kind:'halftime',text:'Half-time in this fictional demonstration.',teamId:null},
    {minute:"61'",seconds:3660,period:2,kind:'substitution',text:'Jamie Reed replaces Robin Ash.',teamId:home},
    {minute:"72'",seconds:4320,period:2,kind:'goal',text:'Casey Brook equalises for the away side.',teamId:away},
    {minute:"83'",seconds:4980,period:2,kind:'red-card',text:'Morgan Lane receives a red card.',teamId:home},
    {minute:"90+4'",seconds:5640,period:2,kind:'end-regular-time',text:'Full-time: 1–1. Synthetic demo result.',teamId:null}
  ].map((e,i)=>({...e,id:'demo-event-'+i}));
  const names=['Alex Hart','Robin Ash','Morgan Lane','Drew Finch','Lee Rowan','Avery Stone','Riley North','Taylor Lake','Jordan West','Quinn Dale','Blair Wood','Jamie Reed','Cameron Gray','Devon Field','Skyler Hill','Reese Snow'];
  const players=[home,away].flatMap((teamId,side)=>names.map((name,i)=>({teamId,name:side?(i===0?'Casey Brook':i===1?'Sam Vale':'Away '+name):name,position:i===15?'':i===0?'F':i===1?'G':i<11?'MF':'SUB',starter:i<11})));
  const statistics=[home,away].flatMap((teamId,i)=>[{teamId,name:'possession',label:'Possession',value:i?'46%':'54%'},{teamId,name:'shots',label:'Shots',value:i?'9':'12'},{teamId,name:'redCards',label:'Red cards',value:i?'0':'1'}]);
  statistics.push({teamId:home,name:'shotsOnTarget',label:'Shots on target',value:'5'}); // Away value intentionally unavailable.
  return {matchId:match.id,updatedAt:'2026-10-29T12:00:00Z',stale:false,error:null,events,statistics,players};
}
