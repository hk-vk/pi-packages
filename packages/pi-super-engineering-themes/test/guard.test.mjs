import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startThemeGuard} from '../src/guard.mjs';
test('no redraw for a matching palette; cached restoration on reset and focus',()=>{
 let active=true,restores=0,tick,input,stops=0;
 const guard=startThemeGuard({matches:()=>active,restore:()=>{active=true;restores++;},schedule:cb=>{tick=cb;return ()=>stops++;},onInput:cb=>{input=cb;return ()=>stops++;}});
 tick();tick();assert.equal(restores,0);
 active=false;tick();assert.equal(restores,1);tick();assert.equal(restores,1);
 active=false;assert.equal(input('\x1b[I'),undefined);assert.equal(restores,2);
 active=false;assert.equal(input('ordinary typing'),undefined);assert.equal(restores,2);
 guard.stop();guard.stop();tick();input('\x1b[I');assert.equal(restores,2);assert.equal(stops,2);
});
