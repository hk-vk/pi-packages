import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installThemes} from '../src/theme-files.mjs';
import {buildPalette,themeMatches} from '../src/palette.mjs';
const tokens=JSON.parse(await readFile(new URL('../src/tokens.json',import.meta.url),'utf8'));
test('installs both named themes and avoids rewriting unchanged content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'super-theme-'));
 try{
  const a=await installThemes(dir,{},tokens);const before=await stat(a.light.path);
  await installThemes(dir,{},tokens);assert.equal((await stat(a.light.path)).mtimeMs,before.mtimeMs);
  for(const mode of ['light','dark']) {const doc=JSON.parse(await readFile(a[mode].path,'utf8'));assert.equal(doc.name,`super-workspace-${mode}`);assert.equal(doc.appearance,mode);assert.deepEqual(Object.keys(doc.colors).sort(),tokens.toSorted());}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('theme proxy compares tokens rather than object identity',()=>{
 const underlying={name:'super-workspace-dark',appearance:'dark',getFgAnsi:key=>'fg-'+key,getBgAnsi:key=>'bg-'+key};
 const proxy=new Proxy({},{get:(_,prop)=>underlying[prop]});
 assert.notEqual(proxy,underlying);assert.equal(themeMatches(proxy,underlying,tokens),true);
 assert.equal(themeMatches({...underlying,name:'rose-pine'},underlying,tokens),false);
 assert.equal(themeMatches({...underlying,getFgAnsi:()=> 'wrong'},underlying,tokens),false);
});
test('chrome intensity/alpha and accent/highlight prominence affect semantic colors',()=>{
 const make=spec=>buildPalette('light',{light:spec},tokens);
 const base=make({chrome:{hue:240,intensity:0,alpha:1}});
 assert.notEqual(base.page,make({chrome:{hue:240,intensity:1,alpha:1}}).page);
 assert.equal(base.page,make({chrome:{hue:240,intensity:1,alpha:0}}).page);
 assert.notEqual(make({highlight:{hue:0,prominence:0}}).colors.selectedBg,make({highlight:{hue:120,prominence:1}}).colors.selectedBg);
 assert.notEqual(make({accent:{hue:300,prominence:0}}).colors.accent,make({accent:{hue:300,prominence:1}}).colors.accent);
});
