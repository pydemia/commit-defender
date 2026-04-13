# Skill 05 — AI Review Agent

## Purpose
Implement `commit_defender/ai_agent.py`: send the staged diff + linter findings to Azure OpenAI and get a structured, actionable review comment back.

---

## Azure OpenAI SDK setup

```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-08-01-preview"),
)
```

Install: `pip install openai` (already in `pyproject.toml` dependencies).

---

## Required environment variables

| Variable | Description |
|---|---|
| `AZURE_OPENAI_API_KEY` | API key from your Azure OpenAI resource |
| `AZURE_OPENAI_ENDPOINT` | `https://<resource-name>.openai.azure.com/` |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name (e.g. `gpt-5.1`, `gpt-5.1-mini`) — overrides `ai_review.model` in config |
| `AZURE_OPENAI_API_VERSION` | Optional, defaults to `2024-08-01-preview` |

These are passed from the host shell into the container by the pre-commit hook (`-e VAR="${VAR}"`).

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

## JSON mode

Azure OpenAI supports `response_format={"type": "json_object"}`, which guarantees valid JSON output and removes the need for fragile JSON parsing heuristics:

```python
response = client.chat.completions.create(
    model=deployment,
    max_tokens=config.max_tokens,
    response_format={"type": "json_object"},
    messages=[
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ],
)
raw = response.choices[0].message.content.strip()
data = json.loads(raw)
```

Note: `json_object` mode requires the prompt to explicitly mention JSON output (which the system prompt does).

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

## Deployment vs model name

In Azure OpenAI, the `model` parameter in API calls refers to the **deployment name** (not the underlying model family). The deployment name is set when you deploy a model in Azure AI Studio and can be anything (e.g., `my-gpt4o-prod`).

Priority for resolving the deployment name:
1. `AZURE_OPENAI_DEPLOYMENT` env var (highest priority)
2. `ai_review.model` in `commit-defender.yaml`
3. Default: `gpt-5.1`

---

## Error handling

| Scenario | Behavior |
|---|---|
| `CD_SKIP_AI=1` | Return `ReviewResult.skipped()` immediately |
| `config.enabled=False` | Same as above |
| `AZURE_OPENAI_API_KEY` missing | Return `ReviewResult.error("AZURE_OPENAI_API_KEY not set")` |
| `AZURE_OPENAI_ENDPOINT` missing | Return `ReviewResult.error("AZURE_OPENAI_ENDPOINT not set")` |
| `json.JSONDecodeError` | Return `ReviewResult.error("Could not parse AI response: ...")` |
| Any other exception | Return `ReviewResult.error(str(e))` |

Never raise exceptions from this module — always return a `ReviewResult`.

---

## Blocking behavior

By default (`ai_review.blocking: false`), the AI review is advisory — it never causes a commit abort on its own. If `ai_review.blocking: true` is set, then `ReviewResult.blocking=True` from the model will cause exit code 1.

---

## Testing (unit)

Mock `openai.AzureOpenAI` to avoid real API calls:

```python
from unittest.mock import MagicMock, patch

mock_message = MagicMock()
mock_message.content = '{"summary": "Looks good.", "blocking": false}'
mock_response = MagicMock()
mock_response.choices = [MagicMock(message=mock_message)]

mock_client = MagicMock()
mock_client.chat.completions.create.return_value = mock_response

with patch("openai.AzureOpenAI", return_value=mock_client):
    agent = AIReviewAgent(config)
    result = agent.review(diff, findings)

assert result.summary == "Looks good."
```

See `tests/test_ai_agent.py` for complete test cases.

---

## Integration test (live)

```bash
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com/
export AZURE_OPENAI_DEPLOYMENT=gpt-5.1
export CD_STAGED_FILES="tests/fixtures/sample_python_dirty.py"

docker run --rm \
  -v "$(pwd):/repo:ro" \
  -e AZURE_OPENAI_API_KEY \
  -e AZURE_OPENAI_ENDPOINT \
  -e AZURE_OPENAI_DEPLOYMENT \
  -e CD_STAGED_FILES \
  commit-defender:latest
```
