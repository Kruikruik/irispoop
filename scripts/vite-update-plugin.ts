/*
 * Vite plugin: lets the site's UPDATE button check GitHub and run scripts/update.mjs.
 *   GET  /__update/status[?refresh=1]  → installed version, latest GitHub version, update progress
 *   POST /__update/run                 → starts the updater (it stops this server, updates, restarts it)
 * Works with both `npm run dev` and `npm run preview`.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

const REPO = 'Kruikruik/irispoop';
const BRANCH = 'main';

interface Version {
  sha: string;
  short: string;
  date: string;
  message: string;
}

export function updater(): Plugin {
  let root = process.cwd();
  let mode: 'dev' | 'preview' = 'preview';
  let cache: { at: number; data: Version | null; error: string | null } = { at: 0, data: null, error: null };

  const readJSON = <T,>(p: string): T | null => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
    } catch {
      return null;
    }
  };

  async function remote(force: boolean): Promise<void> {
    if (!force && Date.now() - cache.at < 10 * 60 * 1000) return;
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
        headers: { 'User-Agent': 'iris-viz', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      const j = (await r.json()) as { sha: string; commit?: { committer?: { date?: string }; message?: string } };
      cache = {
        at: Date.now(),
        error: null,
        data: { sha: j.sha, short: j.sha.slice(0, 7), date: j.commit?.committer?.date ?? '', message: (j.commit?.message ?? '').split('\n')[0] },
      };
    } catch (e) {
      cache = { at: Date.now() - 9 * 60 * 1000, data: cache.data, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url ?? '';
    if (!url.startsWith('/__update/')) return next();
    const send = (code: number, body: unknown) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };
    const statusFile = path.join(root, '.update', 'status.json');

    if (url.startsWith('/__update/status')) {
      await remote(url.includes('refresh=1'));
      const local = readJSON<Version>(path.join(root, 'version.json'));
      const progress = readJSON<{ state: string; updated: number }>(statusFile);
      if (progress && progress.state === 'running' && Date.now() - progress.updated > 15 * 60 * 1000) progress.state = 'error';
      send(200, {
        served: 'vite',
        mode,
        local,
        remote: cache.data,
        remoteError: cache.error,
        available: !!cache.data && (!local || cache.data.sha !== local.sha),
        progress,
      });
      return;
    }

    if (url.startsWith('/__update/run') && req.method === 'POST') {
      const progress = readJSON<{ state: string; updated: number }>(statusFile);
      if (progress?.state === 'running' && Date.now() - progress.updated < 5 * 60 * 1000) {
        send(409, { error: 'update already running' });
        return;
      }
      const port = req.socket.localPort ?? (mode === 'dev' ? 5173 : 4173);
      const script = path.join(root, 'scripts', 'update.mjs');
      fs.mkdirSync(path.dirname(statusFile), { recursive: true });
      fs.writeFileSync(
        statusFile,
        JSON.stringify({ state: 'running', step: 'start', log: ['Lancement de la mise à jour…'], started: Date.now(), updated: Date.now(), target: cache.data, error: null }),
      );
      const child = spawn(
        process.execPath,
        [script, '--dir', root, '--port', String(port), '--mode', mode, '--kill-pid', String(process.pid)],
        { cwd: root, detached: true, stdio: 'ignore', windowsHide: true },
      );
      child.unref();
      send(202, { ok: true });
      return;
    }
    next();
  };

  const use = (fn: typeof handler) => (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    fn(req, res, next).catch((e: unknown) => {
      res.statusCode = 500;
      res.end(String(e));
    });
  };

  return {
    name: 'iris-updater',
    configResolved(c) {
      root = c.root;
    },
    // marks pages served with this plugin, so the UPDATE button only shows (and only calls the API) where it works
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'iris-updater', content: '1' }, injectTo: 'head' }];
    },
    configureServer(server) {
      mode = 'dev';
      server.middlewares.use(use(handler));
    },
    configurePreviewServer(server) {
      mode = 'preview';
      server.middlewares.use(use(handler));
    },
  };
}
