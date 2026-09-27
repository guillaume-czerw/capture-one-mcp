import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Regressions from the 27/09/2026 CUISTOTS session. Each function is transpiled
// from its source and run with a fake application: no Apple Events.
function load(file, name) {
  const src = ts.createSourceFile(file, readFileSync(new URL(`../src/co/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = src.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  return ts.transpileModule(fn.getText(src).replace(/^export /, ''), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
}

// ---- co_select_variants: variants hidden by a browser filter are reported.
test('select reports resolved variants that a browser filter kept out of the selection', async () => {
  const mk = (id, rating) => ({id: () => id, name: () => 'PHOTOS' + id, rating});
  const all = [mk('3', 1), mk('52', 0), mk('210', 0)];
  let selection = [];
  const doc = {
    filters: () => ['Note|★'],
    // Capture One selects only what the ★ filter shows.
    select: ({variants}) => { selection = selection.concat(variants.filter(v => v.rating >= 1)); },
    deselect: ({variants}) => { selection = selection.filter(v => !variants.includes(v)); },
  };
  const co = {selectedVariants: () => selection};
  const runJxa = async (body, options) => new Function('args', 'resolveTargets', 'co', body)(
    options.args, ({variantIds}) => ({doc, targets: all.filter(v => variantIds.includes(v.id())), notFound: []}), co);
  const setSelection = new Function('runJxa', load('edit.ts', 'setSelection') + '\nreturn setSelection;')(runJxa);
  const r = await setSelection(['3', '52', '210'], 'replace');
  assert.deepEqual(r.selected.map(v => v.id), ['3']);
  assert.deepEqual(r.notSelected.map(v => v.id), ['52', '210']);
  assert.match(r.notSelectedReason, /Note\|★/);
  const clean = await setSelection(['3'], 'replace');
  assert.equal(clean.notSelected, undefined, 'nothing to report when everything was selected');
});

// ---- co_set_output_location: validated before anything is sent, read back after.
test('set output location refuses missing folders and reports the read-back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'co-out-'));
  try {
    let output = '/????', calls = 0;
    const runJxa = async (body, options) => {
      calls++;
      const d = {output: () => output};
      Object.defineProperty(d, 'output', {get: () => () => output, set: v => { output = v; }});
      return new Function('args', 'requireDoc', 'Path', body)(options.args, () => d, x => x);
    };
    const setOutputLocation = new Function('runJxa', load('documents.ts', 'setOutputLocation') + '\nreturn setOutputLocation;')(runJxa);
    for (const bad of ['relative/out', join(dir, 'missing'), join(dir, '..', 'x')]) {
      await assert.rejects(setOutputLocation(bad));
    }
    assert.equal(calls, 0, 'nothing sent to Capture One for a bad folder');
    const r = await setOutputLocation(dir + '/');
    assert.equal(r.before, '/????');
    assert.equal(r.matched, true);
  } finally { await rm(dir, {recursive: true, force: true}); }
});

// ---- co_variant_output_files: stillExists comes from the disk, not the event.
test('output files report stillExists from the disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'co-files-'));
  try {
    const here = join(dir, 'PHOTOS0013.jpg');
    await writeFile(here, 'x');
    const gone = join(dir, 'gone', 'PHOTOS0013.jpg');
    const events = [here, gone].map(p => ({path: () => p, date: () => 'today', exists: () => true}));
    const variant = {outputEvents: () => events};
    const runJxa = async (body, options) => new Function('args', 'resolveTargets', 'describeVariant', body)(
      options.args, () => ({targets: [variant], notFound: []}), () => ({id: '9', name: 'PHOTOS0013', extension: 'ARW'}));
    const outputFiles = new Function('runJxa', load('process.ts', 'outputFiles') + '\nreturn outputFiles;')(runJxa);
    const r = await outputFiles({variantIds: ['9']});
    assert.deepEqual(r.variants[0].outputs.map(o => o.stillExists), [true, false]);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
