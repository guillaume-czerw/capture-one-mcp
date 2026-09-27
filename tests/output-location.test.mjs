import assert from 'node:assert/strict';
import {readFileSync, constants} from 'node:fs';
import {lstat, mkdtemp, open, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import {jpegDimensions} from '../dist/co/preview.js';
import {CaptureOneError} from '../dist/jxa/bridge.js';
import {drainTracker} from '../dist/co/queue-drain.js';

// Capture One 16.8.6, 27/09/2026: with the session's Output location reading
// back as "/????", every scripted process threw "Dossier de traitement non
// valide. (-43)" whatever the recipe was rooted at. These tests pin the two
// consequences: the error names the cause, and a preview that was never queued
// leaves no "MCP Preview" recipe or temp folder behind.

// The helper lives in the bridge prelude, inside a template literal: extract
// it and cook the doubled backslashes the way the template literal does.
const bridge = readFileSync(new URL('../src/jxa/bridge.ts', import.meta.url), 'utf8');
const start = bridge.indexOf('function explainProcessFailure');
const end = bridge.indexOf('\n      }\n', start) + 8;
const helperSource = bridge.slice(start, end).replace(/\\\\/g, '\\');
const explainProcessFailure = new Function(helperSource + '\nreturn explainProcessFailure;')();

const minus43 = new Error('Error: Dossier de traitement non valide. (-43)');

test('an unreadable Output location is named and an empty queue is a refusal', () => {
  const msg = explainProcessFailure({jobs: () => [], output: () => '/????'}, minus43);
  assert.match(msg, /^CO_MCP_REFUSED: /);
  assert.match(msg, /Nothing was queued\./);
  assert.match(msg, /Output location is unreadable \('\/\?\?\?\?'\)/);
  assert.match(msg, /co_set_output_location/);
  assert.doesNotMatch(msg, /Error: Error:/);
});

test('a healthy Output location is not blamed', () => {
  const msg = explainProcessFailure({jobs: () => [], output: () => '/Users/me/Session/Output'}, minus43);
  assert.match(msg, /Nothing was queued/);
  assert.doesNotMatch(msg, /Output location/);
});

test('a non-empty or unreadable queue is never reported as nothing queued', () => {
  for (const jobs of [() => [1], () => { throw new Error('no'); }]) {
    const msg = explainProcessFailure({jobs, output: () => '/????'}, minus43);
    assert.doesNotMatch(msg, /CO_MCP_REFUSED|Nothing was queued/);
    assert.match(msg, /inspect it before retrying/);
  }
});

// processVariants: a throwing co.process must surface the explanation, once.
const procSrc = ts.createSourceFile('process.ts', readFileSync(new URL('../src/co/process.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const procFn = procSrc.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'processVariants');
const procCompiled = ts.transpileModule(procFn.getText(procSrc).replace(/^export /, ''), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

test('processVariants turns a -43 throw into the Output-location explanation', async () => {
  let submissions = 0, calls = 0;
  const recipe = {name: () => 'HD LIVRAISON', existingFiles: () => 'add suffix'};
  const doc = {id: () => 'doc', recipes: () => [recipe], currentRecipe: () => recipe, jobs: () => [], output: () => '/????'};
  const variant = {id: () => '1', outputEvents: () => []};
  const runJxa = async (body, options) => {
    calls++;
    return new Function('args', 'resolveTargets', 'describeVariant', 'explainProcessFailure', 'co', body)(
      options.args, () => ({doc, targets: [variant], notFound: []}), () => ({name: 'photo', extension: 'arw'}),
      explainProcessFailure, {process: () => { submissions++; throw minus43; }});
  };
  const processVariants = new Function('runJxa', 'drainTracker', procCompiled + '\nreturn processVariants;')(runJxa, drainTracker);
  await assert.rejects(processVariants({variantIds: ['1']}, 'HD LIVRAISON', 0), /Output location is unreadable/);
  assert.equal(submissions, 1);
  assert.equal(calls, 1, 'no queue polling after a refused submission');
});

// renderPreview: the private recipe and temp folder must not leak.
const prevSrc = ts.createSourceFile('preview.ts', readFileSync(new URL('../src/co/preview.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const prevFn = prevSrc.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'renderPreview');
const prevCompiled = ts.transpileModule(prevFn.getText(prevSrc).replace(/^export /, ''), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

function previewHarness({jobsAfterThrow = 0} = {}) {
  let recipe, folder, deletions = 0;
  const existing = {name: () => 'User recipe'};
  const doc = {id: () => 'doc', captures: () => { throw new Error('catalog'); }, currentRecipe: () => existing,
    recipes: () => recipe ? [recipe] : [], jobs: () => new Array(jobsAfterThrow), output: () => '/????'};
  const co = {
    make: ({withProperties}) => {
      const props = {...withProperties};
      recipe = new Proxy({}, {get: (_, key) => () => props[key], set: (_, key, val) => { props[key] = val; return true; }});
      return recipe;
    },
    process: () => { throw minus43; },
    delete: () => { deletions++; },
  };
  const runJxa = async (body, opts) => {
    folder = opts.args.folder;
    try {
      return new Function('args', 'requireDoc', 'resolveTargets', 'explainProcessFailure', 'co', 'Path', body)(
        opts.args, () => doc, () => ({doc, targets: [{}], notFound: []}), explainProcessFailure, co, x => x);
    } catch (e) {
      // Mirror the bridge: a CO_MCP_REFUSED line becomes the refusal text.
      const text = String(e.message);
      throw new CaptureOneError(text.replace(/^.*CO_MCP_REFUSED:?\s*/, ''), 'UNEXPECTED');
    }
  };
  const names = ['runJxa', 'constants', 'lstat', 'mkdtemp', 'open', 'realpath', 'rm', 'stat', 'tmpdir', 'basename', 'dirname', 'join', 'randomUUID', 'jpegDimensions', 'MAX_BYTES', 'CaptureOneError', 'drainTracker'];
  const run = new Function(...names, prevCompiled + '\nreturn renderPreview;')(runJxa, constants, lstat, mkdtemp, open, realpath, rm, stat, tmpdir, basename, dirname, join, randomUUID, jpegDimensions, 8 * 1024 * 1024, CaptureOneError, drainTracker);
  return {run: () => run({documentId: 'doc', variantId: '1'}), stats: () => ({deletions, folder})};
}

test('a preview refused before queuing removes its recipe and temp folder', async () => {
  const h = previewHarness();
  await assert.rejects(h.run(), (e) => {
    assert.match(e.message, /Output location is unreadable/);
    assert.match(e.message, /private recipe and the temp folder were removed/);
    return true;
  });
  assert.equal(h.stats().deletions, 1);
  assert.equal(await lstat(h.stats().folder).then(() => true, () => false), false);
});

test('a preview whose queue is not empty after the throw keeps both', async () => {
  const h = previewHarness({jobsAfterThrow: 1});
  await assert.rejects(h.run(), /retained/);
  assert.equal(h.stats().deletions, 0);
  assert.equal(await lstat(h.stats().folder).then(() => true, () => false), true);
  await rm(h.stats().folder, {recursive: true, force: true});
});
