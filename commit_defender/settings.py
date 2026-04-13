"""Runtime settings loaded via pydantic-settings.

Priority (highest → lowest):
  1. Environment variables (os.environ)
  2. .commit-defender.env in the repo root  (/repo/.commit-defender.env inside container)
  3. ~/.commit-defender.env                 (/run/secrets/home.env inside container)

Credentials never appear in docker run arguments or shell history.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Fixed paths inside the container
_HOME_ENV = Path("/run/secrets/home.env")       # mounted from ~/.commit-defender.env
_REPO_ENV = Path("/repo/.commit-defender.env")  # available via the existing repo mount


def _env_files() -> list[Path]:
    """Return env files that exist, ordered lowest → highest priority."""
    candidates = [_HOME_ENV, _REPO_ENV]
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

    # Operational flags (non-secret, passed as -e by the hook)
    cd_skip_ai: str = "0"
    cd_dry_run: str = "0"
    cd_staged_files: str = ""
    cd_repo_path: str = "/repo"

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

    def missing_azure_fields(self) -> list[str]:
        missing = []
        if not self.azure_openai_api_key:
            missing.append("AZURE_OPENAI_API_KEY")
        if not self.azure_openai_endpoint:
            missing.append("AZURE_OPENAI_ENDPOINT")
        if not self.azure_openai_deployment:
            missing.append("AZURE_OPENAI_DEPLOYMENT")
        return missing


def load_settings() -> Settings:
    """Instantiate Settings with all available env files."""
    return Settings(_env_file=_env_files())
