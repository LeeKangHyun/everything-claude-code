'use strict';

const assert = require('assert');
const path = require('path');

// --- cmux-adapter unit tests ---

const adapter = require('./cmux-adapter');

// extractDiff: fenced diff block
{
  const input = `Some preamble text
\`\`\`diff
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,4 @@
 const express = require('express');
+const cors = require('cors');
 const app = express();
\`\`\`
Some trailing text`;

  const result = adapter.extractDiff(input);
  assert(result.includes('+const cors'), 'Should extract fenced diff content');
  assert(!result.includes('preamble'), 'Should not include preamble');
  assert(!result.includes('trailing'), 'Should not include trailing text');
  console.log('PASS: extractDiff fenced block');
}

// extractDiff: raw diff lines
{
  const input = `diff --git a/index.js b/index.js
--- a/index.js
+++ b/index.js
@@ -1 +1,2 @@
 hello
+world`;

  const result = adapter.extractDiff(input);
  assert(result.includes('diff --git'), 'Should detect raw diff');
  assert(result.includes('+world'), 'Should include added line');
  console.log('PASS: extractDiff raw diff');
}

// extractDiff: no diff found, return raw
{
  const input = 'No diff here, just a review comment.';
  const result = adapter.extractDiff(input);
  assert.strictEqual(result, input, 'Should return raw when no diff found');
  console.log('PASS: extractDiff fallback');
}

// buildAgentCommand: codex
{
  const cmd = adapter.buildAgentCommand('codex', 'do something', '/tmp/project');
  assert(cmd.includes('codex'), 'Should include codex command');
  assert(cmd.includes('/tmp/project'), 'Should include cwd');
  assert(cmd.includes('do something'), 'Should include prompt');
  console.log('PASS: buildAgentCommand codex');
}

// buildAgentCommand: gemini
{
  const cmd = adapter.buildAgentCommand('gemini', 'build UI', '/tmp/app');
  assert(cmd.includes('gemini'), 'Should include gemini command');
  assert(cmd.includes('/tmp/app'), 'Should include cwd');
  console.log('PASS: buildAgentCommand gemini');
}

// buildAgentCommand: unsupported backend
{
  assert.throws(
    () => adapter.buildAgentCommand('gpt4', 'test', '/tmp'),
    /Unsupported backend/,
    'Should throw for unknown backend'
  );
  console.log('PASS: buildAgentCommand unsupported backend');
}

// DONE_MARKER exists
{
  assert(typeof adapter.DONE_MARKER === 'string', 'DONE_MARKER should be a string');
  assert(adapter.DONE_MARKER.length > 5, 'DONE_MARKER should be non-trivial');
  console.log('PASS: DONE_MARKER defined');
}

// --- index.js parseArgs (test via subprocess to avoid process.exit) ---

const { spawnSync } = require('child_process');

// Missing --backend should fail
{
  const result = spawnSync('node', [path.join(__dirname, 'index.js')], {
    input: 'test',
    encoding: 'utf-8',
    timeout: 5000
  });
  assert(result.status !== 0, 'Should fail without --backend');
  assert(result.stderr.includes('--backend'), 'Should mention --backend in error');
  console.log('PASS: index.js fails without --backend');
}

console.log('\nAll kangto-shim tests passed.');
