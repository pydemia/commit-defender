/** Synthetic fixture preparation only; never starts an account model review. */
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import { captureLocalSource, discoverLocalIdentity, LocalRecordStore } from '@gcr/client-core';
import { prepareCodexAccountExecutor } from '@gcr/client-executors';

async function run() {
  const c = workerData;
  if (!path.basename(path.dirname(c.workspace)).startsWith('cd-w01-host-'))
    throw Error('Only an owned synthetic fixture is accepted');
  let phase = 'identity';
  try {
    const identity = discoverLocalIdentity(c.workspace, c.profileId);
    phase = 'source';
    const snapshot = captureLocalSource({ cwd: c.workspace, kind: 'index', paths: ['sum.ts'] });
    snapshot.close();
    phase = 'storage';
    const records = await LocalRecordStore.open({ scope: { kind: 'repository',
      profileId: identity.profileId, repositoryKey: identity.repositoryKey,
      worktreeKey: identity.worktreeKey } });
    records.close();
    phase = 'catalog';
    await prepareCodexAccountExecutor({ executablePath: c.executablePath,
      model: c.model, reasoningEffort: c.reasoningEffort });
    parentPort!.postMessage({ status: 'passed', accountCalls: 0 });
  } catch (error) {
    parentPort!.postMessage({ status: 'failed', phase,
      error: error instanceof Error ? error.stack : 'Unknown preparation error',
      accountCalls: 0 });
  }
}
void run();
