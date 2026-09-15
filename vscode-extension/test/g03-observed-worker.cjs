// Test-only wrapper around the exact installed worker. No invocation rewriting.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { workerData } = require('node:worker_threads');
const { observe } = require('./helpers/cli-event-observer.cjs');
const { g03ObservedWorker: target, g03CliEvents: evidence } = workerData.settings;
if (!path.isAbsolute(target) || !path.isAbsolute(evidence)) throw Error('Explicit diagnostic paths required');
const fd = fs.openSync(evidence, 'wx', 0o600);
const original = cp.spawn;
let invocation = 0;
cp.spawn = function(command, args, options) {
  let selectedArgs = args;
  let schema;
  if (command === '/usr/bin/sandbox-exec' && workerData.settings.g03OmitOutputSchema === true && args.includes('--output-schema')) {
    const index = args.indexOf('--output-schema');
    if (workerData.settings.g03SchemaInPrompt === true) schema = fs.readFileSync(args[index + 1], 'utf8');
    selectedArgs = [...args.slice(0, index), ...args.slice(index + 2)];
  }
  const child = original.call(this, command, selectedArgs, options);
  if (schema) {
    const originalEnd = child.stdin.end;
    child.stdin.end = function(prompt, ...rest) {
      return originalEnd.call(this, prompt + '\n\nReturn only JSON matching this required response schema:\n' + schema, ...rest);
    };
  }
  if (command === '/usr/bin/sandbox-exec' && args.includes('exec')) {
    const id = ++invocation;
    const kind = args.includes('model_provider="gcr_fixture"') ? 'loopback-probe' : 'account-review';
    observe(child, (event) => fs.writeSync(fd, JSON.stringify({ invocation: id, kind, ...event }) + '\n'));
  }
  return child;
};
require(target);
