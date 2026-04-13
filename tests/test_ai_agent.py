"""Tests for the AI review agent."""

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from commit_defender.ai_agent import AIReviewAgent
from commit_defender.config import AIReviewConfig
from commit_defender.models import LintFinding, ReviewResult

SAMPLE_DIFF = (Path(__file__).parent / "fixtures" / "sample_diff.txt").read_text()


def _agent(enabled=True, blocking=False) -> AIReviewAgent:
    cfg = AIReviewConfig(enabled=enabled, model="claude-sonnet-4-6", blocking=blocking)
    return AIReviewAgent(cfg)


def test_skip_ai_env_var(monkeypatch):
    monkeypatch.setenv("CD_SKIP_AI", "1")
    agent = _agent()
    result = agent.review(SAMPLE_DIFF, [])
    assert "skipped" in result.summary.lower()
    assert result.blocking is False


def test_disabled_in_config(monkeypatch):
    monkeypatch.delenv("CD_SKIP_AI", raising=False)
    agent = _agent(enabled=False)
    result = agent.review(SAMPLE_DIFF, [])
    assert "skipped" in result.summary.lower()


def test_missing_api_key(monkeypatch):
    monkeypatch.delenv("CD_SKIP_AI", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    agent = _agent()
    result = agent.review(SAMPLE_DIFF, [])
    assert "ANTHROPIC_API_KEY" in result.summary


def test_successful_review(monkeypatch):
    monkeypatch.delenv("CD_SKIP_AI", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "summary": "Code looks good with minor style issues.",
        "blocking": False,
    }))]

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response

    with patch("anthropic.Anthropic", return_value=mock_client):
        agent = _agent()
        findings = [
            LintFinding(file="f.py", line=1, col=0, rule="F401", message="unused import", severity="warning")
        ]
        result = agent.review(SAMPLE_DIFF, findings)

    assert result.summary == "Code looks good with minor style issues."
    assert result.blocking is False


def test_malformed_ai_response(monkeypatch):
    monkeypatch.delenv("CD_SKIP_AI", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="not valid json {{ }}")]

    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response

    with patch("anthropic.Anthropic", return_value=mock_client):
        agent = _agent()
        result = agent.review(SAMPLE_DIFF, [])

    assert "Could not parse" in result.summary
    assert result.blocking is False
