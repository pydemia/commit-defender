# Skill 04 — Diff Extraction

## Purpose
Implement `commit_defender/diff_extractor.py`: extract the staged git diff for each file and provide it to the AI review agent. The diff is the primary signal for understanding *what changed*, not just *what exists*.

---

## Why diffs, not full files?

- **Token efficiency**: diffs show only changed lines, keeping the AI prompt small even in large files.
- **Focus**: Claude can review what the developer actually changed rather than the entire file history.
- **Binary files**: diffs skip binary files naturally.

---

## Implementation

### Basic usage

```python
class DiffExtractor:
    def __init__(self, repo_path: Path) -> None:
        self.repo_path = repo_path

    def get_full_diff(self, files: list[Path]) -> str:
        rel_paths = [str(f.relative_to(self.repo_path)) for f in files]
        result = subprocess.run(
            ["git", "-C", str(self.repo_path), "diff", "--cached", "--"] + rel_paths,
            capture_output=True, text=True, check=True,
        )
        return result.stdout
```

### Edge case: initial commit (no HEAD)

On a brand-new repo, `git diff --cached` fails with "fatal: ambiguous argument 'HEAD'".

```python
try:
    result = self._run_git(["diff", "--cached", "--"] + rel_paths)
except subprocess.CalledProcessError:
    # Diff against the empty tree SHA (always valid)
    empty_tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    result = self._run_git(["diff", "--cached", empty_tree, "--"] + rel_paths)
```

### Edge case: very large diffs

Truncate to avoid hitting Claude's context limits:

```python
MAX_DIFF_CHARS = 80_000

diff = result.stdout
if len(diff) > MAX_DIFF_CHARS:
    diff = diff[:MAX_DIFF_CHARS] + "\n\n[... diff truncated for token limit ...]"
```

### Edge case: renamed files

`git diff --cached` with `--diff-filter=ACMR` (used in the hook) already includes renames. The diff shows both the old and new path in the header, which Claude understands.

### Edge case: binary files

Binary files produce a diff like:
```
Binary files a/image.png and b/image.png differ
```

This is safe to pass through — Claude will recognize it and skip reviewing it. No special handling needed.

---

## Container context

Inside the Docker container, the repo is mounted at `/repo`. The `.git` directory is included (read-only mount), so `git diff --cached` works correctly:

```bash
git -C /repo diff --cached -- src/main.py
```

The container has `git` installed via `apt-get install git` (see skill 02).

---

## Integration in `entrypoint.py`

```python
diff_extractor = DiffExtractor(repo_path)
full_diff = diff_extractor.get_full_diff(staged_files)
# Then pass full_diff to AIReviewAgent
review = ai_agent.review(full_diff, lint_findings)
```

---

## Testing

The diff extractor requires a real git repo with staged changes. Use `tmp_path` and `subprocess` to set up a fixture:

```python
def test_diff_extractor(tmp_path):
    subprocess.run(["git", "init"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp_path, check=True)
    f = tmp_path / "main.py"
    f.write_text("x = 1\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)

    extractor = DiffExtractor(tmp_path)
    diff = extractor.get_full_diff([f])
    assert "+x = 1" in diff
```
