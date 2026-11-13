import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';
import type { Match } from '../../src/types';
import type { MatchSummary } from '../../src/useMatchSummary';
import everton from '../../tests/fixtures/summary-everton.json' with {type:'json'};

const base=mockSnapshot.matches[0];
const finished:Match={...base,status:'fulltime',detail:'Full-time',homeScore:1,awayScore:0};
const summary:MatchSummary={matchId:finished.id,updatedAt:'2026-11-08T17:00:00Z',stale:false,error:null,venue:null,
 events:[
  {id:'var',minute:"23'",period:1,seconds:1380,kind:'var---referee-decision-cancelled',text:'VAR Decision: Card upgraded Reviewed Player.',teamId:finished.away.id,participants:['Reviewed Player']},
  {id:'ht',minute:"45'+2'",period:1,seconds:2820,kind:'halftime',text:'Half-time.',teamId:null},
  {id:'goal',minute:"90'+1'",period:2,seconds:5405,kind:'goal',text:'Goal in 90+1.',teamId:finished.home.id,participants:['Late Scorer']},
  {id:'foul',minute:"90'+3'",period:2,seconds:5568,kind:'foul',text:'Foul in 90+3.',teamId:finished.away.id},
  {id:'sub',minute:"90'+4'",period:2,seconds:5632,kind:'substitution',text:'Substitution in 90+4.',teamId:finished.home.id,participants:['Sub On','Sub Off']},
  {id:'end',minute:"90'+6'",period:2,seconds:5400,kind:'end-regular-time',text:'Second half ends.',teamId:null},
 ],
 statistics:[
  ['totalShots','Shots','12','7'],['shotsOnTarget','On target','5','3'],['possessionPct','Possession','58.2','41.8'],
  ['yellowCards','Yellow cards','1','3'],['redCards','Red cards','0','1'],['offsides','Offsides','4','2'],
 ].flatMap(([name,label,home,away])=>[{teamId:finished.home.id,name,label,value:home},{teamId:finished.away.id,name,label,value:away}]),
 players:[]};

async function open(page: import('@playwright/test').Page, match:Match, data:MatchSummary, theme:'light'|'dark'='light') {
  await page.route('https://**/*',route=>route.abort());
  await installBridge(page,{snapshot:{...mockSnapshot,matches:[match],settings:{...mockSnapshot.settings,theme}},summary:data});
  await page.goto('/');
  await page.getByRole('button',{name:`Match details: ${match.home.name} versus ${match.away.name}`}).click();
}

test('commentary keeps stoppage time in order and key filters keep period markers',async({page},info)=>{
 await page.setViewportSize({width:320,height:700});
 await open(page,finished,summary);
 await page.getByRole('tab',{name:'Commentary',exact:true}).click();
 await expect(page.locator('.commentary .event time')).toHaveText(["90+6'","90+4'","90+3'","90+1'","45+2'","23'"]);
 await expect(page.getByText('Second half ends.',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Commentary event type'}).selectOption('key');
 await expect(page.getByText('Foul in 90+3.',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Half-time.',{exact:true})).toBeVisible();
 await expect(page.getByText('Second half ends.',{exact:true})).toBeVisible();
 await expect(page.getByText('VAR Decision: Card upgraded Reviewed Player.',{exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Commentary event type'}).selectOption('cards');
 await expect(page.getByText(/0 of 6 events/)).toBeVisible();
 await expect(page.getByText(/No events match this filter/)).toBeVisible();
 await page.screenshot({path:info.outputPath('commentary-empty-filter.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Clear filters'}).click();
 await expect(page.getByText(/6 events/)).toBeVisible();
 expect(await page.locator('.detail-body').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('commentary-order.png'),animations:'disabled'});
});

test('statistics name both teams and keep that header while scrolling',async({page},info)=>{
 await page.setViewportSize({width:320,height:460});
 await open(page,finished,summary);
 await page.getByRole('tab',{name:'Stats',exact:true}).click();
 await expect(page.getByText('All statistics · 6 metrics')).toBeVisible();
 await expect(page.locator('.stat-teams')).toContainText(finished.home.short);
 await expect(page.locator('.stat-teams')).toContainText(finished.away.short);
 await expect(page.getByRole('columnheader',{name:finished.home.name})).toBeVisible();
 await expect(page.getByRole('columnheader',{name:finished.away.name})).toBeVisible();
 await page.locator('.detail-body').evaluate(element=>{element.scrollTop=element.scrollHeight;});
 await expect(page.locator('.stat-teams')).toBeInViewport();
 const box=await page.locator('.stat-teams').boundingBox();
 expect(box?.y??999).toBeLessThan(170);
 expect(await page.locator('.detail-body').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('statistics-team-header.png'),animations:'disabled'});
});

test('lineup team tabs support Home and End and draw the formation pitch',async({page},info)=>{
 const sides=everton.header.competitions[0].competitors;
 const homeSide=sides.find(side=>side.homeAway==='home')!;
 const awaySide=sides.find(side=>side.homeAway==='away')!;
 const team=(side:typeof homeSide)=>({id:side.team.id,name:side.team.displayName,short:side.team.abbreviation});
 const match:Match={id:'401879242',home:team(homeSide),away:team(awaySide),homeScore:Number(homeSide.score),awayScore:Number(awaySide.score),status:'fulltime',detail:'Full-time',league:'premierLeague',competition:'Premier League',kickoff:'2026-11-08T15:00:00Z'};
 const data:MatchSummary={matchId:match.id,venue:null,updatedAt:'2026-11-08T17:00:00Z',stale:false,error:null,events:[],statistics:[],scorers:[],substitutions:[],
  formations:Object.fromEntries(everton.rosters.map(roster=>[roster.team.id,roster.formation])),
  players:everton.rosters.flatMap(roster=>roster.roster.map(player=>({teamId:roster.team.id,name:player.athlete.displayName,position:player.position?.abbreviation??'',jersey:player.jersey,starter:player.starter,formationPlace:Number(player.formationPlace)||undefined})))};
 await page.setViewportSize({width:320,height:700});
 await open(page,match,data,'dark');
 await page.getByRole('tab',{name:'Lineups',exact:true}).click();
 await expect(page.locator('.pitch-shirt')).toHaveCount(11);
 const homeTab=page.getByRole('tab',{name:new RegExp(homeSide.team.displayName)});
 const awayTab=page.getByRole('tab',{name:new RegExp(awaySide.team.displayName)});
 await homeTab.focus();await page.keyboard.press('End');
 await expect(awayTab).toBeFocused();await expect(awayTab).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('Home');
 await expect(homeTab).toBeFocused();await expect(homeTab).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.pitch-shirt')).toHaveCount(11);
 await page.screenshot({path:info.outputPath('lineups-keyboard.png'),animations:'disabled'});
});
