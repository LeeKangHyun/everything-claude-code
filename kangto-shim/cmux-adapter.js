'use strict';

const { execSync, execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');

const CMUX_BIN = process.env.CMUX_BIN || 'cmux';
const POLL_INTERVAL_MS = Number(process.env.KANGTO_POLL_MS) || 2000;
const MAX_WAIT_MS = Number(process.env.KANGTO_MAX_WAIT_MS) || 600000;
const DONE_MARKER = '___KANGTO_DONE___';

function cmux(args, opts = {}) {
  const result = spawnSync(CMUX_BIN, args, {
    encoding: 'utf-8',
    timeout: opts.timeout || 10000,
    ...opts
  });
  if (result.error) {
    throw new Error(`cmux ${args[0]} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`cmux ${args[0]} exited ${result.status}: ${(result.stderr || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function createPane(direction = 'right') {
  const raw = cmux(['new-split', '--direction', direction, '--json']);
  try {
    const parsed = JSON.parse(raw);
    return parsed.surface_id || parsed.panel_id || parsed.id;
  } catch {
    const match = raw.match(/[0-9a-f-]{36}|[0-9]+/);
    if (match) return match[0];
    throw new Error(`Cannot parse surface id from cmux new-split output: ${raw}`);
  }
}

function sendToSurface(surfaceId, text) {
  cmux(['send', '--surface', surfaceId, text]);
}

function readScreen(surfaceId) {
  return cmux(['read-screen', '--surface', surfaceId], { timeout: 15000 });
}

function closeSurface(surfaceId) {
  try {
    cmux(['close-surface', '--surface', surfaceId]);
  } catch {
    // best-effort
  }
}

function buildAgentCommand(backend, prompt, cwd, opts = {}) {
  switch (backend) {
    case 'codex':
      return `cd "${cwd}" && codex -q --approval-mode full-auto <<'PROMPT'\n${prompt}\nPROMPT`;
    case 'gemini': {
      const modelFlag = opts.geminiModel ? ` --model ${opts.geminiModel}` : '';
      return `cd "${cwd}" && gemini${modelFlag} -q <<'PROMPT'\n${prompt}\nPROMPT`;
    }
    default:
      throw new Error(`Unsupported backend: ${backend}`);
  }
}

function waitForCompletion(surfaceId, timeoutMs = MAX_WAIT_MS) {
  const start = Date.now();
  let lastLen = 0;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    sleepSync(POLL_INTERVAL_MS);

    const screen = readScreen(surfaceId);

    if (screen.includes(DONE_MARKER)) {
      return screen;
    }

    if (screen.length === lastLen) {
      stableCount++;
      if (stableCount >= 15) {
        return screen;
      }
    } else {
      stableCount = 0;
      lastLen = screen.length;
    }
  }

  return readScreen(surfaceId);
}

function sleepSync(ms) {
  spawnSync('sleep', [String(ms / 1000)]);
}

function extractDiff(rawOutput) {
  const lines = rawOutput.split('\n');
  const diffLines = [];
  let inDiff = false;
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith('```diff') || line.startsWith('```patch')) {
      inFence = true;
      continue;
    }
    if (inFence && line.startsWith('```')) {
      inFence = false;
      continue;
    }
    if (inFence) {
      diffLines.push(line);
      continue;
    }

    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff --git')) {
      inDiff = true;
    }
    if (inDiff) {
      const isDiffLine = line === '' ||
        line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') ||
        line.startsWith('@') || line.startsWith('diff') ||
        line.startsWith('---') || line.startsWith('+++') ||
        line.startsWith('\\');
      if (isDiffLine) {
        diffLines.push(line);
      } else {
        inDiff = false;
      }
    }
  }

  return diffLines.length > 0 ? diffLines.join('\n') : rawOutput;
}

function isCmuxAvailable() {
  try {
    cmux(['ping'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  cmux,
  createPane,
  sendToSurface,
  readScreen,
  closeSurface,
  buildAgentCommand,
  waitForCompletion,
  extractDiff,
  isCmuxAvailable,
  DONE_MARKER
};
