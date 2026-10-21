import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSuper, appearance, settingsPath, startSync } from '../src/sync.mjs';
import { activeWorkspace, verifyCaller } from '../src/sc.mjs';
import { buildPalette, contrast, backgroundTokens } from '../src/palette.mjs';
const tokens=JSON.parse(readFileSync(new URL('../src/tokens.json',import.meta.url)));
const theme={light:{chrome:{hue:251,saturation:0.98,brightness:1}},dark:{chrome:{hue:220,saturation:1,brightness:0.88}}};
test('scope and instance selection',()=>{
 assert.equal(isSuper({TERM_PROGRAM:'iTerm.app'}),false);
 assert.equal(isSuper({TERM_PROGRAM:'Superconductor'}),false);
 assert.equal(isSuper({TERM_PROGRAM:'Superconductor',SUPER_ENGINEERING_TERMINAL_ID:'id'}),true);
 assert.equal(settingsPath({SUPER_ENGINEERING_LOCAL_API_SOCKET:'/tmp/super-dev/local-api.sock'}),'/tmp/super-dev/settings.json');
 assert.equal(appearance('Light'),'light');assert.equal(appearance('system','dark'),'dark');assert.equal(appearance('invalid','dark'),undefined);
});
test('public CLI verified caller and exact active workspace', async()=>{
 const calls=[];
 const sc=async args=>{calls.push(args);if(args[0]==='layout')return {targets:[{ok:true,managed:true,provider_key:'pi'}]};if(args[1]==='list')return {active_workspace_id:'b',workspaces:[{id:'a'},{id:'b'}]};return {workspace:{id:'b',name:'B',theme}};};
 assert.equal(await verifyCaller(sc),true);assert.equal((await activeWorkspace(sc)).id,'b');
 assert.deepEqual(calls[2],['workspace','get','b','--json']);
 await assert.rejects(activeWorkspace(async()=>({})),/No active/);
 assert.equal(await verifyCaller(async()=>({targets:[{ok:true,managed:false,provider_key:'pi'}]})),false);
});
for(const mode of ['light','dark']) test(`${mode} complete semantic palette, readable across every panel`,()=>{
 const {colors,page}=buildPalette(mode,theme,tokens);
 assert.deepEqual(Object.keys(colors).sort(),tokens.toSorted());
 const backgrounds=[page,...backgroundTokens.map(t=>colors[t])];
 for(const key of tokens.filter(t=>!backgroundTokens.includes(t))) {
  assert.match(colors[key],/^#[a-f0-9]{6}$/);
  for(const bg of backgrounds)assert.ok(contrast(colors[key],bg)>=7,`${key} on ${bg}`);
 }
 assert.ok(contrast(colors.userMessageBg,colors.toolPendingBg)>=1.12, 'User prompts visibly separate from tools');
 assert.equal(colors.toolSuccessBg,colors.toolPendingBg,'Success does not paint tool output green');
 assert.equal(colors.toolErrorBg,colors.toolPendingBg,'Status does not replace workspace panel tint');
 assert.equal(colors.mdLink,colors.accent,'Links inherit workspace accent');
 assert.equal(colors.syntaxKeyword,colors.accent,'Keywords inherit workspace accent');
 assert.notEqual(buildPalette(mode,{[mode]:{chrome:{hue:60}}},tokens).colors.accent,colors.accent);
});
test('sync updates appearance, active workspace and same-mode palette; dedup and invalid save safety',async()=>{
 let mode='light',id='a',activeTheme=theme,invalid=false,watchCb,timerCb,stopped=0;const applied=[];
 const sync=startSync({path:'unused',read:async()=>invalid?'bad':JSON.stringify({theme_mode:mode}),workspace:async()=>({id,name:id,theme:activeTheme}),system:async()=>'dark',apply:async state=>{applied.push(state);},watch:cb=>{watchCb=cb;return ()=>stopped++;},every:cb=>{timerCb=cb;return ()=>stopped++;}});
 await sync.ready;await sync.refresh();assert.equal(applied.length,1);
 mode='dark';await sync.refresh();assert.equal(applied.at(-1).mode,'dark');
 id='b';await sync.refresh();assert.equal(applied.at(-1).workspaceId,'b');
 activeTheme={dark:{chrome:{hue:30}}};await sync.refresh();assert.equal(applied.length,4);
 invalid=true;await sync.refresh();assert.equal(applied.length,4);
 invalid=false;mode='system';await sync.refresh();assert.equal(applied.length,4);
 sync.stop();timerCb();watchCb();await sync.refresh();assert.equal(stopped,2);assert.equal(applied.length,4);
});
test('no late theme changes after shutdown',async()=>{
 let release;const wait=new Promise(r=>release=r);let changed=false;
 const sync=startSync({path:'unused',read:async()=>{await wait;return '{"theme_mode":"light"}';},workspace:async()=>({id:'a'}),apply:()=>{changed=true;},watch:()=>()=>{},every:()=>()=>{}});
 sync.stop();release();await sync.ready;assert.equal(changed,false);
});
