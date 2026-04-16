"""Runtime settings loaded via pydantic-settings.

Priority (highest → lowest):
  1. Environment variables (os.environ)
  2. .commit-defender.env in the repo root
  3. ~/.commit-defender.env (home fallback)

Works in both Docker container and local (no-Docker) mode.
Credentials never appear in docker run arguments or shell history.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _env_files() -> list[Path]:
    """Return env files that exist, ordered lowest → highest priority.

    Supports both Docker (paths mounted at /run/secrets/home.env and /repo/)
    and local execution (paths resolved from CD_REPO_PATH and $HOME).

    Priority order (lowest first, so later entries win):
      1. Docker home mount  (/run/secrets/home.env)   — or ~/.commit-defender.env
      2. CD_HOME_ENV_FILE   — explicit override from VS Code extension or CLI
      3. Repo-level env     — <CD_REPO_PATH>/.commit-defender.env
    """
    candidates: list[Path] = []

    # Home env: Docker mount takes precedence over real home dir
    docker_home = Path("/run/secrets/home.env")
    local_home = Path.home() / ".commit-defender.env"
    candidates.append(docker_home if docker_home.exists() else local_home)

    # Explicit home env override (e.g. set by VS Code extension)
    custom_home = os.environ.get("CD_HOME_ENV_FILE", "")
    if custom_home:
        candidates.append(Path(custom_home))

    # Repo env — resolve from CD_REPO_PATH (works in both modes)
    repo_path_str = os.environ.get("CD_REPO_PATH", "")
    if repo_path_str:
        candidates.append(Path(repo_path_str) / ".commit-defender.env")
    else:
        candidates.append(Path("/repo/.commit-defender.env"))

    return [p for p in candidates if p.exists()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Azure OpenAI credentials
    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_deployment: str = ""
    azure_openai_api_version: str = "2024-08-01-preview"

    # Anthropic credentials
    anthropic_api_key: str = ""

    # Operational flags (non-secret, passed as -e by the hook)
    cd_skip_ai: str = "0"
    cd_dry_run: str = "0"
    cd_json: str = "0"
    cd_staged_files: str = ""
    # Explicit file list (newline-separated, repo-relative).
    # When set, skips git staging detection — used by "analyze file/directory" commands.
    cd_target_files: str = ""
    # Default to cwd when not running inside a Docker container
    cd_repo_path: str = ""

    # AI connection settings — set by VS Code extension; empty = fall back to env file / defaults
    cd_ai_provider: str = ""   # azure-openai | anthropic | openai
    cd_model: str = ""         # model or deployment name
    cd_endpoint: str = ""      # API endpoint URL (required for azure-openai)
    cd_api_version: str = ""   # Azure API version
    cd_api_key: str = ""       # API key (overrides provider-specific key from env file)
    cd_max_tokens: str = ""    # output token limit override

    # Review behavior — set by VS Code extension or hook; empty = fall back to
    # .commit-defender/settings.json, then built-in defaults.
    cd_analysis_mode: str = ""   # hybrid | ai-powered | rule-based
    cd_severity_level: str = ""
    cd_richness_level: str = ""
    cd_locale: str = ""
    # Newline-separated gitignore-style patterns from VS Code settings.
    # Merged with patterns in .commit-defender/settings.json.
    cd_exclude_patterns: str = ""

    @property
    def repo_path(self) -> str:
        """Resolved repo path: explicit value, else current working directory."""
        return self.cd_repo_path or str(Path.cwd())

    @field_validator("azure_openai_endpoint")
    @classmethod
    def strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def skip_ai(self) -> bool:
        return self.cd_skip_ai.strip() == "1"

    @property
    def dry_run(self) -> bool:
        return self.cd_dry_run.strip() == "1"

    @property
    def json_mode(self) -> bool:
        return self.cd_json.strip() == "1"

    def missing_azure_fields(self) -> list[str]:
        missing = []
        if not self.azure_openai_api_key:
            missing.append("AZURE_OPENAI_API_KEY")
        if not self.azure_openai_endpoint:
            missing.append("AZURE_OPENAI_ENDPOINT")
        if not self.azure_openai_deployment:
            missing.append("AZURE_OPENAI_DEPLOYMENT")
        return missing

    def missing_anthropic_fields(self) -> list[str]:
        if not self.anthropic_api_key:
            return ["ANTHROPIC_API_KEY"]
        return []


def load_settings() -> Settings:
    """Instantiate Settings with all available env files."""
    return Settings(_env_file=_env_files())
