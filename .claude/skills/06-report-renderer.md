# Skill 06 — Report Renderer

## Purpose
Implement `commit_defender/renderer.py`: format the analysis `Report` into a human-readable, ANSI-colored terminal output that appears in the developer's terminal before the commit proceeds or aborts.

---

## Design constraints

- **No external dependencies**: use raw ANSI escape codes (no `rich`, no `colorama`).
- **Write to stderr**: git captures stdout during commit message editing. Always use `sys.stderr`.
- **The hook uses `1>&2`**: so the container's stdout is also forwarded to stderr on the host side. Writing to stderr in Python is still correct.
- **Be concise**: developers see this at every commit. Don't be verbose.

---

## ANSI color constants

```python
RESET   = "\033[0m"
BOLD    = "\033[1m"
DIM     = "\033[2m"
RED     = "\033[31m"
YELLOW  = "\033[33m"
CYAN    = "\033[36m"
GREEN   = "\033[32m"
BG_RED  = "\033[41m"
BG_GREEN = "\033[42m"

def _color(text, *codes):
    return "".join(codes) + text + RESET
```

---

## Report layout

```
                                                  ← blank line
 commit-defender   pre-commit analysis            ← header (red bg if blocked)
────────────────────────────────────────────────  ← dim separator
  Staged files: 3
  Duration: 312ms

  Linting Issues
  ──────────────────────────────────────
  src/main.py                                     ← file in bold cyan
    ERROR  5:1  E501  line too long (110 chars)   ← badge + location + rule
    WARNING  12:4  W291  trailing whitespace

  utils.py
    WARNING  3:1  F401  'json' imported but unused

  AI Review
  ──────────────────────────────────────
  The staged changes introduce an unused import and some style
  violations. The logic itself is sound. Fix E501 and F401 before
  committing.

  COMMIT BLOCKED                                  ← red bg
  Fix the issues above and re-commit.
  To skip checks (not recommended): git commit --no-verify
```

---

## Severity badge colors

```python
def _severity_color(severity):
    return {"error": RED, "warning": YELLOW, "info": CYAN}.get(severity, RESET)
```

---

## `ReportRenderer` class

```python
class ReportRenderer:
    def __init__(self, stream=None):
        self.stream = stream or sys.stderr

    def render(self, report: Report, blocked: bool) -> None:
        lines = []
        # ... build lines list
        print("\n".join(lines), file=self.stream)
```

Build the output as a list of strings, then `print` once. This avoids interleaved writes if the container ever runs in a concurrent context.

---

## Findings grouping

Group findings by file, sort by line number within each file:

```python
from collections import defaultdict

by_file = defaultdict(list)
for f in sorted(report.lint_findings, key=lambda x: (x.file, x.line)):
    by_file[f.file].append(f)
```

---

## Testing

Inject a `StringIO` buffer as the stream:

```python
import io
buf = io.StringIO()
renderer = ReportRenderer(stream=buf)
renderer.render(report, blocked=True)
output = buf.getvalue()
assert "COMMIT BLOCKED" in output
assert "E501" in output
```

See `tests/test_renderer.py` for complete snapshot-style tests.

---

## Accessibility note

ANSI colors don't work in all terminals or CI environments. The report must still be readable without color (the text content carries all the information). Test with `NO_COLOR=1` by stripping color codes from output in tests.
