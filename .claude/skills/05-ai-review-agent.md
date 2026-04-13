# Skill 05 — AI Review Agent

## Purpose
Implement `commit_defender/ai_agent.py`: send the staged diff + linter findings to Claude and get a structured, actionable review comment back.

---

## Anthropic SDK setup

```python
import anthropic

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
```

Install: `pip install anthropic` (already in `pyproject.toml` dependencies).

---

## Prompt caching

The system prompt is large (static role definition) and identical on every commit. Cache it to avoid re-billing it:

```python
system=[
    {
        "type": "text",
        "text": SYSTEM_PROMPT,
        "cache_control": {"type": "ephemeral"},  # ← prompt caching
    }
]
```

This reduces latency from ~2s to ~0.5s after the first call, and saves ~80% of input token costs on the system prompt.

---

## System prompt

```
You are commit-defender, an AI code reviewer integrated into a git pre-commit hook.

Your job is to review the provided git diff and static analysis findings, then produce
a concise, actionable review that helps the developer understand what needs to be fixed.

Guidelines:
- Be direct and specific. Reference file names and line numbers.
- Group related issues together.
- Distinguish between must-fix issues (errors) and suggestions (warnings/style).
- Keep your summary under 300 words.
- Do not repeat every lint finding verbatim — synthesize patterns.
- If the code looks good overall, say so clearly.

Output format:
Respond ONLY with a valid JSON object:
{"summary": "<concise review, markdown allowed>", "blocking": <true|false>}
```

---

## User message structure

```python
user_message = f"""
## Staged diff

```diff
{diff}
```

## Static analysis findings

```
{chr(10).join(str(f) for f in lint_findings) or "None"}
```

Please review and respond with the JSON object.
"""
```

---

## Full API call

```python
response = client.messages.create(
    model=config.model,            # "claude-sonnet-4-6"
    max_tokens=config.max_tokens,  # 1024
    system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
    messages=[{"role": "user", "content": user_message}],
)
raw = response.content[0].text.strip()
data = json.loads(raw)
return ReviewResult(summary=data["summary"], blocking=data.get("blocking", False), raw_response=raw)
```

---

## Error handling

| Scenario | Behavior |
|---|---|
| `CD_SKIP_AI=1` | Return `ReviewResult.skipped()` immediately |
| `config.enabled=False` | Same as above |
| `ANTHROPIC_API_KEY` missing | Return `ReviewResult.error("ANTHROPIC_API_KEY not set")` |
| `json.JSONDecodeError` | Return `ReviewResult.error("Could not parse AI response: ...")` |
| Any other exception | Return `ReviewResult.error(str(e))` |

Never raise exceptions from this module — always return a `ReviewResult` so the pipeline continues and can still report linter findings.

---

## Model selection

Configurable in `commit-defender.yaml`:

```yaml
ai_review:
  model: claude-sonnet-4-6        # fast, default
  # model: claude-opus-4-6        # higher quality, ~4× slower
  # model: claude-haiku-4-5-20251001  # fastest, cheapest
```

---

## Blocking behavior

By default (`ai_review.blocking: false`), the AI review is advisory — it never causes a commit abort on its own. If `ai_review.blocking: true`, then `ReviewResult.blocking=True` from Claude will cause exit code 1.

This prevents a flaky AI from becoming a hard gate. Users opt in to hard blocking deliberately.

---

## Testing (unit)

Mock `anthropic.Anthropic` to avoid real API calls:

```python
from unittest.mock import MagicMock, patch

mock_client = MagicMock()
mock_client.messages.create.return_value = MagicMock(
    content=[MagicMock(text='{"summary": "Looks good.", "blocking": false}')]
)

with patch("anthropic.Anthropic", return_value=mock_client):
    agent = AIReviewAgent(config)
    result = agent.review(diff, findings)

assert result.summary == "Looks good."
```

See `tests/test_ai_agent.py` for complete test cases.

---

## Integration test (live)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export CD_STAGED_FILES="tests/fixtures/sample_python_dirty.py"

docker run --rm \
  -v "$(pwd):/repo:ro" \
  -e ANTHROPIC_API_KEY \
  -e CD_STAGED_FILES \
  commit-defender:latest
```
