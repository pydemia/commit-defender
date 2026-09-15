const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { observe } = require('./helpers/cli-event-observer.cjs');
test('observes event order and error categories without persisting content or changing streams', async () => {
  const secret = 'PRIVATE_TOKEN_SOURCE_AND_REASONING';
  const events = [];
  const lines = [
    { type: 'turn.started', thread_id: secret },
    { type: 'item.completed', item: { type: 'reasoning', text: secret } },
    { type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'read_file', arguments: secret, result: secret } },
    { type: 'error', message: '429 retry ' + secret },
    { type: secret },
    { type: 'turn.completed' },
  ].map(value => JSON.stringify(value) + '\n').join('');
  const child = spawn(process.execPath, ['-e', 'process.stdin.pipe(process.stdout);process.stderr.write("stream disconnected PRIVATE_TOKEN_SOURCE_AND_REASONING\\n")']);
  observe(child, event => events.push(event));
  let captured = '';
  child.stdout.on('data', chunk => captured += chunk);
  child.stdin.end(lines);
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(captured, lines);
  assert(!JSON.stringify(events).includes(secret));
  assert(events.some(event => event.event === 'turn.completed'));
  assert(events.some(event => event.codes?.includes('rate-limit')));
  assert(events.some(event => event.codes?.includes('stream')));
  assert(events.some(event => event.event === 'process-exit' && event.code === 0));
});
