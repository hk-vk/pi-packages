import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startSync} from '../src/sync.mjs';
test('repairs saved theme reset after session_start during /reload',async()=>{
 let active='rose-pine',calls=0;
 const sync=startSync({path:'unused',read:async()=>'{"theme_mode":"light"}',workspace:async()=>({id:'a',theme:{}}),isApplied:()=>active==='super',apply:()=>{calls++;active='super';},watch:()=>()=>{},every:()=>()=>{}});
 await sync.ready;assert.equal(calls,1);
 // Pi calls applyFromSettings AFTER extensions receive session_start.
 active='rose-pine';await sync.refresh();assert.equal(active,'super');assert.equal(calls,2);
 await sync.refresh();assert.equal(calls,2);sync.stop();
});
