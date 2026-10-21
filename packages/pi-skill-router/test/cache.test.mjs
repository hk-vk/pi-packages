import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(new URL('../extensions/skill-router.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function harness(names = ['alpha']) {
  const hooks = {}, tools = {}, commands = {}, exports = {};
  let scans = 0, reads = 0, now = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const text = name => `---\nname: ${name}\ndescription: example skill\n---\nInstructions`;
  const asyncFs = {
    async readdir(path) { scans++; await gate; return path === '/fixture/.pi/agent/skills' ? names : []; },
    async stat(path) { return { isDirectory: () => !path.endsWith('SKILL.md'), isFile: () => path.endsWith('SKILL.md') }; },
    async readFile(path) { reads++; return text(path.split('/').at(-2)); },
  };
  class FakeDate extends Date { static now() { return now; } }
  const syncFs = new Proxy({}, { get: () => () => { throw new Error('unexpected synchronous filesystem access'); } });
  vm.runInNewContext(source, {
    exports, Date: FakeDate, process: { env: { HOME: '/fixture' } },
    require: name => name === 'node:fs/promises' ? asyncFs : name === 'node:fs' ? syncFs
      : name === 'typebox' ? { Type: new Proxy({}, { get: () => () => ({}) }) } : require(name),
  });
  exports.default({ on: (name, handler) => { hooks[name] = handler; }, registerTool: tool => { tools[tool.name] = tool; }, registerCommand: (name, command) => { commands[name] = command; } });
  return { hooks, tools, commands, release, advance: () => { now += 1_000_000; }, counts: () => ({ scans, reads }) };
}

test('registration and prompts do not scan or wait; concurrent searches share one background load', async () => {
  const h = harness();
  assert.equal(h.counts().scans, 0);
  assert.equal(h.hooks.session_start(), undefined);
  const prompt = await h.hooks.before_agent_start({ systemPrompt: 'hello' });
  assert.equal(prompt.systemPrompt, 'hello');
  const first = h.tools.skill_search.execute('1', { query: 'alpha' });
  const second = h.tools.skill_search.execute('2', { query: 'alpha' });
  assert.equal(h.counts().scans, 1);
  h.release();
  for (const result of await Promise.all([first, second])) assert.equal(result.details.count, 1);
  const loaded = h.counts();
  h.advance();
  await h.hooks.before_agent_start({ systemPrompt: 'again' });
  h.hooks.session_start();
  await h.tools.skill_search.execute('3', { query: 'alpha' });
  await h.commands['skill-router-status'].handler('', { ui: { notify() {} } });
  assert.deepEqual(h.counts(), loaded);
  const read = await h.tools.skill_read.execute('4', { name: 'alpha' });
  assert.equal(read.details.found, true);
  assert.equal(h.counts().scans, loaded.scans);
});

test('an empty catalog is cached without repeated scanning', async () => {
  const h = harness([]); h.hooks.session_start(); h.release();
  assert.equal((await h.tools.skill_search.execute('1', { query: 'anything' })).details.count, 0);
  const loaded = h.counts(); h.advance(); h.hooks.session_start();
  await h.tools.skill_search.execute('2', { query: 'anything' });
  assert.deepEqual(h.counts(), loaded);
});

test('a fresh reload runtime loads a fresh catalog', async () => {
  const old = harness(['alpha']); old.release();
  assert.equal((await old.tools.skill_search.execute('1', { query: 'alpha' })).details.count, 1);
  const fresh = harness(['beta']); fresh.hooks.session_start(); fresh.release();
  assert.equal((await fresh.tools.skill_search.execute('2', { query: 'beta' })).details.count, 1);
  assert.equal((await fresh.tools.skill_search.execute('3', { query: 'alpha' })).details.count, 0);
});
