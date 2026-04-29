"""Runtime settings — all values come from CD_* environment variables set by the VS Code extension."""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
        case_sensitive=False,
    )

    # Operational flags
    cd_skip_ai: str = "0"
    cd_dry_run: str = "0"
    cd_json: str = "0"
    cd_staged_files: str = ""
    cd_target_files: str = ""
    cd_repo_path: str = ""

    # AI connection — set by VS Code extension (User Settings, application scope)
    cd_ai_provider: str = ""   # aoai | anthropic | openai | gemini
    cd_model: str = ""         # model or deployment name

    # API endpoint URL. Required for aoai. For other providers, leave empty
    # to use the default public endpoint shown below.
    #
    #   aoai      → https://YOUR_RESOURCE.openai.azure.com
    #   anthropic → https://api.anthropic.com/v1
    #   openai    → https://api.openai.com/v1
    #   gemini    → https://generativelanguage.googleapis.com/v1beta/models
    cd_endpoint: str = ""

    cd_api_version: str = "2024-08-01-preview"
    cd_api_key: str = ""       # API key
    cd_max_tokens: str = ""

    # Review behaviour — set by VS Code extension (window scope)
    cd_analysis_mode: str = ""   # hybrid | ai-powered | rule-based
    cd_severity_level: str = ""
    cd_richness_level: str = ""
    cd_locale: str = ""
    cd_exclude_patterns: str = ""

    # Many-files guard (pre-commit hook / CLI mode only; ignored when CD_JSON=1)
    cd_staged_files_warn_threshold: str = "20"    # warn when staged file count exceeds this
    cd_repo_analysis_warn_threshold: str = "80"   # warn when on-demand file count exceeds this
    cd_many_files_action: str = ""                # proceed | skip | abort  (empty = prompt)

    @field_validator("cd_endpoint")
    @classmethod
    def strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def repo_path(self) -> str:
        return self.cd_repo_path or str(Path.cwd())

    @property
    def skip_ai(self) -> bool:
        return self.cd_skip_ai.strip() == "1"

    @property
    def dry_run(self) -> bool:
        return self.cd_dry_run.strip() == "1"

    @property
    def json_mode(self) -> bool:
        return self.cd_json.strip() == "1"


def load_settings() -> Settings:
    """Instantiate Settings from CD_* environment variables, with optional .env file fallback."""
    env_file = os.environ.get("CD_ENV_FILE", "").strip()
    if env_file:
        return Settings(_env_file=env_file)
    return Settings()
