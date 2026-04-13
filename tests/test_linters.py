"""Tests for linter modules."""

import shutil
from pathlib import Path

import pytest

from commit_defender.config import LinterConfig
from commit_defender.linters.python_linter import PythonLinter
from commit_defender.linters.shell_linter import ShellLinter
from commit_defender.models import LintFinding

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.skipif(shutil.which("ruff") is None, reason="ruff not installed")
def test_python_linter_finds_issues():
    linter = PythonLinter(LinterConfig(tool="ruff", args=["--select", "E,W,F,I"]))
    dirty = FIXTURES / "sample_python_dirty.py"
    findings = linter.run([dirty])
    assert len(findings) > 0
    assert all(isinstance(f, LintFinding) for f in findings)
    # F401 = unused import (json is unused)
    rules = [f.rule for f in findings]
    assert any("F401" in r for r in rules)


@pytest.mark.skipif(shutil.which("ruff") is None, reason="ruff not installed")
def test_python_linter_clean_file(tmp_path: Path):
    clean = tmp_path / "clean.py"
    clean.write_text("x = 1\ny = x + 2\nprint(y)\n")
    linter = PythonLinter(LinterConfig(tool="ruff"))
    findings = linter.run([clean])
    assert findings == []


def test_python_linter_unavailable(monkeypatch):
    monkeypatch.setattr("shutil.which", lambda _: None)
    linter = PythonLinter(LinterConfig(tool="ruff"))
    findings = linter.run([FIXTURES / "sample_python_dirty.py"])
    assert findings == []


@pytest.mark.skipif(shutil.which("shellcheck") is None, reason="shellcheck not installed")
def test_shell_linter_finds_issues(tmp_path: Path):
    script = tmp_path / "bad.sh"
    script.write_text("#!/bin/sh\necho $UNQUOTED_VAR\n")
    linter = ShellLinter(LinterConfig(tool="shellcheck"))
    findings = linter.run([script])
    assert len(findings) > 0
    assert all(isinstance(f, LintFinding) for f in findings)
