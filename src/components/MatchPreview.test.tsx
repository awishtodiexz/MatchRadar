// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MatchPreview, leaderStat } from './MatchPreview';
import { mockSnapshot } from '../test-fixtures/fixtures';
import type { Match } from '../types';
import type { MatchSummary } from '../useMatchSummary';

afterEach(cleanup);
type Leader = NonNullable<MatchSummary['leaders']>[number];
const base=mockSnapshot.matches[0];
const match:Match={...base,home:{id:'h',name:'Liverpool',short:'LIV'},away:{id:'a',name:'Chelsea',short:'CHE'},status:'scheduled'};
const summary=(over:Partial<MatchSummary>={}):MatchSummary=>({matchId:base.id,updatedAt:'2026-11-08T17:00:00Z',stale:false,error:null,venue:null,events:[],statistics:[],players:[],...over});
const lead=(teamId:string,category:string,name:string,value:string,extra:Partial<Leader>={}):Leader=>({teamId,category,name,position:'FW',value,...extra});
const show=(data:MatchSummary|null,m:Match=match)=>render(<MatchPreview match={m} data={data}/>);

const fullLeaders:Leader[]=[
  lead('h','Goals','Erling Haaland','Matches: 10, Goals: 9',{athleteId:'10',jersey:'9'}),
  lead('h','Assists','Kevin De Bruyne','Matches: 9, Assists: 3',{athleteId:'20'}),
  lead('h','Shots','E. Haaland','38',{athleteId:'10'}),
  lead('h','Passes','K. De Bruyne','846',{athleteId:'20'}),
  lead('a','Goals','Cole Palmer','Matches: 8, Goals: 2',{athleteId:'30',jersey:'20'}),
  lead('a','Assists','Cole Palmer','Matches: 8, Assists: 4',{athleteId:'30'}),
  lead('a','Shots','Cole Palmer','41',{athleteId:'30'}),
  lead('a','Passes','Cole Palmer','912',{athleteId:'30'}),
];

it('reduces ESPN leader strings to the category figure with appearances as context',()=>{
  expect(leaderStat('Goals','Matches: 10, Goals: 9')).toEqual({main:'9',apps:'10'});
  expect(leaderStat('Shots','38')).toEqual({main:'38'});
});

it('renders nothing without summary data',()=>{
  const {container}=show(null);
  expect(container.innerHTML).toBe('');
});

it('shows appearances uniformly on every row when every leader resolves them, including via athleteId',()=>{
  const {container}=show(summary({leaders:fullLeaders}));
  const meta=[...container.querySelectorAll('.leader-player small')].map(node=>node.textContent);
  // Row order: Goals, Assists, Shots, Passes; each row home then away.
  expect(meta).toEqual(['#9 · 10 apps','#20 · 8 apps','9 apps','8 apps','10 apps','8 apps','9 apps','8 apps']);
});

it('omits appearances on every row when one shots leader cannot resolve them',()=>{
  const leaders=fullLeaders.map(leader=>leader.teamId==='a'&&leader.category==='Shots'?{...leader,athleteId:'31'}:leader);
  const {container}=show(summary({leaders}));
  expect(container.textContent).not.toMatch(/apps/);
  expect(container.querySelectorAll('.leader-player small')).toHaveLength(8);
  expect(container.querySelector('.leader-player.home small')?.textContent).toBe('#9');
});

it('keeps a height-preserving blank line where a player has no meta',()=>{
  const {container}=show(summary({leaders:[lead('h','Shots','A','38'),lead('a','Shots','B','41')]}));
  expect(container.querySelectorAll('.leader-player small[aria-hidden="true"]')).toHaveLength(2);
  expect(container.textContent).not.toMatch(/apps/);
});

it('does not highlight a tie',()=>{
  const {container}=show(summary({leaders:[lead('h','Goals','A','Matches: 10, Goals: 9'),lead('a','Goals','B','Matches: 8, Goals: 9')]}));
  expect(container.querySelectorAll('.is-leading')).toHaveLength(0);
  expect(container.querySelectorAll('.leader-bar')).toHaveLength(1);
  expect(container.querySelectorAll('.leader-bar i.lead')).toHaveLength(0);
});

it('highlights only the away side when it leads',()=>{
  const {container}=show(summary({leaders:[lead('h','Shots','A','38'),lead('a','Shots','B','41')]}));
  const leading=container.querySelectorAll('.is-leading');
  expect(leading).toHaveLength(1);
  expect(leading[0].className).toContain('away');
  expect(leading[0].textContent).toBe('41');
});

it('parses thousands separators so 1,024 beats 900',()=>{
  const {container}=show(summary({leaders:[lead('h','Passes','A','1,024'),lead('a','Passes','B','900')]}));
  const leading=container.querySelectorAll('.is-leading');
  expect(leading).toHaveLength(1);
  expect(leading[0].className).toContain('home');
  expect(leading[0].textContent).toBe('1,024');
  const [home,away]=container.querySelectorAll<HTMLElement>('.leader-bar i');
  expect(home.style.flexGrow).toBe('1024');
  expect(away.style.flexGrow).toBe('900');
  expect(home.classList.contains('lead')).toBe(true);
  expect(away.classList.contains('lead')).toBe(false);
});

it('stays neutral and draws no bar for non-numeric figures',()=>{
  const {container}=show(summary({leaders:[lead('h','Rating','A','n/a'),lead('a','Rating','B','7.2')]}));
  expect(container.querySelectorAll('.is-leading')).toHaveLength(0);
  expect(container.querySelectorAll('.leader-bar')).toHaveLength(0);
});

it('renders the tug-of-war bar with flex grow from the figures',()=>{
  const {container}=show(summary({leaders:[lead('h','Shots','A','38'),lead('a','Shots','B','41')]}));
  const [home,away]=container.querySelectorAll<HTMLElement>('.leader-bar i');
  expect(home.style.flexGrow).toBe('38');
  expect(away.style.flexGrow).toBe('41');
  expect(away.classList.contains('lead')).toBe(true);
});

it('shows form tooltips with opponent, score and date',()=>{
  const form={h:[{opponent:'Arsenal',opponentId:'ars',result:'W',score:'2-1',atHome:true,date:'2026-11-07T12:00:00Z'}]};
  const {container}=show(summary({form}));
  const tip=container.querySelector('.form-tip');
  expect(tip?.textContent).toMatch(/vs Arsenal · 2–1/);
  expect(tip?.textContent).toMatch(/Nov/);
  expect(screen.getByRole('img',{name:/Win against Arsenal, 2–1, Nov/})).toBeTruthy();
});

it('flips the form tooltip perspective for away games and omits an unparseable date',()=>{
  const form={h:[{opponent:'Arsenal',opponentId:'ars',result:'L',score:'2-1',atHome:false,date:'not a date'}]};
  const {container}=show(summary({form}));
  expect(container.querySelector('.form-tip')?.textContent).toBe('@ Arsenal · 1–2Away');
});

it('shows the matchup predictor with three segments from an ESPN projection',()=>{
  const {container}=show(summary({predictor:{home:66,draw:22,away:12,source:'espn'}}));
  const card=container.querySelector('[aria-label="Matchup predictor"]');
  expect(card).not.toBeNull();
  expect(card?.querySelectorAll('.predictor-bar i')).toHaveLength(3);
  expect(screen.getByRole('img',{name:'Liverpool 66%, draw 22%, Chelsea 12%'})).toBeTruthy();
  expect(card?.textContent).toContain('ESPN projection');
});

it('never shows bookmaker-implied odds as a prediction',()=>{
  const {container}=show(summary({predictor:{home:66,draw:22,away:12,source:'odds',provider:'DraftKings'}}));
  expect(container.querySelector('[aria-label="Matchup predictor"]')).toBeNull();
  expect(container.textContent).not.toContain('DraftKings');
});

it('keeps predictor percentages summing to 100',()=>{
  const {container}=show(summary({predictor:{home:33.4,draw:33.3,away:33.3,source:'espn'}}));
  const card=container.querySelector('[aria-label="Matchup predictor"]');
  const sum=[...(card?.querySelectorAll('.predictor-labels strong')??[])].reduce((total,node)=>total+parseInt(node.textContent??'0',10),0);
  expect(sum).toBe(100);
  expect(card?.textContent).toContain('ESPN projection');
});

it('hides the predictor when absent, not scheduled, or not finite',()=>{
  expect(show(summary()).container.querySelector('[aria-label="Matchup predictor"]')).toBeNull();
  expect(show(summary({predictor:{home:50,draw:25,away:25,source:'espn'}}),{...match,status:'fulltime'}).container.querySelector('[aria-label="Matchup predictor"]')).toBeNull();
  const {container}=show(summary({predictor:{home:NaN,draw:25,away:25,source:'espn'}}));
  expect(container.querySelector('[aria-label="Matchup predictor"]')).toBeNull();
  expect(container.textContent).not.toMatch(/NaN/);
});

it('never renders undefined or NaN in a full summary',()=>{
  const {container}=show(summary({
    leaders:fullLeaders,
    form:{h:[{opponent:'Arsenal',opponentId:'ars',result:'W',score:'2-1',atHome:true,date:null},{opponent:'Spurs',opponentId:'tot',result:'D',score:'1-1',atHome:false}]},
    predictor:{home:60,draw:25,away:15,source:'espn'},
  }));
  expect(container.textContent).not.toMatch(/undefined|NaN/);
});
