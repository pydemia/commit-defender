import * as vscode from 'vscode';

/** Bundled documentation is available before an account or central connection exists. */
export async function openConnectionGuide(context: Pick<vscode.ExtensionContext, 'extensionUri'>): Promise<void> {
  const filename = /^ko(?:-|$)/i.test(vscode.env.language)
    ? 'central-setup.ko.md' : 'central-setup.md';
  const uri = vscode.Uri.joinPath(context.extensionUri, 'docs', filename);
  try {
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  } catch {
    // The built-in Markdown extension can be disabled; keep the guide readable.
    await vscode.window.showTextDocument(uri, { preview: true });
  }
}
