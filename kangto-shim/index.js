#!/usr/bin/env node
'use strict';

/**
 * kangto-shim: codeagent-wrapper drop-in replacement using cmux
 *
 * Usage (same interface as codeagent-wrapper):
 *   kangto-shim --backend <codex|gemini> [--gemini-model <model>] [--lite] [resume <SESSION_ID>] - "<cwd>" <<'EOF'
 *   ROLE_FILE: <path>
 *   <TASK>...</TASK>
 *   OUTPUT: ...
 *   EOF
 */

const fs = require('fs');
const path = require('path');
const {
  createPane,
  sendToSurface,
  readScreen,
  closeSurface,
  buildAgentCommand,
  waitForCompletion,
  extractDiff,
  isCmuxAvailable,
  DONE_MARKER
} = require('./cmux-adapter');

const SESSION_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.kangto', 'sessions'
);

// --- Argument parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    backend: null,
    geminiModel: null,
    lite: false,
    resume: null,
    sessionId: null,
    cwd: process.cwd()
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--backend' && args[i + 1]) {
      parsed.backend = args[++i];
    } else if (arg === '--gemini-model' && args[i + 1]) {
      parsed.geminiModel = args[++i];
    } else if (arg === '--lite') {
      parsed.lite = true;
    } else if (arg === 'resume' && args[i + 1]) {
      parsed.resume = true;
      parsed.sessionId = args[++i];
    } else if (arg === '-' && args[i + 1]) {
      parsed.cwd = args[++i].replace(/^"|"$/g, '');
    }
    i++;
  }

  if (!parsed.backend) {
    fatal('--backend <codex|gemini> is required');
  }

  return parsed;
}

// --- Session management ---

function ensureSessionDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function saveSession(sessionId, surfaceId) {
  ensureSessionDir();
  const file = path.join(SESSION_DIR, `${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify({ surfaceId, ts: Date.now() }));
}

function loadSession(sessionId) {
  const file = path.join(SESSION_DIR, `${sessionId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function generateSessionId(backend) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${backend}-${ts}-${rand}`;
}

// --- Stdin reading ---

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);

    if (process.stdin.isTTY) {
      resolve('');
    }
  });
}

// --- Prompt building ---

function buildPrompt(stdinContent, opts) {
  const lines = stdinContent.split('\n');
  let roleFile = null;
  let roleContent = '';
  const taskLines = [];

  for (const line of lines) {
    const roleMatch = line.match(/^ROLE_FILE:\s*(.+)/);
    if (roleMatch) {
      roleFile = roleMatch[1].trim();
      continue;
    }
    taskLines.push(line);
  }

  if (roleFile) {
    const expanded = roleFile.replace(/^~/, process.env.HOME || '');
    if (fs.existsSync(expanded)) {
      roleContent = fs.readFileSync(expanded, 'utf-8').trim();
    } else {
      log(`[kangto] Warning: ROLE_FILE not found: ${roleFile}`);
    }
  }

  const task = taskLines.join('\n').trim();
  const parts = [];
  if (roleContent) parts.push(roleContent);
  if (task) parts.push(task);

  parts.push(`\nWhen you are completely done, print the exact text: ${DONE_MARKER}`);

  return parts.join('\n\n');
}

// --- Main ---

async function main() {
  const opts = parseArgs(process.argv);

  if (!isCmuxAvailable()) {
    fatal(
      'cmux is not running or not installed.\n' +
      'Install: brew tap manaflow-ai/cmux && brew install --cask cmux\n' +
      'Then launch cmux and retry.'
    );
  }

  const stdinContent = await readStdin();
  if (!stdinContent.trim()) {
    fatal('No input received on stdin. Pipe a task prompt.');
  }

  const prompt = buildPrompt(stdinContent, opts);
  let surfaceId = null;
  let sessionId = opts.sessionId;
  let isResumed = false;

  // Resume existing session or create new pane
  if (opts.resume && sessionId) {
    const session = loadSession(sessionId);
    if (session && session.surfaceId) {
      try {
        readScreen(session.surfaceId);
        surfaceId = session.surfaceId;
        isResumed = true;
        log(`[kangto] Resuming session ${sessionId} on surface ${surfaceId}`);
      } catch {
        log(`[kangto] Surface ${session.surfaceId} gone, creating new pane`);
      }
    }
  }

  if (!surfaceId) {
    surfaceId = createPane('right');
    sessionId = sessionId || generateSessionId(opts.backend);
    log(`[kangto] Created pane ${surfaceId} for ${opts.backend} (session: ${sessionId})`);
  }

  saveSession(sessionId, surfaceId);

  // Build and send the agent command
  const agentCmd = buildAgentCommand(opts.backend, prompt, opts.cwd, {
    geminiModel: opts.geminiModel,
    lite: opts.lite
  });
  sendToSurface(surfaceId, agentCmd + '\n');

  log(`[kangto] Waiting for ${opts.backend} to finish...`);

  // Wait for completion
  const rawOutput = waitForCompletion(surfaceId);

  // Extract diff from output
  const diff = extractDiff(rawOutput);

  // Output to stdout (same interface as codeagent-wrapper)
  process.stdout.write(diff);

  // Print session ID to stderr for reuse
  process.stderr.write(`SESSION_ID=${sessionId}\n`);

  // Clean up pane
  closeSurface(surfaceId);

  process.exit(0);
}

function log(msg) {
  process.stderr.write(msg + '\n');
}

function fatal(msg) {
  process.stderr.write(`[kangto] Error: ${msg}\n`);
  process.exit(1);
}

main().catch((err) => {
  fatal(err.message);
});
