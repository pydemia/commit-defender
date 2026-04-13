"""Tests for config loading."""

import textwrap
from pathlib import Path

import pytest
import yaml

from commit_defender.config import Config, load_config


def test_default_config():
    config = Config()
    assert config.blocking_severity == "error"
    assert config.linters.python.enabled is True
    assert config.linters.python.tool == "ruff"
    assert config.ai_review.model == "claude-sonnet-4-6"
    assert config.ai_review.blocking is False


def test_load_config_from_file(tmp_path: Path):
    cfg_file = tmp_path / "commit-defender.yaml"
    cfg_file.write_text(textwrap.dedent("""\
        version: 1
        blocking_severity: warning
        linters:
          python:
            enabled: false
        ai_review:
          enabled: false
    """))

    config = load_config(tmp_path)
    assert config.blocking_severity == "warning"
    assert config.linters.python.enabled is False
    assert config.ai_review.enabled is False


def test_load_config_missing_file(tmp_path: Path):
    # No config file present → returns defaults
    config = load_config(tmp_path)
    assert isinstance(config, Config)
    assert config.blocking_severity == "error"


def test_load_config_partial_override(tmp_path: Path):
    cfg_file = tmp_path / "commit-defender.yaml"
    cfg_file.write_text("blocking_severity: info\n")

    config = load_config(tmp_path)
    assert config.blocking_severity == "info"
    # Unspecified values use defaults
    assert config.linters.python.enabled is True
