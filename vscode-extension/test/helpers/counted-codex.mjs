const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
/** Test launcher: distinguish the executor's local provider probes from account review execs. */
export function countedCodexLauncher(executable, invocations) {
  return `#!/bin/sh
if [ "$1" = exec ]; then
  kind=review-exec
  for arg in "$@"; do
    case "$arg" in 'model_provider="gcr_fixture"') kind=probe-exec ;; esac
  done
  printf '%s\\n' "$kind" >> ${quote(invocations)}
fi
exec ${quote(executable)} "$@"
`;
}
