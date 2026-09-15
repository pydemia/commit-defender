// Manual verification only. Passively observe streams; never save raw CLI text.
const { StringDecoder } = require('node:string_decoder');
const eventTypes = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']);
const itemTypes = new Set(['agent_message', 'reasoning', 'mcp_tool_call', 'error', 'command_execution']);
function classify(value) {
  const text = typeof value === 'string' ? value : '';
  return [
    ['rate-limit', /rate.limit|too many requests|\b429\b/i],
    ['quota', /quota|usage limit/i],
    ['authentication', /unauthorized|authentication|\b401\b/i],
    ['permission', /forbidden|\b403\b/i],
    ['stream', /stream.*(?:disconnect|closed|error|timeout)|connection.*(?:reset|closed)/i],
    ['retry', /retry|reconnect/i],
    ['schema', /invalid.*schema|schema.*invalid/i],
    ['tool', /unknown tool|invalid tool|tool.*not found/i],
    ['instruction-read', /AGENTS|instruction.*read/i],
    ['configuration', /unrecognized.*(?:feature|config)|unknown.*(?:feature|config)/i],
    ['timeout', /timed? ?out|timeout/i],
  ].filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
}
function observe(child, emit) {
  let count = 0;
  const save = (value) => {
    if (++count <= 500) emit({ at: new Date().toISOString(), ...value });
  };
  function stream(input, channel) {
    const decoder = new StringDecoder('utf8');
    let pending = '', discard = false, bytes = 0;
    input.on('data', (chunk) => {
      bytes += chunk.length;
      const text = decoder.write(chunk);
      for (const part of text.split(/(?<=\n)/)) {
        if (!discard) pending += part;
        if (pending.length > 2 * 1024 * 1024) { pending = ''; discard = true; }
        if (!part.endsWith('\n')) continue;
        if (discard) save({ channel, event: 'oversized-line' });
        else if (channel === 'stderr') {
          const codes = classify(pending);
          if (codes.length) save({ channel, event: 'diagnostic', codes });
        } else {
          try {
            const value = JSON.parse(pending);
            const item = value.item ?? {};
            const codes = classify(value.message ?? value.error?.message ?? item.error?.message ?? item.message);
            save({ channel, event: eventTypes.has(value.type) ? value.type : 'unknown',
              ...(itemTypes.has(item.type) ? { item: item.type } : {}),
              ...(['in_progress', 'completed', 'failed'].includes(item.status) ? { status: item.status } : {}),
              ...(['list_files', 'read_file', 'search_code'].includes(item.tool) ? { tool: item.tool } : {}),
              ...(codes.length ? { codes } : {}) });
          } catch { save({ channel, event: 'non-json-line' }); }
        }
        pending = ''; discard = false;
      }
    });
    input.on('end', () => save({ channel, event: 'stream-end', bytes }));
  }
  stream(child.stdout, 'stdout');
  stream(child.stderr, 'stderr');
  child.on('exit', (code, signal) => save({ event: 'process-exit', code, signal }));
}
module.exports = { observe };
