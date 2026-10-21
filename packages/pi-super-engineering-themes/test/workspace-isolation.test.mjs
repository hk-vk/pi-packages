import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionWorkspace,workspaceById} from '../src/sc.mjs';
import {startSync} from '../src/sync.mjs';
import {installThemes} from '../src/theme-files.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const tokens=JSON.parse(await readFile(new URL('../src/tokens.json',import.meta.url),'utf8'));
test('foreground switches cannot steal a terminal workspace; deepest matching root wins',async()=>{
 let selected='other';const calls=[];
 const sc=async args=>{calls.push(args);return args[1]==='list'?{active_workspace_id:selected,workspaces:[{id:'parent',sections:[{path:'/tmp/super-theme-fixture'}]},{id:'owner',sections:[{items:[{path:'/tmp/super-theme-fixture/repo'}]}]},{id:'other',sections:[{path:'/tmp/another-repo'}]}]}:{workspace:{id:args[2],name:args[2]}};};
 assert.equal((await sessionWorkspace(sc,'/tmp/super-theme-fixture/repo/src')).id,'owner');
 selected='parent';assert.equal((await sessionWorkspace(sc,'/tmp/super-theme-fixture/repo')).id,'owner');
 const count=calls.length;await workspaceById(sc,'owner');assert.deepEqual(calls.slice(count),[['workspace','get','owner','--json']]);
});
test('ambiguous or absent membership refuses to guess active workspace',async()=>{
 const sc=async()=>({active_workspace_id:'a',workspaces:[{id:'a',path:'/tmp/shared'},{id:'b',path:'/tmp/shared'}]});
 await assert.rejects(sessionWorkspace(sc,'/tmp/shared'),/uniquely/);
 await assert.rejects(sessionWorkspace(sc,'/tmp/unmatched'),/uniquely/);
});
test('concurrent workspace installs never overwrite each other',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'super-isolation-'));
 try{
  const [a,b]=await Promise.all([installThemes(dir,{light:{chrome:{hue:0}}},tokens,'a'),installThemes(dir,{light:{chrome:{hue:240}}},tokens,'b')]);
  assert.notEqual(a.light.path,b.light.path);
  assert.notEqual(a.dark.path,b.dark.path);
  assert.notEqual(JSON.parse(await readFile(a.light.path)).colors.accent,JSON.parse(await readFile(b.light.path)).colors.accent);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('sync failure preserves colors and exposes stale status; recovery clears error',async()=>{
 let fail=false,count=0;
 const sync=startSync({path:'unused',read:async()=>'{"theme_mode":"light"}',workspace:async()=>{if(fail)throw new Error('App unavailable');return {id:'owner',name:'Owner'};},apply:()=>{count++;},watch:()=>()=>{},every:()=>()=>{}});
 await sync.ready;fail=true;await sync.refresh();assert.equal(count,1);assert.equal(sync.status().workspaceId,'owner');assert.equal(sync.health().stale,true);assert.match(sync.health().error,/App unavailable/);
 fail=false;await sync.refresh();assert.equal(sync.health().stale,false);assert.equal(count,1);sync.stop();
});
