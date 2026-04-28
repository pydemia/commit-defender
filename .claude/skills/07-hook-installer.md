# Skill 07 — Hook Installer

## Purpose

Implement `installer/install.py` and `installer/hook_fragment.sh`: the setup that wires
commit-defender into any git repository without disturbing hooks that other tools have
already placed there.

---

## How git hooks work

Git executes `.git/hooks/pre-commit` before recording a commit. If the script exits
non-zero, the commit is aborted. The file must be:

- Located at `<repo>/.git/hooks/pre-commit`
- Executable (`chmod +x`)
- A valid POSIX shell script

---

## Design: marker-based merge

Instead of writing a standalone hook file, commit-defender owns only a **named block**
inside the hook file, delimited by sentinel comments:

```sh
# BEGIN commit-defender
...
# END commit-defender
```

This means:

| Scenario | install behaviour | uninstall behaviour |
|---|---|---|
| No hook exists | Create file: shebang + marker block | — |
| Hook exists, **no** markers | Append marker block after existing content | Report "nothing to remove" |
| Hook exists, **has** markers | Replace only the marker block (idempotent) | Strip marker block; delete file if nothing meaningful remains |

---

## Hook fragment (`installer/hook_fragment.sh`)

This file is the embeddable logic — no shebang, wrapped in the sentinel markers.
It uses `_cd_*` prefixed variables to avoid shadowing variables in an existing hook
and `|| exit $?` instead of `set -e` so it does not affect the surrounding script's
error mode.

```sh
# BEGIN commit-defender
# commit-defender pre-commit hook
# To bypass (not recommended): git commit --no-verify
_cd_python="${COMMIT_DEFENDER_PYTHON:-{{PYTHON}}}"
_cd_staged="$(git diff --cached --name-only --diff-filter=ACMR)"

if [ -n "${_cd_staged}" ]; then
    if ! command -v "${_cd_python}" >/dev/null 2>&1; then
        echo "commit-defender: python not found at '${_cd_python}' — skipping." >&2
    else
        export CD_REPO_PATH="$(git rev-parse --show-toplevel)"
        export CD_STAGED_FILES="${_cd_staged}"
        if [ -z "${CD_API_KEY}" ]; then
            echo "commit-defender: CD_API_KEY not set — running linters only (AI review skipped)." >&2
            echo "  To enable AI review, set CD_AI_PROVIDER and CD_API_KEY in your shell profile." >&2
            export CD_SKIP_AI=1
        fi
        "${_cd_python}" -m commit_defender.app 1>&2 || exit $?
    fi
fi
# END commit-defender
```

Key decisions:

- `1>&2` — git captures stdout for the commit message; always write to stderr.
- `_cd_*` locals — avoids name collisions with the outer hook script.
- Soft failure on missing Python — exits 0 so a missing interpreter never blocks
  a developer who does not have commit-defender installed.
- `|| exit $?` — propagates a non-zero exit from the app even when the outer hook
  has no `set -e`.

---

## Installer (`installer/install.py`)

### Helper functions

```python
MARKER_BEGIN = "# BEGIN commit-defender"
MARKER_END   = "# END commit-defender"

def _make_fragment(python: str) -> str:
    """Read hook_fragment.sh and substitute the Python path."""

def _has_markers(content: str) -> bool:
    """True if the file already contains our sentinel block."""

def _strip_fragment(content: str) -> str:
    """Remove the marker block; also drops the blank separator line before it."""

def _is_empty_hook(content: str) -> bool:
    """True if every line is blank or a comment (shebang counts as comment)."""
```

### `install(repo_path, python, force=False)`

```
if hook does not exist:
    write "#!/usr/bin/env sh\n\n{fragment}\n"

elif hook has markers:
    strip fragment → re-append updated fragment   # idempotent reinstall

else:
    append "\n\n{fragment}\n" to existing content  # merge with foreign hook
```

`force` is accepted for CLI compatibility but is now a no-op — merging is always safe.

### `uninstall(repo_path)`

```
if hook does not exist:
    print message, return

if hook has no markers:
    print "nothing to remove", return

stripped = _strip_fragment(content)

if _is_empty_hook(stripped):
    delete the file
else:
    overwrite file with stripped content   # foreign hook preserved
```

---

## CLI interface

Registered in `pyproject.toml`:

```toml
[project.scripts]
commit-defender = "commit_defender.app:cli"
```

`commit_defender/app.py` delegates `install` / `uninstall` to `installer.install.main()`.

```
commit-defender install [REPO] [--python PYTHON]
commit-defender uninstall [REPO]
```

`REPO` defaults to `.` (current directory).

### Examples

```bash
# Install into the current repo
commit-defender install .

# Install with a virtualenv interpreter
commit-defender install . --python .venv/bin/python

# Install into another repo
commit-defender install /path/to/other-repo

# Remove only the commit-defender section
commit-defender uninstall .

# Remove from another repo
commit-defender uninstall /path/to/other-repo
```

---

## Coexistence with other hook managers

Because commit-defender appends a self-contained block, it works alongside:

- **pre-commit** (`pre-commit install`) — pre-commit writes its own hook content;
  commit-defender appends after it. Both run on every commit.
- **husky** — same pattern; husky's shebang and setup lines are preserved.
- **lefthook**, **lint-staged**, custom shell scripts — all preserved unchanged.

Order of execution follows the order of the blocks in the file. To control ordering,
manually move the `# BEGIN commit-defender … # END commit-defender` block within the
hook file; the installer will find and update the block wherever it sits.

---

## Updating the Python path

```bash
# Re-run install — replaces only the commit-defender block
commit-defender install . --python /new/path/to/python
```

Or set `COMMIT_DEFENDER_PYTHON` in your shell — the hook reads this env var at
runtime:

```bash
export COMMIT_DEFENDER_PYTHON=/path/to/.venv/bin/python
git commit -m "test"
```

---

## CI/CD usage (without the hook)

Run commit-defender directly in GitHub Actions — no hook installation needed:

```yaml
- name: Run commit-defender
  env:
    CD_AI_PROVIDER: anthropic
    CD_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    CD_MODEL: claude-sonnet-4-6
  run: |
    STAGED=$(git diff --name-only --diff-filter=ACMR HEAD~1..HEAD)
    CD_STAGED_FILES="$STAGED" \
    CD_REPO_PATH="$GITHUB_WORKSPACE" \
      python -m commit_defender.app
```
