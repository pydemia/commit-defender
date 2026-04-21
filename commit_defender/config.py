"""Configuration loader for commit-defender."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

AnalysisMode = Literal["hybrid", "ai-powered", "rule-based"]
SeverityLevel = Literal["severe", "rigorous", "moderate", "generous", "lean"]
RichnessLevel = Literal["colorful", "chatty", "moderate", "simple", "silent"]
Locale = Literal["en", "ko"]


class LinterConfig(BaseModel):
    enabled: bool = True
    tool: str = ""
    args: list[str] = Field(default_factory=list)


class AIReviewConfig(BaseModel):
    enabled: bool = True
    model: str = "gpt-5.1"
    max_tokens: int = 1024
    blocking: bool = False
    system_prompt_suffix: str = ""


class LinterMap(BaseModel):
    python: LinterConfig = Field(default_factory=lambda: LinterConfig(tool="ruff"))
    javascript: LinterConfig = Field(default_factory=lambda: LinterConfig(tool="eslint"))
    typescript: LinterConfig = Field(default_factory=lambda: LinterConfig(tool="eslint"))
    shell: LinterConfig = Field(default_factory=lambda: LinterConfig(tool="shellcheck"))
    markdown: LinterConfig = Field(
        default_factory=lambda: LinterConfig(enabled=False, tool="markdownlint")
    )


class Config(BaseModel):
    version: int = 1
    blocking_severity: str = "error"
    linters: LinterMap = Field(default_factory=LinterMap)
    ai_review: AIReviewConfig = Field(default_factory=AIReviewConfig)
    exclude: list[str] = Field(
        default_factory=lambda: ["*.lock", "dist/**", "node_modules/**", "*.min.js"]
    )


def load_config(repo_path: Path | None = None) -> Config:
    """Load config from commit-defender.yaml (linter/blocking settings only).

    All review behaviour (analysis mode, severity, richness, locale, exclude patterns)
    is controlled exclusively via CD_* environment variables or VS Code settings.
    """
    config_path_env = os.environ.get("CD_CONFIG_PATH")

    candidates: list[Path] = []
    if config_path_env:
        candidates.append(Path(config_path_env))
    if repo_path:
        candidates.append(repo_path / "commit-defender.yaml")
    candidates.append(Path("/repo/commit-defender.yaml"))

    cfg_dict: dict[str, Any] = {}
    for candidate in candidates:
        if candidate.exists():
            cfg_dict = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
            break

    return Config.model_validate(cfg_dict)
