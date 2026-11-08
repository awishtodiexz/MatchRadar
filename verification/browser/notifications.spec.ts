import { test, expect } from '@playwright/test';
import { installBridge } from './bridge';
import { mockSnapshot } from '../../src/test-fixtures/fixtures';

test('a pending notification opens its match on startup despite hidden league and club filters',async({page})=>{
 const match=mockSnapshot.matches[0];
 await page.route('https://**/*',route=>route.abort());
 await installBridge(page,{snapshot:{...mockSnapshot,settings:{...mockSnapshot.settings,competitionView:'championsLeague',followedOnly:true,favorites:[]}},notificationTarget:{requestId:1,matchId:match.id,match}});
 await page.goto('/');
 await expect(page.locator('.versus')).toContainText('Arsenal');
 await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'Back to matches'}).click();
 await expect(page.getByRole('button',{name:/Competition: Champions League/})).toBeVisible();
 await expect(page.getByRole('button',{name:'Following only',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('notification clicks switch matches and reset an already open match to its Overview',async({page})=>{
 await page.route('https://**/*',route=>route.abort());
 await installBridge(page);
 await page.goto('/');
 await page.getByRole('button',{name:'Match details: Arsenal versus Chelsea'}).click();
 await page.getByRole('tab',{name:'Stats',exact:true}).click();
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('test:notification-click',{detail:id})),mockSnapshot.matches[1].id);
 await expect(page.locator('.versus')).toContainText('Liverpool');
 await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab',{name:'Stats',exact:true}).click();
 await page.evaluate(id=>window.dispatchEvent(new CustomEvent('test:notification-click',{detail:id})),mockSnapshot.matches[1].id);
 await expect(page.getByRole('tab',{name:'Overview',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.detail-body')).toHaveJSProperty('scrollTop',0);
});
