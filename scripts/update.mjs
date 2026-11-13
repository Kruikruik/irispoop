#!/usr/bin/env node
/*
 * IRIS//VIZ updater — downloads the latest version from GitHub, installs it, builds it and restarts the site.
 *
 *   node scripts/update.mjs                      manual update of this folder (restart the site yourself)
 *   node update.mjs --dir C:\dev\irispoop --install
 *                                                first install / reinstall: also sets up auto-start and opens the browser
 *
 * Used by the UPDATE button of the site (see scripts/vite-update-plugin.ts), which passes
 * --port / --kill-pid / --mode so the updater can stop the running server, keep a small
 * "updating…" server on the same port, then start the new version.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Kruikruik/irispoop';
const BRANCH = 'main';
const isWin = process.platform === 'win32';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(opt('dir', path.resolve(here, '..')));
const PORT = Number(opt('port', '4173'));
const MODE = opt('mode', 'preview');
const KILL = Number(opt('kill-pid', '0'));
const INSTALL = flag('install');
const SKIP_NPM = flag('skip-npm') || process.env.IRIS_SKIP_NPM === '1';
const STATUS_DIR = path.join(DIR, '.update');
const STATUS = path.join(STATUS_DIR, 'status.json');
const VERSION = path.join(DIR, 'version.json');
const SKIP = new Set(['node_modules', 'dist', 'dist-next', '.git', '.update', 'version.json']);
const OBSOLETE = ['Mettre-a-jour-IRIS.bat', 'scripts/mettre-a-jour.ps1', 'scripts/demarrer-iris.vbs'];

const state = { state: 'running', step: 'start', log: [], started: Date.now(), target: null, error: null };
const readJSON = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
function save() {
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.writeFileSync(STATUS, JSON.stringify({ ...state, updated: Date.now() }));
  } catch {
    /* status is best-effort */
  }
}
function log(msg) {
  // eslint-disable-next-line no-control-regex
  const text = String(msg).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    state.log.push(line);
    console.log(line);
  }
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
  save();
}
function step(name, msg) {
  state.step = name;
  log(`[${name.toUpperCase()}] ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function latestCommit() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
    headers: { 'User-Agent': 'iris-viz-updater', Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status} (${r.statusText})`);
  const j = await r.json();
  return {
    sha: j.sha,
    short: j.sha.slice(0, 7),
    date: j.commit?.committer?.date ?? '',
    message: (j.commit?.message ?? '').split('\n')[0],
  };
}

function run(cmd, cmdArgs, cwd, shell = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, {
      cwd,
      shell,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' },
    });
    let buf = '';
    const onData = (d) => {
      buf += d;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? '';
      parts.forEach(log);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) => {
      if (buf) log(buf);
      if (code === 0) resolve();
      else reject(new Error(`« ${cmd} ${cmdArgs.join(' ')} » a échoué (code ${code})`));
    });
  });
}
const npm = (a) => run('npm', a, DIR, isWin);

/* ── small server that keeps the port busy and reports progress while the real site is down ── */
let hold = null;
async function holdPort() {
  const page = () =>
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>IRIS//VIZ — mise à jour</title>` +
    `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#E7ECEF;color:#22303A;font:13px ui-monospace,monospace;letter-spacing:.15em">` +
    `<div>IRIS//VIZ — MISE À JOUR EN COURS · ${state.step.toUpperCase()}</div>`;
  const srv = http.createServer((req, res) => {
    if ((req.url ?? '').startsWith('/__update/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ served: 'updater', mode: MODE, local: readJSON(VERSION), remote: state.target, available: false, progress: { ...state } }));
      return;
    }
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3', 'Cache-Control': 'no-store' });
    res.end(page());
  });
  for (let i = 0; i < 40; i++) {
    const ok = await new Promise((resolve) => {
      srv.once('error', () => resolve(false));
      srv.listen(PORT, () => resolve(true));
    });
    if (ok) {
      hold = srv;
      return;
    }
    await sleep(250);
  }
  log(`(port ${PORT} indisponible pour la page d'attente — on continue)`);
}

function startSite() {
  const cmd = process.env.IRIS_START_CMD || `npm run ${MODE}`;
  const child = spawn(cmd, { cwd: DIR, shell: true, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  log(`Site relancé (${cmd})`);
}

async function waitForSite(timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/__update/status', timeout: 1500 }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve(res.statusCode === 200 && body.includes('"served":"vite"')));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await sleep(700);
  }
  return false;
}

function setupAutostart() {
  if (!isWin || !process.env.APPDATA) return;
  const startup = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  fs.mkdirSync(startup, { recursive: true });
  for (const old of ['demarrer-iris.vbs']) fs.rmSync(path.join(startup, old), { force: true });
  const vbs =
    'Set sh = CreateObject("WScript.Shell")\r\n' +
    `sh.CurrentDirectory = "${DIR}"\r\n` +
    'sh.Run "cmd /c npm run preview", 0, False\r\n';
  fs.writeFileSync(path.join(startup, 'IRIS-VIZ.vbs'), vbs);
  log('Démarrage automatique avec Windows : activé');
}

async function main() {
  save();
  log(`IRIS//VIZ — mise à jour de ${DIR}`);
  if (KILL) {
    step('stop', 'arrêt du site en cours…');
    try {
      process.kill(KILL);
    } catch {
      /* already stopped */
    }
    await holdPort();
  }

  step('check', 'recherche de la dernière version sur GitHub…');
  const target = await latestCommit();
  state.target = target;
  log(`Dernière version : ${target.short} — ${target.message}`);

  step('download', 'téléchargement…');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-'));
  try {
    const r = await fetch(`https://codeload.github.com/${REPO}/tar.gz/${target.sha}`, { headers: { 'User-Agent': 'iris-viz-updater' } });
    if (!r.ok) throw new Error(`téléchargement impossible (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(path.join(tmp, 'src.tar.gz'), buf);
    log(`${Math.round(buf.length / 1024)} Ko reçus`);

    step('extract', 'extraction…');
    await run('tar', ['-xzf', 'src.tar.gz'], tmp);
    const top = fs.readdirSync(tmp, { withFileTypes: true }).find((d) => d.isDirectory());
    if (!top) throw new Error('archive vide');
    const src = path.join(tmp, top.name);

    step('copy', 'copie des fichiers…');
    fs.mkdirSync(DIR, { recursive: true });
    fs.cpSync(src, DIR, { recursive: true, force: true, filter: (s) => s === src || !SKIP.has(path.basename(s)) });
    for (const f of OBSOLETE) fs.rmSync(path.join(DIR, f), { force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (!SKIP_NPM) {
    step('install', 'installation des dépendances (npm install, 1 à 2 min)…');
    await npm(['install', '--no-audit', '--no-fund']);
    step('build', 'construction du site…');
    // build into dist-next, then swap: a failed build never breaks the running version
    fs.rmSync(path.join(DIR, 'dist-next'), { recursive: true, force: true });
    await npm(['run', 'build', '--', '--outDir', 'dist-next', '--emptyOutDir']);
    fs.rmSync(path.join(DIR, 'dist'), { recursive: true, force: true });
    fs.renameSync(path.join(DIR, 'dist-next'), path.join(DIR, 'dist'));
  }

  fs.writeFileSync(VERSION, JSON.stringify({ ...target, installedAt: new Date().toISOString() }, null, 2));
  if (INSTALL) setupAutostart();
  state.state = 'done';
  step('done', `version ${target.short} installée ✓`);
}

async function finish() {
  if (hold) {
    hold.closeAllConnections?.();
    await new Promise((r) => hold.close(() => r()));
    hold = null;
  }
  if (KILL || INSTALL) startSite();
  save();
  if (INSTALL) {
    const up = await waitForSite();
    const url = `http://localhost:${PORT}`;
    if (up && isWin) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    console.log(up ? `\nC'est prêt : ${url}` : `\nLe site met du temps à démarrer — ouvre ${url} dans un instant.`);
  } else if (!KILL) {
    console.log('\nRedémarre le site (npm run preview) pour utiliser la nouvelle version.');
  }
}

main()
  .catch((e) => {
    state.state = 'error';
    state.error = e instanceof Error ? e.message : String(e);
    state.step = 'error';
    log(`ERREUR : ${state.error}`);
    process.exitCode = 1;
  })
  .then(finish)
  .then(() => process.exit());
