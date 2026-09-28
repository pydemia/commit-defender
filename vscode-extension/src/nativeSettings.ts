import * as vscode from 'vscode';

/** Advanced fallback for repository overrides and settings not edited in our panel. */
export async function openCommitDefenderSettings(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.openSettings2', {
      query: '@ext:pydemia.commit-defender',
    });
  } catch {
    await vscode.window.showErrorMessage(
      'Commit Defender: Settings could not be opened. Open VS Code Settings and search for Commit Defender.',
    );
  }
}
