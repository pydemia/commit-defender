// Observe metadata at the native process boundary; never persist stdin or text.
const fs = require('node:fs');
const cp = require('node:child_process');
const { workerData } = require('node:worker_threads');
const { w02Worker: target, w02Events: evidence } = workerData.settings;
const fd = fs.openSync(evidence, 'wx');
const emit = (event) => fs.writeSync(fd, JSON.stringify({
  at: new Date().toISOString(), ...event }) + '\n');
const original = cp.spawn;
cp.spawn = function(command, args, options) {
  const child = original.call(this, command, args, options);
  if (!String(command).endsWith('windows-native.exe') || !child.stdin)
    return child;
  const end = child.stdin.end;
  let kind;
  child.stdin.end = function(input, ...rest) {
    try {
      const request = JSON.parse(String(input));
      if (request.operation === 'process' && request.args?.includes('exec')) {
        kind = request.args.some((arg) => String(arg).includes('gcr_fixture'))
          ? 'loopback-probe' : 'account-review';
        emit({ event: 'native-process-request', kind,
          timeoutMs: request.timeout, shell: false,
          modelSelected: request.args.includes('gpt-5.6-luna'),
          highSelected: request.args.some((arg) => String(arg).includes('reasoning_effort="high"')),
        });
      }
    } catch { /* Storage session and other operations are deliberately ignored. */ }
    return end.call(this, input, ...rest);
  };
  child.on('close', (code, signal) => {
    if (kind) emit({ event: 'native-process-closed', kind, code, signal });
  });
  return child;
};
require(target);
