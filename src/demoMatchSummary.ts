import type { Match } from './types';
import type { MatchSummary } from './useMatchSummary';
// Deliberately fictional players and incidents, never a historical claim or native feed.
export function demoMatchSummary(match:Match):MatchSummary|null {
  if(match.home.id!=='331'||match.away.id!=='368')return otherDemoSummary(match);
  if(match.status!=='fulltime')return null;
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
  const names=['Alex Hart','Robin Ash','Morgan Lane','Drew Finch','Lee Rowan','Avery Stone','Riley North','Taylor Lake','Jordan Alexander West-Northumberland','Quinn Dale','Blair Wood','Jamie Reed','Cameron Gray','Devon Field','Skyler Hill','Reese Snow'];
  const players=[home,away].flatMap((teamId,side)=>names.map((name,i)=>({teamId,name:side?(i===0?'Casey Brook':i===1?'Sam Vale':'Away '+name):name,position:i===15?'':i===0?'F':i===1?'G':i<11?'MF':'SUB',starter:i<11})));
  const statistics=[home,away].flatMap((teamId,i)=>[{teamId,name:'possession',label:'Possession',value:i?'46%':'54%'},{teamId,name:'shots',label:'Shots',value:i?'9':'12'},{teamId,name:'redCards',label:'Red cards',value:i?'0':'1'}]);
  statistics.push({teamId:home,name:'shotsOnTarget',label:'Shots on target',value:'5'}); // Away value intentionally unavailable.
  for(const teamId of [home,away]) for(const [name,label,value] of [['corners','Corners','4'],['fouls','Fouls','8'],['offsides','Offsides','1'],['yellow','Yellow cards',teamId===away?'1':'0']]) statistics.push({teamId,name,label,value});
  return {matchId:match.id,updatedAt:'2026-10-29T12:00:00Z',stale:false,error:null,events,statistics,players};
}

function otherDemoSummary(match:Match):MatchSummary|null {
  if(!['live','halftime','fulltime'].includes(match.status))return null;
  const names=['Alex Hart','Robin Ash','Morgan Lane','Drew Finch','Lee Rowan','Avery Stone','Riley North','Taylor Lake','Jordan Alexander West-Northumberland','Quinn Dale','Blair Wood','Jamie Reed','Cameron Gray','Devon Field','Skyler Hill','Reese Snow'];
  const players=[match.home.id,match.away.id].flatMap((teamId,side)=>names.map((name,i)=>({teamId,name:(side?'Away ':'Home ')+name,position:i===1?'G':i<11?'MF':'SUB',starter:i<11})));
  const simulation=match.home.id==='382'&&match.away.id==='360';
  const goals=[...Array.from({length:match.homeScore??0},(_,i)=>({side:'home' as const,i,minute:simulation?(i===0?35:78):12+i*15})),...Array.from({length:match.awayScore??0},(_,i)=>({side:'away' as const,i,minute:simulation?55+i*8:22+i*15}))];
  const events=goals.map(({side,i,minute})=>({id:`demo-goal-${side}-${i}`,minute:`${minute}'`,seconds:minute*60,period:minute>45?2:1,kind:simulation&&side==='away'?'own-goal':simulation&&i===1?'penalty-goal':'goal',text:simulation&&side==='away'?'Home Robin Ash scores an own goal for the away side.':`${side==='home'?'Home':'Away'} Alex Hart scores${simulation&&i===1?' a penalty':''}.`,teamId:side==='home'?match.home.id:match.away.id}));
  const minute=match.status==='fulltime'?94:match.status==='halftime'?47:Number.parseInt(match.detail,10)||0;
  if(minute>=18)events.push({id:'demo-yellow',minute:"18'",seconds:1080,period:1,kind:'yellow-card',text:'Away Robin Ash receives a yellow card.',teamId:match.away.id});
  if(match.status==='halftime'||minute>45)events.push({id:'demo-half',minute:"45+2'",seconds:2820,period:1,kind:'halftime',text:'Half-time in this fictional demonstration.',teamId:''});
  if(simulation&&minute>=56)events.push({id:'demo-var',minute:"56'",seconds:3360,period:2,kind:'var',text:'VAR confirms the away equaliser.',teamId:match.away.id});
  if(minute>=61)events.push({id:'demo-sub',minute:"61'",seconds:3660,period:2,kind:'substitution',text:'Home Jamie Reed replaces Home Robin Ash.',teamId:match.home.id});
  if(minute>=83)events.push({id:'demo-red',minute:"83'",seconds:4980,period:2,kind:'red-card',text:'Away Morgan Lane receives a red card.',teamId:match.away.id});
  if(match.status==='fulltime')events.push({id:'demo-end',minute:"90+4'",seconds:5640,period:2,kind:'end-regular-time',text:'Full-time in this fictional demonstration.',teamId:''});
  events.sort((a,b)=>a.period-b.period||a.seconds-b.seconds);
  const statistics=[match.home.id,match.away.id].flatMap((teamId,i)=>[{teamId,name:'possession',label:'Possession',value:i?'47%':'53%'},{teamId,name:'shots',label:'Shots',value:String((i?8:11)+(match.homeScore??0)+(match.awayScore??0))},{teamId,name:'shotsOnTarget',label:'Shots on target',value:String((i?3:4)+(match.homeScore??0)+(match.awayScore??0))},{teamId,name:'corners',label:'Corners',value:i?'3':'5'},{teamId,name:'fouls',label:'Fouls',value:i?'7':'9'},{teamId,name:'offsides',label:'Offsides',value:i?'0':'2'},{teamId,name:'yellow',label:'Yellow cards',value:i&&minute>=18?'1':'0'},{teamId,name:'red',label:'Red cards',value:i&&minute>=83?'1':'0'}]);
  return {matchId:match.id,updatedAt:match.kickoff,stale:false,error:null,events,statistics,players};
}
