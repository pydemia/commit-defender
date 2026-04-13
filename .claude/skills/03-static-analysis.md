# Skill 03 — Static Analysis

## Purpose
Implement the `commit_defender/linters/` module: an abstract `BaseLinter` interface plus concrete wrappers for ruff, eslint, shellcheck, and markdownlint. All findings are normalized to `LintFinding` objects.

---

## Design

### `BaseLinter` (abstract)

```python
class BaseLinter(ABC):
    def __init__(self, config: LinterConfig) -> None:
        self.config = config

    @abstractmethod
    def run(self, files: list[Path]) -> list[LintFinding]: ...

    def _exec(self, cmd: list[str], cwd=None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)

    def _is_available(self, binary: str) -> bool:
        import shutil; return shutil.which(binary) is not None
```

**Key principle**: every linter must handle binary unavailability gracefully — return `[]` and never crash. The container should already have all binaries, but this makes local development safe.

---

## Linter implementations

### Python — `ruff`

```bash
ruff check --output-format json --select E,W,F,I path/to/file.py
```

Output is a JSON array. Each object contains:
- `filename`, `location.row`, `location.column`, `code`, `message`

Severity mapping (by rule prefix):
- `E`, `F` → `"error"`
- `W`, `I`, `B`, `A`, `S`, `C` → `"warning"`
- `N`, `D`, `UP`, `T` → `"info"`

### JavaScript/TypeScript — `eslint`

```bash
eslint --format json path/to/file.js
```

Output is a JSON array per file. Each `messages[]` entry has:
- `line`, `column`, `ruleId`, `message`, `severity` (0=info, 1=warn, 2=error)

**Fallback config**: if the repo has no `eslint.config.*` or `.eslintrc.*`, write a minimal embedded flat config to a temp dir and pass `--config <tmpdir>/eslint.config.mjs`. This prevents "no config found" errors in repos without JS linting set up.

```js
// embedded fallback
export default [{
  rules: {
    "no-unused-vars": "warn",
    "no-undef": "error",
    "eqeqeq": "warn",
    "semi": ["warn", "always"],
  }
}];
```

### Shell — `shellcheck`

```bash
shellcheck --format=json script.sh
```

Output is a JSON array. Each object has:
- `file`, `line`, `column`, `code`, `message`, `level` (error/warning/info/style)

Rule format: `SC<code>` (e.g., `SC2086`).

### Markdown — `markdownlint-cli2`

```bash
markdownlint-cli2 --formatter json file.md
```

JSON output is an array of objects with:
- `fileName`, `lineNumber`, `ruleNames[0]`, `ruleDescription`, `errorDetail`

All markdownlint findings are severity `"warning"`.

---

## Factory (`linters/__init__.py`)

```python
_LINTER_CLASSES = {
    "python": PythonLinter,
    "javascript": JSLinter,
    "typescript": JSLinter,
    "shell": ShellLinter,
    "markdown": MarkdownLinter,
}

def build_linters(lang: str, config: LinterConfig) -> list[BaseLinter]:
    cls = _LINTER_CLASSES.get(lang)
    return [cls(config)] if cls else []
```

---

## File routing (`staged_files.py`)

Map extension → language key:

```python
EXT_TO_LANG = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript",
    ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".md": "markdown", ".markdown": "markdown",
}
```

The orchestrator in `entrypoint.py` calls `reader.by_language(staged)` to get a `dict[lang, list[Path]]`, then dispatches to the correct linter.

---

## Adding a new linter

1. Create `commit_defender/linters/new_linter.py` inheriting `BaseLinter`
2. Implement `run(files)` with JSON or text parsing
3. Add language key → class in `_LINTER_CLASSES`
4. Add extension mappings in `EXT_TO_LANG`
5. Add `LinterConfig` entry in `Config.linters` (config.py)
6. Add binary install in `Dockerfile`

---

## Testing

```bash
# Run with a real dirty file
pytest tests/test_linters.py -v

# Manually invoke ruff inside container
docker run --rm -v $(pwd):/repo:ro \
  -e CD_STAGED_FILES="tests/fixtures/sample_python_dirty.py" \
  commit-defender:latest
```
