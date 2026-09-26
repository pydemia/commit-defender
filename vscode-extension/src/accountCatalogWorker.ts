import { spawn } from 'node:child_process';
import os from 'node:os';

/** Read-only Codex RPC broker. No thread, turn, login or tool request is permitted.
 * The parent managed process owns this worker and all of its descendants. */
const child = spawn(process.argv[2], ['app-server', '--listen', 'stdio://',
  '-c', 'model_provider="openai"', '-c', 'analytics.enabled=false'], {
  cwd: os.tmpdir(), env: process.env, shell: false, windowsHide: true,
});
let buffer = '';
let count = 0;
let nextId = 4;
const models: unknown[] = [];
const cursors = new Set<string>();
let finished = false;
function finish(value: unknown): void {
  if (finished) return;
  finished = true;
  child.stdout.pause();
  child.kill();
  process.stdout.write(JSON.stringify(value) + '\n', () => process.exit(0));
}
function send(id: number, method: string, params: unknown) {
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
}
child.stdin.on('error', () => {});
child.stderr.resume();
child.on('error', () => finish({ error: 'cli-unavailable' }));
child.on('close', () => finish({ error: 'catalog-unavailable' }));
child.stdout.on('data', bytes => {
  count += bytes.length;
  if (count > 2_097_152) return finish({ error: 'invalid-catalog' });
  buffer += bytes;
  for (let index; (index = buffer.indexOf('\n')) >= 0;) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    try {
      const value = JSON.parse(line);
      if (value.error) return finish({ error: value.id === 2 ? 'auth-unavailable' : 'connection-failed' });
      if (value.id === 1) {
        child.stdin.write('{"method":"initialized"}\n');
        send(2, 'account/read', { refreshToken: true });
      } else if (value.id === 2) {
        if (value.result?.account?.type !== 'chatgpt') return finish({ error: 'auth-unavailable' });
        send(3, 'account/rateLimits/read', {});
      } else if (value.id === 3) {
        if (!value.result?.rateLimits && !value.result?.rateLimitsByLimitId)
          return finish({ error: 'connection-failed' });
        send(nextId, 'model/list', { limit: 100, includeHidden: false });
      } else if (value.id === nextId) {
        if (!Array.isArray(value.result?.data)) return finish({ error: 'invalid-catalog' });
        models.push(...value.result.data);
        const cursor = value.result.nextCursor;
        if (cursor) {
          if (typeof cursor !== 'string' || cursors.has(cursor) || models.length >= 500)
            return finish({ error: 'invalid-catalog' });
          cursors.add(cursor); nextId++;
          send(nextId, 'model/list', { limit: 100, includeHidden: false, cursor });
        } else return finish({ models });
      }
    } catch {
      return finish({ error: 'invalid-catalog' });
    }
  }
});
send(1, 'initialize', { clientInfo: { name: 'commit_defender_catalog', version: '1' } });
