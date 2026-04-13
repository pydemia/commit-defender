"""Tests for the AI review agent."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from commit_defender.ai_agent import AIReviewAgent
from commit_defender.config import AIReviewConfig
from commit_defender.models import ReviewResult
from commit_defender.settings import Settings, load_settings

SAMPLE_DIFF = (Path(__file__).parent / "fixtures" / "sample_diff.txt").read_text()


def _agent(enabled=True, blocking=False) -> AIReviewAgent:
    cfg = AIReviewConfig(enabled=enabled, model="gpt-5.1", blocking=blocking)
    return AIReviewAgent(cfg)


def _full_settings(**overrides) -> Settings:
    """Return a Settings instance with valid Azure credentials."""
    defaults = dict(
        azure_openai_api_key="test-key",
        azure_openai_endpoint="https://my-resource.openai.azure.com/",
        azure_openai_deployment="gpt-5.1",
        azure_openai_api_version="2024-08-01-preview",
        cd_skip_ai="0",
    )
    defaults.update(overrides)
    # Bypass env file loading by constructing directly
    return Settings.model_construct(**defaults)


def test_skip_ai_flag():
    settings = _full_settings(cd_skip_ai="1")
    with patch("commit_defender.ai_agent.load_settings", return_value=settings):
        result = _agent().review(SAMPLE_DIFF, [])
    assert "skipped" in result.summary.lower()
    assert result.blocking is False
    assert result.is_error is False


def test_disabled_in_config():
    settings = _full_settings()
    with patch("commit_defender.ai_agent.load_settings", return_value=settings):
        result = _agent(enabled=False).review(SAMPLE_DIFF, [])
    assert "skipped" in result.summary.lower()


def test_missing_api_key():
    settings = _full_settings(azure_openai_api_key="")
    with patch("commit_defender.ai_agent.load_settings", return_value=settings):
        result = _agent().review(SAMPLE_DIFF, [])
    assert result.is_error is True
    assert "AZURE_OPENAI_API_KEY" in result.summary


def test_missing_endpoint():
    settings = _full_settings(azure_openai_endpoint="")
    with patch("commit_defender.ai_agent.load_settings", return_value=settings):
        result = _agent().review(SAMPLE_DIFF, [])
    assert result.is_error is True
    assert "AZURE_OPENAI_ENDPOINT" in result.summary


def test_missing_deployment():
    settings = _full_settings(azure_openai_deployment="")
    with patch("commit_defender.ai_agent.load_settings", return_value=settings):
        result = _agent().review(SAMPLE_DIFF, [])
    assert result.is_error is True
    assert "AZURE_OPENAI_DEPLOYMENT" in result.summary


def test_successful_review():
    settings = _full_settings()
    mock_message = MagicMock()
    mock_message.content = json.dumps({
        "summary": "Code looks good with minor style issues.",
        "blocking": False,
    })
    mock_response = MagicMock()
    mock_response.choices = [MagicMock(message=mock_message)]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_response

    with patch("commit_defender.ai_agent.load_settings", return_value=settings), \
         patch("openai.AzureOpenAI", return_value=mock_client):
        result = _agent().review(SAMPLE_DIFF, [])

    assert result.summary == "Code looks good with minor style issues."
    assert result.blocking is False
    assert result.is_error is False


def test_malformed_ai_response():
    settings = _full_settings()
    mock_message = MagicMock()
    mock_message.content = "not valid json {{ }}"
    mock_response = MagicMock()
    mock_response.choices = [MagicMock(message=mock_message)]
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_response

    with patch("commit_defender.ai_agent.load_settings", return_value=settings), \
         patch("openai.AzureOpenAI", return_value=mock_client):
        result = _agent().review(SAMPLE_DIFF, [])

    assert "Could not parse" in result.summary
    assert result.is_error is True
