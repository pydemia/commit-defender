import json
import uuid
from functools import partial
from typing import Annotated, Any

from fastapi import Header
from openinference.instrumentation import (
    using_attributes,
    using_metadata,
    using_session,
    using_tags,
    using_user,
)
from opentelemetry import trace as trace_api
from opentelemetry.trace import get_tracer, get_tracer_provider, set_tracer_provider
from phoenix.otel import TracerProvider, register
from phoenix.trace import using_project
from pydantic import BaseModel, field_validator

# from agentapp.core.agentapp_config import phoenix_config
import os
import re
from pathlib import Path
from typing import Any, Literal
import yaml

from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    YamlConfigSettingsSource,
)
from pydantic_settings.sources import import_yaml
from pydantic import Field, field_validator, model_validator


class EnvYamlConfigSettingsSource(YamlConfigSettingsSource):
    def _read_file(self, file_path: Path) -> dict[str, Any]:
        import_yaml()
        with open(file_path, encoding=self.yaml_file_encoding) as yaml_file:
            yaml_str = yaml_file.read()
            env_pattern = re.compile(r".*?\${(\w+)}.*?")
            enved = env_pattern.findall(yaml_str)
            if enved:
                for env in enved:
                    yaml_str = yaml_str.replace(
                        f"${{{env}}}",
                        os.environ.get(env, f"${{{env}}}"),
                    )

            # return yaml.safe_load(yaml_file)
            return yaml.safe_load(yaml_str)


class AppSettings(BaseSettings):
    _root_key: str | None = None

    @model_validator(mode="before")
    def _filter_by_root_key(cls, values):
        try:
            root_key = cls._root_key.get_default()
        except AttributeError:
            root_key = None

        if "config" in values:
            values_to_use = values.pop("config")
        else:
            values_to_use = values
        if root_key is not None and str(root_key):
            values_to_use = values_to_use.get(str(root_key), {})

        # values.update(values_to_use)
        values = values_to_use
        return values

    model_config = SettingsConfigDict(
        env_prefix="",
        env_nested_delimiter="__",
        yaml_file=os.getenv("AGENTAPP_CONFIG", "agentapp-config.yaml"),
        frozen=False,
        validate_default=True,
        arbitrary_types_allowed=True,
        case_sensitive=True,
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            init_settings,
            env_settings,
            file_secret_settings,
            EnvYamlConfigSettingsSource(settings_cls),
        )


class PhoenixConfig(AppSettings):
    """Tracing with `phoenix`"""

    _root_key: str = "phoenix"
    enabled: bool = Field(os.getenv("PHOENIX_TRACER__ENABLED", False))
    endpoint: str = Field(
        os.getenv("PHOENIX_TRACER__ENDPOINT", "http://phoenix:4317"),
        examples=[
            "http://phoenix:4317",
            "http://phoenix:6006/v1/traces",
        ],
    )
    verbose: bool = Field(
        os.getenv(
            "PHOENIX_TRACER__VERBOSE",
            os.getenv("LOG_LEVEL", "INFO").upper() == "DEBUG",
        )
    )
    as_global: bool = Field(os.getenv("PHOENIX_TRACER__AS_GLOBAL", True))
    project_name: str = Field(
        os.getenv("PHOENIX_TRACER__PROJECT_NAME", "default"),
        description="배포된 app에서 tracing 할 때 사용하는 project_name. Serving Request시 agent_param에 담고, app 뜰 때 env로 주입",
    )

    @field_validator("enabled", "verbose", "as_global", mode="before")
    def _bool(cls, v):
        if isinstance(v, bool):
            return v

        elif isinstance(v, str):
            if v.lower() == "false":
                return False
            elif v.lower() == "true":
                return True
            else:
                return False

        else:
            return False


phoenix_config = PhoenixConfig()


def gen_session_id(session_id: str | None):
    return session_id or str(uuid.uuid4())


def set_tracer(
    project_name: str = "default",
    endpoint: str | None = None,
    verbose: bool | None = None,
) -> TracerProvider:

    return register(
        endpoint=endpoint or phoenix_config.endpoint,
        project_name=project_name,
        set_global_tracer_provider=phoenix_config.as_global,
        verbose=verbose or phoenix_config.verbose,
        auto_instrument=True,
    )


class using_tracer:
    def __init__(
        self,
        tracer: TracerProvider | None,
        project_name: str = "default",
        session_id: str | None = None,
        user_id: str | None = None,
        metadata: dict[str, Any] = None,
        tags: list[str] | None = None,
    ):
        self.project_name = project_name
        self.endpoint = phoenix_config.endpoint
        self.set_global_tracer_provider = True
        self.verbose = phoenix_config.verbose
        self.auto_instrument = True
        self.tracing_enabled = phoenix_config.enabled
        self.tracer_provider: TracerProvider = None

        self.session_id = gen_session_id(session_id)
        self.user_id = user_id or ""
        self.metadata = metadata
        self.tags = tags

        self._using_project = using_project(self.project_name)
        self._using_tracer_attributes = using_attributes(
            session_id=self.session_id,
            user_id=self.user_id,
            metadata=self.metadata,
            tags=self.tags,
        )
        self._using_session = using_session(self.session_id)

        self.tracer_provider = tracer

    def __enter__(self):
        if self.tracing_enabled:
            self._using_project.__enter__()
            self._using_tracer_attributes.__enter__()

    def __exit__(self, exc_type, exc_val, exc_tb):
        # self.tracer_provider
        # tracer: TracerProvider = get_tracer_provider()

        if self.tracing_enabled:
            self._using_project.__exit__(exc_type, exc_val, exc_tb)
            self._using_tracer_attributes.__exit__(exc_type, exc_val, exc_tb)


class TraceHeaders(BaseModel):
    model_config = {"extra": "allow"}

    session_id: str | None
    user_id: str | None
    metadata: dict[str, Any] | None = None
    tags: list[str] | None = None

    @field_validator("tags", mode="before")
    def get_unique_tags(cls, v):
        if v and len(v) > 0:
            tags_str = v[0]
            tags = set(tags_str.split(","))
            return list(tags)
        else:
            return []

    @field_validator("metadata", mode="before")
    def get_metadata(cls, v):
        if v and isinstance(v, str):
            metadata = json.dumps(str)
            return metadata
        else:
            return {}


TraceHeadersAnnotated = Annotated[TraceHeaders, Header()]


def as_header(cls):
    """decorator for pydantic model
    replaces the Signature of the parameters of the pydantic model with `Header`
    """
    cls.__signature__ = cls.__signature__.replace(
        parameters=[
            arg.replace(
                default=Header(...) if arg.default is arg.empty else Header(arg.default)
            )
            for arg in cls.__signature__.parameters.values()
        ]
    )
    return cls


# @as_header
async def inject_trace_headers(
    session_id: Annotated[str | None, Header()] = None,
    user_id: Annotated[str | None, Header()] = None,
    # metadata: Annotated[dict[str, Any] | None, Header()] = None,
    tags: Annotated[list[str] | None, Header()] = None,
):
    "To inject trace headers to FastAPI router as dependency, especially LangServe"
    # metadata header가 중복되어서 이름 변경 필요. 임시로 empty dict 사용
    metadata = {}
    if phoenix_config.enabled:
        async with using_attributes(
            session_id=session_id,
            user_id=user_id,
            metadata=metadata,
            tags=tags,
        ):
            try:
                yield TraceHeaders(
                    session_id=session_id, user_id=user_id, metadata=metadata, tags=tags
                )
            finally:
                pass
