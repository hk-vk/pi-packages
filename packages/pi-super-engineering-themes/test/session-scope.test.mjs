import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('extension only applies Theme instances, never persists named selections',async()=>{
 const source=await readFile(new URL('../extensions/super-theme.ts',import.meta.url),'utf8');
 const calls=[...source.matchAll(/ctx\.ui\.setTheme\(([^)]+)\)/g)].map(m=>m[1]);
 assert.deepEqual(calls,['nextTheme','appliedTheme']);
 assert.ok(!source.includes('settingsManager.setTheme'));
});
