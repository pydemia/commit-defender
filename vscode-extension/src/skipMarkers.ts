import type { FileComment } from './types.js';

/** Only an explicit line-comment CD:skip directive suppresses its own line.
 * TODO and type-checker directives are not AI review exemptions. */
function markedLines(text: string, file: string): Set<number> {
  const marked = new Set<number>();
  const hashComments = /\.(?:py|pyi|sh|bash|zsh|rb|r|R|yaml|yml|toml)$/.test(file);
  let quote = '';
  let blockComment = false;
  let escaped = false;
  const lines = text.split(/\r?\n/);
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line];
    for (let i = 0; i < value.length; i++) {
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (value[i] === '\\') { escaped = true; continue; }
        if (value.startsWith(quote, i)) { i += quote.length - 1; quote = ''; }
        continue;
      }
      if (blockComment) {
        if (value.startsWith('*/', i)) { blockComment = false; i++; }
        continue;
      }
      if (!hashComments && value.startsWith('/*', i)) { blockComment = true; i++; continue; }
      const delimiter = hashComments ? (value[i] === '#' ? 1 : 0) : (value.startsWith('//', i) ? 2 : 0);
      if (delimiter) {
        if (/^\s*CD\s*:\s*skip(?:\s*:.*)?\s*$/i.test(value.slice(i + delimiter))) marked.add(line + 1);
        break;
      }
      if (value[i] === '"' || value[i] === "'" || (!hashComments && value[i] === '`')) {
        quote = hashComments && value.startsWith(value[i].repeat(3), i) ? value[i].repeat(3) : value[i];
        i += quote.length - 1;
      }
    }
    // Escaped newlines may continue a literal, but do not escape the next line's first character.
    escaped = false;
  }
  return marked;
}

/** Read no live files: use exactly the source captured before provider execution. */
export function applyMarkers(comments: FileComment[], sources: ReadonlyMap<string, string>): FileComment[] {
  const skipMap = new Map([...sources].map(([file, text]) => [file, markedLines(text, file)]));
  return comments.filter(comment => !skipMap.get(comment.file)?.has(comment.line));
}
