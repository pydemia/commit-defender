# Skill 08 — Configuration

## Purpose
Implement `commit_defender/config.py`: load and validate `commit-defender.yaml` from the target repo, apply defaults, and expose a typed `Config` object to all other modules.

---

## Config file location

The config lives in the **target repo** (the one being committed to), not in the commit-defender installation. Inside the container, the target repo is mounted at `/repo`, so the config is at `/repo/commit-defender.yaml`.

Priority order:
1. `CD_CONFIG_PATH` environment variable (absolute path)
2. `<repo_path>/commit-defender.yaml`
3. `/repo/commit-defender.yaml` (default container path)
4. Built-in defaults (no file needed)

---

## Pydantic models

```python
class LinterConfig(BaseModel):
    enabled: bool = True
    tool: str = ""
    args: list[str] = []

class AIReviewConfig(BaseModel):
    enabled: bool = True
    model: str = "claude-sonnet-4-6"
    max_tokens: int = 1024
    blocking: bool = False
    system_prompt_suffix: str = ""

class LinterMap(BaseModel):
    python: LinterConfig = LinterConfig(tool="ruff")
    javascript: LinterConfig = LinterConfig(tool="eslint")
    typescript: LinterConfig = LinterConfig(tool="eslint")
    shell: LinterConfig = LinterConfig(tool="shellcheck")
    markdown: LinterConfig = LinterConfig(enabled=False, tool="markdownlint")

class Config(BaseModel):
    version: int = 1
    blocking_severity: str = "error"
    linters: LinterMap = LinterMap()
    ai_review: AIReviewConfig = AIReviewConfig()
    exclude: list[str] = ["*.lock", "dist/**", "node_modules/**", "*.min.js"]
```

Pydantic validates types at load time and applies defaults for missing keys. A partial YAML file is safe — only the specified keys are overridden.

---

## `load_config` function

```python
def load_config(repo_path: Path | None = None) -> Config:
    candidates = []
    if cd_path := os.environ.get("CD_CONFIG_PATH"):
        candidates.append(Path(cd_path))
    if repo_path:
        candidates.append(repo_path / "commit-defender.yaml")
    candidates.append(Path("/repo/commit-defender.yaml"))

    for path in candidates:
        if path.exists():
            raw = yaml.safe_load(path.read_text()) or {}
            return Config.model_validate(raw)

    return Config()  # all defaults
```

---

## File exclusions with `pathspec`

The `exclude` list uses gitignore syntax. The `pathspec` library handles matching:

```python
import pathspec

spec = pathspec.PathSpec.from_lines("gitwildmatch", config.exclude)

# Check a relative path (from repo root)
if spec.match_file("dist/bundle.js"):
    continue  # skip this file
```

This means patterns like `dist/**`, `*.lock`, and `node_modules/**` work exactly as they do in `.gitignore`.

---

## Full `commit-defender.yaml` reference

```yaml
version: 1

# Severity that blocks the commit: error | warning | info
blocking_severity: error

linters:
  python:
    enabled: true
    tool: ruff
    args: ["--select", "E,W,F,I"]   # passed to ruff check

  javascript:
    enabled: true
    tool: eslint

  typescript:
    enabled: true
    tool: eslint

  shell:
    enabled: true
    tool: shellcheck

  markdown:
    enabled: false                   # disabled by default
    tool: markdownlint

ai_review:
  enabled: true
  model: claude-sonnet-4-6          # or claude-opus-4-6
  max_tokens: 1024
  blocking: false                   # true = AI can abort commits
  system_prompt_suffix: |           # project-specific context for Claude
    This is a Django web application. Prioritize security and PEP 8 compliance.

exclude:
  - "*.lock"
  - "dist/**"
  - "build/**"
  - "node_modules/**"
  - "*.min.js"
  - ".venv/**"
  - "migrations/**"                 # example: skip Django migrations
```

---

## Environment variable overrides

| Variable | Effect |
|---|---|
| `CD_CONFIG_PATH` | Override config file path |
| `CD_SKIP_AI` | Set to `1` to disable AI review at runtime |
| `CD_DRY_RUN` | Set to `1` to always exit 0 (analysis only) |
| `CD_REPO_PATH` | Override `/repo` mount path |

These take precedence over config file settings.

---

## Testing

```python
def test_load_config_from_file(tmp_path):
    (tmp_path / "commit-defender.yaml").write_text(
        "blocking_severity: warning\n"
        "linters:\n  python:\n    enabled: false\n"
    )
    config = load_config(tmp_path)
    assert config.blocking_severity == "warning"
    assert config.linters.python.enabled is False
    # Defaults still apply for unspecified keys
    assert config.ai_review.model == "claude-sonnet-4-6"
```

See `tests/test_config.py` for complete test suite.
