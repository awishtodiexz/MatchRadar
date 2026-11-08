import { test, expect } from '@playwright/test';
import raw from '../../tests/fixtures/summary-everton.json' with {type:'json'};
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import type { Match } from '../../src/types';
import type { MatchSummary } from '../../src/useMatchSummary';

const sides=raw.header.competitions[0].competitors;
const home=sides.find(side=>side.homeAway==='home')!,away=sides.find(side=>side.homeAway==='away')!;
const team=(side:typeof home)=>({id:side.team.id,name:side.team.displayName,short:side.team.abbreviation});
const match:Match={id:'401879242',home:team(home),away:team(away),homeScore:Number(home.score),awayScore:Number(away.score),status:'fulltime',detail:'Full-time',league:'premierLeague',competition:'Premier League',kickoff:raw.header.competitions[0].date};
const summary:MatchSummary={matchId:match.id,venue:null,updatedAt:'2026-11-08T17:00:00Z',stale:false,error:null,
 events:raw.keyEvents.filter(e=>e.text).map(e=>({id:e.id,minute:e.clock.displayValue,period:e.period.number,seconds:e.clock.value,kind:e.type.type,text:e.text??'',teamId:e.team?.id??null,participants:(e.participants??[]).map(p=>p.athlete.displayName),shortText:e.shortText})),
 statistics:raw.boxscore.teams.flatMap(t=>t.statistics.map(s=>({teamId:t.team.id,name:s.name,label:s.label,value:s.displayValue}))),
 formations:Object.fromEntries(raw.rosters.map(t=>[t.team.id,t.formation])),
 players:raw.rosters.flatMap(t=>t.roster.map(p=>({teamId:t.team.id,name:p.athlete.displayName,position:p.position?.abbreviation??'',jersey:p.jersey,starter:p.starter,formationPlace:Number(p.formationPlace)||undefined,headshot:p.athlete.headshot?.href}))),
};
for(const width of [320,390,580]) test(`Everton overview and numbers ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:width===580?900:700});
 const imageRequests:string[]=[];
 page.on('request',request=>{if(/headshots|thesportsdb/i.test(request.url()))imageRequests.push(request.url());});
 await page.route('https://**/*',route=>route.abort());
 await installBridge(page,{snapshot:{...mockSnapshot,matches:[match]},summary});await page.goto('/');
 await page.getByRole('button',{name:'Match details: Everton versus Coventry City'}).click();
 await expect(page.locator('.overview-intro')).toHaveCount(0);
 await expect(page.locator('.match-events .event')).toHaveCount(16);
 await expect(page.locator('.match-events .summary-icon[aria-label="Substitution"]')).toHaveCount(10);
 await expect(page.getByText('Second half',{exact:true})).toBeVisible();
 await expect(page.locator('.incident-score').last()).toHaveText('3–1');
 expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('summary.png')});
 await page.getByRole('tab',{name:'Commentary',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Commentary',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.event-kind').filter({hasText:'Substitution'}).first()).toBeVisible();
 await page.getByRole('tab',{name:'Lineups',exact:true}).click();
 await expect(page.locator('.pitch-player img')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/photos|Use numbers/})).toHaveCount(0);
 await expect(page.locator('.pitch-shirt')).toHaveCount(11);
 await page.locator('.lineup-pitch').scrollIntoViewIfNeeded();
 expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('lineups.png')});
 await expect(page.locator('.lineup-list img')).toHaveCount(0);
 expect(imageRequests).toEqual([]);
});

for(const [width,theme] of [[320,'light'],[390,'dark']] as const) test(`Overview match states ${width} ${theme}`,async({page},info)=>{
 // Reproduce the score and scorers in the user's supplied screenshot.
 const live:Match={...match,id:'401879240',status:'live',detail:'8′',home:{id:'360',name:'Manchester United',short:'MUN'},away:{id:'362',name:'Aston Villa',short:'AVL'},homeScore:0,awayScore:2};
 const liveSummary:MatchSummary={...summary,matchId:live.id,venue:'Old Trafford',events:[],players:[],formations:{},
  scorers:[{teamId:'362',teamName:'Aston Villa',name:'Alysson',minute:"1'",penalty:false,ownGoal:false},{teamId:'362',teamName:'Aston Villa',name:'Nicolas Jackson',minute:"4'",penalty:false,ownGoal:false}],
  statistics:[['possessionPct','20.6','79.4'],['totalShots','0','3'],['shotsOnTarget','0','3']].flatMap(([name,home,away])=>[{teamId:'360',name,label:name,value:home},{teamId:'362',name,label:name,value:away}]),
 };
 await page.setViewportSize({width,height:760});await page.route('https://**/*',route=>route.abort());
 await installBridge(page,{snapshot:{...mockSnapshot,settings:{...mockSnapshot.settings,theme},matches:[live]},summary:liveSummary});await page.goto('/');
 await page.getByRole('button',{name:'Match details: Manchester United versus Aston Villa'}).click();
 await expect(page.locator('.overview-intro')).toHaveCount(0);
 await expect(page.getByText('Nicolas Jackson',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Match snapshot')).toHaveCount(0);
 expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('live-overview.png')});
 await page.getByRole('tab',{name:'Stats',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Stats',exact:true})).toHaveAttribute('aria-selected','true');
 await installBridge(page,{snapshot:{...mockSnapshot,settings:{...mockSnapshot.settings,theme},matches:[{...live,status:'scheduled',homeScore:null,awayScore:null}]},summary:{...liveSummary,scorers:[],statistics:[],form:{'360':[{opponent:'Aston Villa',opponentId:'362',result:'W',score:'2-0',atHome:true}]}}});await page.reload();
 await page.getByRole('button',{name:'Match details: Manchester United versus Aston Villa'}).click();
 await expect(page.getByRole('heading',{name:'Match information'})).toBeVisible();
 await expect(page.getByLabel('Win against Aston Villa, 2–0')).toBeVisible();
 await expect(page.getByRole('tab',{name:'Stats',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('prematch-overview.png')});
 await installBridge(page,{snapshot:{...mockSnapshot,settings:{...mockSnapshot.settings,theme},matches:[{...live,scoreStale:true}]},details:'error'});await page.reload();
 await page.getByRole('button',{name:'Match details: Manchester United versus Aston Villa'}).click();
 await expect(page.locator('.detail-status')).toContainText('Saved');
 await expect(page.getByRole('button',{name:'Retry details'})).toBeVisible();
 expect(await page.locator('.detail-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('unavailable-overview.png')});
});
