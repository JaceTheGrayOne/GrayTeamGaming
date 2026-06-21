import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createEditorChange, createEditorChanges, saveEditorChange, saveEditorChanges } from './lib/editor-yaml-store.mjs';
import { loadEditorState, siteRoot } from './lib/editor-data.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const editorRoot = join(__dirname, '..', 'editor');
const defaultPort = 4317;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function localRequest(req) {
  const remote = req.socket.remoteAddress || '';
  const remoteOk = remote === '::1'
    || remote === '127.0.0.1'
    || remote === '::ffff:127.0.0.1'
    || remote.startsWith('127.');
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const hostOk = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  return remoteOk && hostOk;
}

function safeResolve(root, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const resolved = resolve(root, `.${decoded}`);
  const normalizedRoot = resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${sep}`)) return null;
  return resolved;
}

function serveFile(res, root, requestPath) {
  const filePath = safeResolve(root, requestPath);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }

  const type = mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const body = readFileSync(filePath);
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
  });
  res.end(body);
}

function readJsonBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(text));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function gitStatus() {
  try {
    const output = execFileSync('git', ['status', '--short'], {
      cwd: siteRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      available: true,
      clean: output.trim() === '',
      output,
      lines: output.split(/\r?\n/).filter(Boolean),
    };
  } catch (error) {
    return {
      available: false,
      clean: false,
      output: '',
      lines: [],
      error: error.message,
    };
  }
}

function editorState() {
  return {
    ...loadEditorState(),
    git: gitStatus(),
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: siteRoot,
      shell: false,
      windowsHide: true,
      ...options,
    });
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    const limit = 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill();
    }, options.timeoutMs || 120000);

    child.stdout?.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-limit);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-limit);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveRun({
        code,
        signal,
        ok: code === 0,
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
      });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolveRun({
        code: null,
        signal: null,
        ok: false,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}${error.message}`,
        elapsedMs: Date.now() - startedAt,
      });
    });
  });
}

function openTarget(target) {
  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  if (process.platform === 'darwin') {
    const child = spawn('open', [target], { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  const child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
  child.unref();
}

function pagePath(page) {
  const pages = {
    home: 'index.html',
    site: 'index.html',
    mods: 'mods.html',
    items: 'items.html',
    creatures: 'creatures.html',
  };
  const file = pages[page] || pages.home;
  return join(siteRoot, file);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/editor/state') {
    sendJson(res, 200, { ok: true, state: editorState() });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, errors: ['Method not allowed.'] });
    return;
  }

  const body = await readJsonBody(req);

  if (pathname === '/api/editor/diff') {
    const change = createEditorChange(body);
    if (!change.ok) {
      sendJson(res, 400, { ok: false, errors: change.errors, patch: change.patch });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      changed: change.changed,
      relativePath: change.relativePath,
      diff: change.diff,
      patch: change.patch,
    });
    return;
  }

  if (pathname === '/api/editor/diff-bulk') {
    const change = createEditorChanges(body);
    if (!change.ok) {
      sendJson(res, 400, { ok: false, errors: change.errors, results: change.results });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      changed: change.changed,
      changedFiles: change.changedFiles.map((file) => ({ relativePath: file.relativePath })),
      diff: change.diff,
      results: change.results,
    });
    return;
  }

  if (pathname === '/api/editor/save') {
    const result = saveEditorChange(body);
    if (!result.ok) {
      sendJson(res, 400, { ok: false, errors: result.errors, patch: result.patch });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      changed: result.changed,
      saved: result.saved,
      relativePath: result.relativePath,
      backupPath: result.backupPath,
      diff: result.diff,
      state: editorState(),
    });
    return;
  }

  if (pathname === '/api/editor/save-bulk') {
    const result = saveEditorChanges(body);
    if (!result.ok) {
      sendJson(res, 400, { ok: false, errors: result.errors, results: result.results });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      changed: result.changed,
      saved: result.saved,
      changedFiles: result.changedFiles,
      backupPaths: result.backupPaths,
      diff: result.diff,
      results: result.results,
      state: editorState(),
    });
    return;
  }

  if (pathname === '/api/editor/build') {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = await runCommand(npmCommand, ['run', 'build'], { timeoutMs: 180000 });
    sendJson(res, result.ok ? 200 : 500, { ok: result.ok, ...result });
    return;
  }

  if (pathname === '/api/editor/open-page') {
    const target = pagePath(body.page || body.section);
    openTarget(target);
    sendJson(res, 200, { ok: true, opened: target });
    return;
  }

  sendJson(res, 404, { ok: false, errors: ['Unknown API route.'] });
}

async function handleRequest(req, res) {
  try {
    if (!localRequest(req)) {
      sendJson(res, 403, { ok: false, errors: ['The local editor only accepts localhost requests.'] });
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/editor/')) {
      await handleApi(req, res, pathname);
      return;
    }

    if (pathname === '/' || pathname === '/editor' || pathname === '/editor/') {
      serveFile(res, editorRoot, '/index.html');
      return;
    }

    if (pathname.startsWith('/editor/')) {
      serveFile(res, editorRoot, pathname.replace(/^\/editor/, ''));
      return;
    }

    if (pathname.startsWith('/assets/')) {
      serveFile(res, siteRoot, pathname);
      return;
    }

    sendText(res, 404, 'Not found');
  } catch (error) {
    sendJson(res, 500, { ok: false, errors: [error.message] });
  }
}

function parsePortArg() {
  const arg = process.argv.find((value) => value.startsWith('--port='));
  if (!arg) return defaultPort;
  const value = Number(arg.split('=')[1]);
  return Number.isInteger(value) && value > 0 ? value : defaultPort;
}

function startServer(port, attempts = 20) {
  const server = createServer(handleRequest);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts > 1) {
      startServer(port + 1, attempts - 1);
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Local editor running at ${url}`);
    console.log('Press Ctrl+C to stop.');
    if (process.argv.includes('--open')) openTarget(url);
  });
}

startServer(parsePortArg());
