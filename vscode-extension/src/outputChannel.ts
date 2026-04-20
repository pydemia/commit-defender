import * as vscode from 'vscode';

let _channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!_channel) {
    // 'ansi' language id renders ANSI escape codes natively (VS Code 1.90+)
    _channel = vscode.window.createOutputChannel('Commit Defender', 'ansi');
  }
  return _channel;
}

export function disposeOutputChannel(): void {
  _channel?.dispose();
  _channel = undefined;
}
