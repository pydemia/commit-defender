# Skill 01 — Project Bootstrap

## Purpose
Set up the `commit-defender` Python package from scratch: project metadata, dependency management, shared data models, and the foundation every other module builds on.

## Prerequisites
- Python 3.12+
- `uv` package manager (`pip install uv` or `brew install uv`)

---

## 1. Initialize the package with uv

```bash
# Inside the repo root
uv init --no-workspace
# Then replace the generated pyproject.toml with the one below
```

### `pyproject.toml`

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "commit-defender"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "anthropic>=0.40.0",
    "pydantic>=2.0.0",
    "pyyaml>=6.0.0",
    "pathspec>=0.12.0",
]

[project.scripts]
commit-defender = "commit_defender.entrypoint:cli"

[project.optional-dependencies]
dev = ["pytest>=8.0.0", "pytest-mock>=3.12.0", "ruff>=0.8.0"]
```

Install for development:
```bash
uv pip install -e ".[dev]"
```

---

## 2. Package directory structure

```
commit_defender/
├── __init__.py          # version string
├── models.py            # shared dataclasses ← build this first
├── config.py            # ConfigLoader
├── staged_files.py      # StagedFilesReader
├── diff_extractor.py    # DiffExtractor
├── ai_agent.py          # AIReviewAgent
├── renderer.py          # ReportRenderer
├── exit_resolver.py     # ExitCodeResolver
├── entrypoint.py        # pipeline orchestrator + CLI
└── linters/
    ├── __init__.py      # factory function build_linters()
    ├── base.py          # abstract BaseLinter
    ├── python_linter.py
    ├── js_linter.py
    ├── shell_linter.py
    └── markdown_linter.py
```

---

## 3. Shared data models (`commit_defender/models.py`)

All modules import from here. Build this file first to avoid circular imports.

Key types:

```python
Severity = Literal["error", "warning", "info"]
SEVERITY_RANK = {"error": 3, "warning": 2, "info": 1}

@dataclass
class LintFinding:
    file: str; line: int; col: int
    rule: str; message: str; severity: Severity

@dataclass
class ReviewResult:
    summary: str
    findings: list[LintFinding] = field(default_factory=list)
    blocking: bool = False
    raw_response: str = ""

    @classmethod
    def skipped(cls) -> "ReviewResult": ...
    @classmethod
    def error(cls, message: str) -> "ReviewResult": ...

@dataclass
class Report:
    staged_files: list[str]
    lint_findings: list[LintFinding]
    review: ReviewResult
    duration_ms: int

    def findings_at_or_above(self, severity: Severity) -> list[LintFinding]: ...
```

---

## 4. Anthropic SDK setup

The `ai_agent.py` module uses the official Anthropic Python SDK:

```python
import anthropic

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
```

Key patterns:
- **Prompt caching**: add `"cache_control": {"type": "ephemeral"}` to the static system prompt to avoid re-billing it on every commit.
- **Structured output**: ask Claude to respond with a JSON object (`{"summary": "...", "blocking": bool}`); parse with `json.loads()`.
- **Offline escape hatch**: check `CD_SKIP_AI=1` env var before making any API call.

See skill `05-ai-review-agent.md` for the full implementation.

---

## 5. Verify the bootstrap

```bash
python -c "from commit_defender.models import Report; print('OK')"
pytest tests/test_models.py tests/test_config.py -v
```

Expected: all tests pass, no import errors.
