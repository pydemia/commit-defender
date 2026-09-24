import * as vscode from 'vscode';

/** Native walkthrough descriptions and static SVGs need no Markdown preview worker. */
export async function openConnectionGuide(
  context: Pick<vscode.ExtensionContext, 'extension'>,
  requestedLanguage?: unknown,
): Promise<void> {
  const language = requestedLanguage === 'en' || requestedLanguage === 'ko'
    ? requestedLanguage : /^ko(?:-|$)/i.test(vscode.env.language) ? 'ko' : 'en';
  try {
    await vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      { category: `${context.extension.id}#gcrConnection${language.toUpperCase()}`, step: 'overview' },
      false,
    );
  } catch {
    await vscode.window.showErrorMessage(
      'Commit Defender: GCR connection guide could not be opened. Check the extension installation and try again.',
    );
  }
}

/** Keep settings in the native UI; opening it does not change their values. */
export async function openCommitDefenderSettings(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.openSettings2', '@ext:pydemia.commit-defender');
  } catch {
    await vscode.window.showErrorMessage(
      'Commit Defender: Settings could not be opened. Open VS Code Settings and search for Commit Defender.',
    );
  }
}
