import * as path from "path";
import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { ReviewLinks } from "./reviewLinks.js";
import { safeMarkdown } from "./reviewMarkdown.js";
import { liveSource, readRecordedSource, validLine } from "./reviewSource.js";
import type { AnalysisReport } from "./types.js";

const SOURCE_SCHEME = "commit-defender-source";
const OPEN_COMMAND = "commitDefender.openReviewLink";
class ReviewNavigation {
  readonly links = new ReviewLinks();
  private documents = new Map<string, string>();
  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(OPEN_COMMAND, (id: unknown) =>
        this.open(id),
      ),
    );
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(SOURCE_SCHEME, {
        provideTextDocumentContent: (uri) =>
          this.documents.get(uri.toString()) ?? "",
      }),
    );
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === SOURCE_SCHEME)
          this.documents.delete(document.uri.toString());
      }),
    );
  }
  markdown(
    text: string,
    repoRoot: string,
    report: AnalysisReport,
    file?: string,
  ): vscode.MarkdownString {
    let linked = false;
    const body = safeMarkdown(text, (raw) => {
      const id = this.links.markdown(repoRoot, report, raw, file);
      if (!id) return undefined;
      linked = true;
      return `command:${OPEN_COMMAND}?${encodeURIComponent(JSON.stringify([id]))}`;
    });
    const markdown = new vscode.MarkdownString(body);
    markdown.isTrusted = linked ? { enabledCommands: [OPEN_COMMAND] } : false;
    markdown.supportHtml = false;
    markdown.supportThemeIcons = false;
    return markdown;
  }
  sourceCommand(
    repoRoot: string,
    report: AnalysisReport,
    file: string,
    line: number,
  ): vscode.Command | undefined {
    const id = this.links.source(repoRoot, report, file, line);
    return id
      ? {
          command: OPEN_COMMAND,
          title: "Open reviewed source",
          arguments: [id],
        }
      : undefined;
  }
  async open(
    id: unknown,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) return;
    const target = this.links.get(id);
    if (!target) return;
    if (target.kind === "web") {
      await vscode.env.openExternal(vscode.Uri.parse(target.url, true));
      return;
    }
    const { repoRoot, report, file, line } = target;
    const content = readRecordedSource(repoRoot, report, file);
    if (
      content === undefined ||
      !validLine(line, content.split(/\r?\n/).length)
    ) {
      void vscode.window.showInformationMessage(
        "Commit Defender: The reviewed source is no longer available. Run a new review.",
      );
      return;
    }
    const uri = vscode.Uri.file(path.join(repoRoot, file));
    const editor = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    const options = {
      selection: new vscode.Range(line - 1, 0, line - 1, 0),
      preview: true,
      preserveFocus: false,
    };
    if (
      editor &&
      !editor.isClosed &&
      liveSource(repoRoot, report, file, editor.getText()) !== undefined
    ) {
      // Reuse an already-open, validated document; do not reopen a filesystem path after checking it.
      await vscode.window.showTextDocument(editor, options);
      return;
    }
    const destination = vscode.Uri.from({
      scheme: SOURCE_SCHEME,
      path: `/${randomBytes(12).toString("hex")}/${file}`,
      query: "reviewed-source",
    });
    this.documents.set(destination.toString(), content);
    try {
      const document = await vscode.workspace.openTextDocument(destination);
      if (!isCurrent()) {
        this.documents.delete(destination.toString());
        return;
      }
      await vscode.window.showTextDocument(document, options);
    } catch {
      this.documents.delete(destination.toString());
      if (isCurrent()) void vscode.window.showInformationMessage(
        "Commit Defender: Could not open the reviewed source.",
      );
    }
  }
}
export const reviewNavigation = new ReviewNavigation();
