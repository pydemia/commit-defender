import * as vscode from 'vscode';
import path from 'node:path';
import { getConfig, getStandaloneReviewSettings, holdModelConfiguration, resolveCodexPath, resolveExternalCliPath } from './config.js';
import { loadAccountModels, AccountCatalogError, type AccountModel, type SetupAccountProvider } from './accountModelCatalog.js';
import { apiReasoningEfforts } from './apiModelCapabilities.js';
import { API_DEFAULT_ENDPOINTS } from './ai/apiEndpoints.js';
import { manageModelCredential } from './modelCredentialView.js';
import { modelCredentialBinding, modelCredentialReference, modelCredentialRevision, resolveModelCredential,
  saveModelCredential, ModelCredentialError, type ApiProvider, type ModelCredentialReference } from './modelCredentials.js';
import { captureModelSettings, commitModelSettings, modelSettingsUnchanged, type ModelSettingsPort } from './modelSetupSettings.js';

const names = { codex: 'Codex', claudecode: 'Claude Code', antigravity: 'Antigravity' };
let running = false;
const port: ModelSettingsPort = {
  read: key => vscode.workspace.getConfiguration('commitDefender').inspect(key)?.globalValue,
  write: async (key, value) => { await vscode.workspace.getConfiguration('commitDefender').update(key, value, vscode.ConfigurationTarget.Global); },
};
async function apply(snapshot: Record<string, unknown>, values: Record<string, unknown>) {
  const release = holdModelConfiguration(snapshot);
  try { await commitModelSettings(port, snapshot, values); } finally { release(); }
}
async function effort(model: AccountModel, provider: string, current: string): Promise<string | undefined> {
  if (!model.efforts.length) return '';
  const defaults = provider === 'codex' || Object.keys(model.variants ?? {}).length ? [] : [{ label: 'Provider default', effort: '', description: 'Do not send an effort override' }];
  const picked = await vscode.window.showQuickPick([...defaults, ...model.efforts.map(value => ({ label: value, effort: value,
    description: value === current ? 'Current selection' : value === model.defaultEffort ? 'Model default' : undefined }))], {
    title: `Commit Defender: Use Account · ${names[provider as SetupAccountProvider] ?? provider} · Effort (3/3)`,
    placeHolder: `Choose reasoning effort for ${model.label}`, ignoreFocusOut: true,
  });
  return picked?.effort;
}
async function accountFlow(extensionPath: string, signIn: (provider: SetupAccountProvider) => Promise<unknown>,
  selected?: SetupAccountProvider): Promise<void> {
  const snapshot = captureModelSettings(port);
  const cfg = getConfig();
  const provider = selected ?? (await vscode.window.showQuickPick([
    { label: 'Codex', provider: 'codex' as const, description: 'Use the existing Codex account', detail: 'Checks CLI auth, server connection and account model catalog. No API key required.' },
    { label: 'Claude Code', provider: 'claudecode' as const, description: 'Use the existing Claude subscription', detail: 'Checks Claude Code auth and its supported models. Credentials stay in the CLI / OS store.' },
    { label: 'Antigravity', provider: 'antigravity' as const, description: 'Use the existing Google account', detail: 'Uses the standalone agy CLI and its account model list. Gemini API keys belong in Use API Credential.' },
  ], { title: 'Commit Defender: Use Account (1/3)', placeHolder: 'Use a saved CLI login, independently of GCR', ignoreFocusOut: true }))?.provider;
  if (!provider) return;
  // Authentication must not execute a repository-controlled path override.
  const executable = getStandaloneReviewSettings(1).provider === provider
    ? getStandaloneReviewSettings(1).executablePath
    : provider === 'codex' ? resolveCodexPath(String(snapshot.codexPath ?? 'codex'))
      : resolveExternalCliPath(String(provider === 'claudecode' ? snapshot.claudeCodePath ?? 'claude' : snapshot.antigravityPath ?? 'agy'), provider === 'claudecode' ? 'claude' : 'agy');
  let models: AccountModel[];
  for (;;) {
    try {
      models = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
        title: `Commit Defender: Verifying ${names[provider]} account and fetching models…`, cancellable: true }, async (_, token) => {
        const controller = new AbortController();
        const listener = token.onCancellationRequested(() => controller.abort());
        if (token.isCancellationRequested) controller.abort();
        try { return await loadAccountModels(provider, executable, { workerPath: path.join(extensionPath, 'out', 'account-catalog-worker.js'), signal: controller.signal }); }
        finally { listener.dispose(); }
      });
      break;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      const code = error instanceof AccountCatalogError ? error.code : (error as { code?: string }).code;
      const reason = code === 'cli-unavailable' || code === 'executable-unavailable' ? 'The CLI executable is unavailable. Check its path in User Settings.'
        : code === 'auth-unavailable' ? 'A usable account login was not found. Sign in with the CLI, then retry. API-key logins are configured with Use API Credential.'
        : code === 'timeout' ? 'The authentication/model query timed out.'
        : 'The account connection or model catalog could not be verified. Check network access and the CLI version. No guessed models were substituted.';
      const action = await vscode.window.showErrorMessage(`Commit Defender: ${names[provider]} — ${reason} Your model selection was preserved.`, 'Retry', 'Sign In…', 'Open Settings');
      if (action === 'Retry') continue;
      if (action === 'Sign In…') await signIn(provider);
      if (action === 'Open Settings') await vscode.commands.executeCommand('commitDefender.openSettings');
      return;
    }
  }
  for (;;) {
    const picked = await vscode.window.showQuickPick([
      ...models.map(model => ({ label: model.label, description: model.id === cfg.model || Object.values(model.variants ?? {}).includes(cfg.model) ? 'Current selection' : model.id,
        detail: model.description, model })),
      { label: 'Refresh model list…', description: 'Recheck this account', model: undefined },
    ], { title: `Commit Defender: Use Account · ${names[provider]} · Model (2/3)`,
      placeHolder: 'Select a model returned by the authenticated CLI', ignoreFocusOut: true, matchOnDetail: true });
    if (!picked) return;
    if (!picked.model) { await accountFlow(extensionPath, signIn, provider); return; }
    const chosenEffort = await effort(picked.model, provider, String(snapshot.reviewReasoningEffort ?? ''));
    if (chosenEffort === undefined) return;
    const modelId = picked.model.variants?.[chosenEffort] ?? picked.model.id;
    // AGY's catalog variants encode effort in the exact model ID. No unsupported
    // --effort value or invented variant is sent to the review executor.
    await apply(snapshot, { model: modelId, reviewReasoningEffort: picked.model.variants ? '' : chosenEffort, aiProvider: provider });
    void vscode.window.showInformationMessage(`Commit Defender: ${names[provider]} · ${modelId} · ${chosenEffort || 'provider default'} selected. Account connection verified; no review model request was made.`);
    return;
  }
}
function endpointError(provider: ApiProvider, endpoint: string): string | undefined {
  try { modelCredentialBinding({ aiProvider: provider, endpoint: endpoint.trim(), model: 'validation', apiVersion: '' }); }
  catch { return 'Enter an HTTPS base endpoint without credentials, query or fragment. HTTP is supported only on localhost.'; }
}
async function apiFlow(repoRoot?: string): Promise<void> {
  const snapshot = captureModelSettings(port);
  const cfg = getConfig();
  const picked = await vscode.window.showQuickPick([
    { label: 'OpenAI / compatible API', provider: 'openai' as const, detail: 'API key, base endpoint and model name. Billed by the API provider, separately from a CLI account.' },
    { label: 'Azure OpenAI', provider: 'aoai' as const, detail: 'Azure endpoint, deployment name and API version. Deployment names do not identify the underlying model.' },
    { label: 'Anthropic API', provider: 'anthropic' as const, detail: 'Anthropic Messages API key and model name. This adapter does not send reasoning effort.' },
    { label: 'Gemini API', provider: 'gemini' as const, detail: 'Gemini generateContent API key and model name. This adapter does not send reasoning effort.' },
    { label: 'Existing keys and plaintext migration…', provider: undefined, detail: 'Manage the currently configured API destination; migrate User Settings, Workspace Settings or hook keys.' },
  ], { title: 'Commit Defender: Use API Credential · Provider', placeHolder: 'Configure an API destination, independently of GCR and CLI login', ignoreFocusOut: true });
  if (!picked) return;
  if (!picked.provider) { await manageModelCredential(repoRoot); return; }
  const provider = picked.provider;
  const endpoint = await vscode.window.showInputBox({ title: 'Commit Defender: Use API Credential · Endpoint',
    prompt: provider === 'aoai' ? 'Azure resource base URL (not a chat/completions URL)' : 'API base URL (for OpenAI-compatible servers, include /v1)',
    value: cfg.aiProvider === provider && cfg.endpoint ? cfg.endpoint : provider === 'aoai' ? '' : API_DEFAULT_ENDPOINTS[provider],
    ignoreFocusOut: true, validateInput: value => endpointError(provider, value) });
  if (endpoint === undefined) return;
  const model = await vscode.window.showInputBox({ title: `Commit Defender: Use API Credential · ${provider === 'aoai' ? 'Deployment name' : 'Model name'}`,
    prompt: provider === 'aoai' ? 'Enter the deployment name from your Azure resource' : 'Enter the model name accepted by this endpoint',
    value: cfg.aiProvider === provider ? cfg.model : '', ignoreFocusOut: true,
    validateInput: value => value.trim() && value.trim().length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? undefined : 'Enter a model/deployment name (maximum 512 characters).' });
  if (model === undefined) return;
  let apiVersion = '';
  let capabilityModel = model.trim();
  if (provider === 'aoai') {
    const version = await vscode.window.showInputBox({ title: 'Commit Defender: Use API Credential · Azure API version',
      value: cfg.apiVersion, prompt: 'Use an API version supported by your Azure resource', ignoreFocusOut: true,
      validateInput: value => /^\d{4}-\d{2}-\d{2}(-preview)?$/.test(value.trim()) ? undefined : 'Use YYYY-MM-DD or YYYY-MM-DD-preview.' });
    if (version === undefined) return;
    apiVersion = version.trim();
    const underlying = await vscode.window.showInputBox({ title: 'Commit Defender: Use API Credential · Underlying model (optional)',
      prompt: 'Enter the Azure deployment’s actual model name to select documented effort levels. Leave empty to use the server default; the deployment name is not used to guess support.', ignoreFocusOut: true });
    if (underlying === undefined) return;
    capabilityModel = underlying.trim();
  }
  const official = provider === 'aoai' || endpoint.trim().replace(/\/+$/, '') === API_DEFAULT_ENDPOINTS.openai;
  const efforts = official ? apiReasoningEfforts(provider, capabilityModel) : [];
  let chosenEffort = '';
  if (efforts.length) {
    const selected = await vscode.window.showQuickPick([{ label: 'Server default', value: '', detail: 'Do not send a reasoning_effort parameter' },
      ...efforts.map(value => ({ label: value, value, detail: 'Documented for this model; endpoint acceptance is checked when a review runs' }))], {
      title: 'Commit Defender: Use API Credential · Reasoning effort', placeHolder: `Choose effort for ${capabilityModel}`, ignoreFocusOut: true });
    if (!selected) return;
    chosenEffort = selected.value;
  }
  const binding = modelCredentialBinding({ aiProvider: provider, endpoint: endpoint.trim(), model: model.trim(), apiVersion });
  const keyAction = await vscode.window.showQuickPick([
    { label: 'Enter API key…', value: 'enter', detail: 'Password input. The key is stored in encrypted OS-backed storage, never settings.' },
    { label: 'Use a key already stored for this destination', value: 'reuse', detail: 'Matches the current local profile, endpoint, model and API version.' },
  ], { title: 'Commit Defender: Use API Credential · Key', placeHolder: efforts.length ? 'Choose a credential for this API destination'
    : 'Effort support is unknown or unavailable in this adapter; the server default will be used', ignoreFocusOut: true });
  if (!keyAction) return;
  const profileId = String(snapshot.localProfile ?? 'default');
  let reference: ModelCredentialReference;
  if (keyAction.value === 'reuse') {
    reference = modelCredentialReference(profileId, binding);
    await resolveModelCredential(reference, binding);
  } else {
    const secret = await vscode.window.showInputBox({ title: 'Commit Defender: Use API Credential · API key',
      prompt: `Store the model API key for ${binding.endpoint}. This is not a GCR reader key.`, password: true, ignoreFocusOut: true,
      validateInput: value => value.length && value.length <= 16384 && !/[\u0000-\u001f\u007f]/.test(value) ? undefined : 'Enter a nonempty API key without control characters.' });
    if (secret === undefined) return;
    if (!modelSettingsUnchanged(port, snapshot)) throw Error('configuration-changed');
    try { reference = await saveModelCredential(profileId, binding, secret); }
    catch (error) {
      if (!(error instanceof ModelCredentialError) || error.code !== 'credential-conflict') throw error;
      const revision = await modelCredentialRevision(profileId, binding);
      const action = await vscode.window.showWarningMessage(`Commit Defender: Replace the existing key for ${binding.endpoint} (${binding.model})? Other destinations are preserved.`, { modal: true }, 'Replace Key');
      if (action !== 'Replace Key') return;
      if (!modelSettingsUnchanged(port, snapshot)) throw Error('configuration-changed');
      reference = await saveModelCredential(profileId, binding, secret, {}, revision);
    }
    if (await resolveModelCredential(reference, binding) !== secret) throw Error('credential-verification-failed');
  }
  await apply(snapshot, { aiProvider: provider, endpoint: binding.endpoint, model: binding.model,
    apiVersion: binding.apiVersion, reviewReasoningEffort: chosenEffort, modelCredentialRef: reference });
  void vscode.window.showInformationMessage(`Commit Defender: ${provider} · ${binding.model} configured. Stored credential verified. API access and model availability will be checked on review; no model request was made.`);
}
async function guarded(work: () => Promise<void>): Promise<void> {
  if (running) { void vscode.window.showInformationMessage('Commit Defender: Model setup is already open. Finish or cancel it first.'); return; }
  running = true;
  try { await work(); }
  catch { void vscode.window.showErrorMessage('Commit Defender: Model setup could not be completed. Check CLI authentication, the API destination, OS credential store, or concurrent User Settings changes. No success was recorded.', 'Open Settings')
    .then(action => action === 'Open Settings' ? vscode.commands.executeCommand('commitDefender.openSettings') : undefined); }
  finally { running = false; }
}
export function useAccount(extensionPath: string, signIn: (provider: SetupAccountProvider) => Promise<unknown>, selected?: SetupAccountProvider): Promise<void> {
  return guarded(() => accountFlow(extensionPath, signIn, selected));
}
export function useApiCredential(repoRoot?: string): Promise<void> { return guarded(() => apiFlow(repoRoot)); }
