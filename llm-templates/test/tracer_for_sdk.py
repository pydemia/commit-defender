import json
import uuid
from functools import partial
from typing import Annotated, Any, Literal

from fastapi import Header
from openinference.instrumentation import (
    OITracer,
    using_attributes,
    using_metadata,
    using_session,
    using_tags,
    using_user,
)
from opentelemetry import trace as trace_api


# from opentelemetry.trace import get_tracer, get_tracer_provider, set_tracer_provider
from opentelemetry.instrumentation.instrumentor import BaseInstrumentor
from phoenix.otel import TracerProvider, register
from phoenix.trace import using_project
from pydantic import BaseModel, field_validator
from opentelemetry.sdk.trace import Span
from openinference.semconv.trace import SpanAttributes

from itertools import chain
from langchain_core.tracers.schemas import Run, RunTree
from langchain_core.tracers import context as langchain_context
from openinference.instrumentation import get_attributes_from_context
from openinference.instrumentation.helpers import get_span_id, get_trace_id
from openinference.instrumentation.langchain._tracer import (
    _flatten,
    _as_input,
    _as_output,
    _convert_io,
    _prompts,
    _input_messages,
    _output_messages,
    _prompt_template,
    _invocation_parameters,
    _model_name,
    _token_counts,
    _function_calls,
    _tools,
    _retrieval_documents,
    _metadata,
)

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


TraceEngine = Literal["langchain", "langgraph", "openai", "autogen"]
FeedbackType = Literal["thumbsup", "score"]


def get_instrument(engine: TraceEngine = "langgraph") -> BaseInstrumentor:
    match engine:
        case "langchain" | "langgraph":
            from openinference.instrumentation.langchain import LangChainInstrumentor

            return LangChainInstrumentor

        case "openai" | "autogen":
            from openinference.instrumentation.openai import OpenAIInstrumentor

            return OpenAIInstrumentor

        case _:
            raise TypeError(f"'engine' should be one of {TraceEngine}")


def get_span_exporter(tracer_provider: TracerProvider):
    active_span_processsor = tracer_provider._active_span_processor
    span_processors = active_span_processsor._span_processors
    span_processor = span_processors[0]
    span_exporter = span_processor.span_exporter
    span_exporter._headers

    # from httpx import URL, _urlparse

    # span_exporter._endpoint
    # url = URL(span_exporter._endpoint)
    return span_exporter


def get_tracer(
    project_name: str = "default",
    endpoint: str | None = None,
    verbose: bool = False,
) -> TracerProvider:

    return register(
        endpoint=endpoint or phoenix_config.endpoint,
        project_name=project_name,
        set_global_tracer_provider=phoenix_config.as_global,
        verbose=verbose or phoenix_config.verbose,
        # auto_instrument=True,
        auto_instrument=False,
    )


def _get_project_name_from_tracer(tracer_provider: TracerProvider) -> str | None:
    return tracer_provider.resource.attributes.get("openinference.project.name")


class using_tracer:
    def __init__(
        self,
        tracer_provider: TracerProvider | None = None,
        engines: TraceEngine = ["langgraph"],
        project_name: str | None = None,
        session_id: str | None = None,
        user_id: str | None = None,
        metadata: dict[str, Any] = None,
        tags: list[str] | None = None,
        prompt_template: str = "",
        prompt_template_variables: dict[str, str] | None = None,
        prompt_template_version: str = "",
    ):

        self.tracer_provider: TracerProvider
        if tracer_provider:
            self.tracer_provider = tracer_provider
        else:
            self.tracer_provider = get_tracer(project_name=project_name)
        self.project_name = project_name or _get_project_name_from_tracer(
            self.tracer_provider
        )

        self.set_global_tracer_provider = phoenix_config.as_global
        self.verbose = phoenix_config.verbose
        self.tracing_enabled = phoenix_config.enabled

        self.engines = engines
        self.instruments = []
        self.tracers = []
        for engine in engines:
            instrument_cls = get_instrument(engine)
            instrument = instrument_cls()
            instrument.instrument(tracer_provider=tracer_provider)
            self.instruments.append(instrument)
            self.tracers.append(getattr(instrument, "_tracer"))

        self.tracer = self.tracers[0]
        self.main_tracer: OITracer = self.tracer_provider.get_tracer("UserTracer")
        self.span_exporter = get_span_exporter(self.tracer_provider)

        self.session_id = gen_session_id(session_id)
        self.user_id = user_id or ""
        self.metadata = metadata
        self.tags = tags

        self.prompt_template = prompt_template
        self.prompt_template_variables = prompt_template_variables
        self.prompt_template_version = prompt_template_version

        self._using_project = using_project(self.project_name)
        self._using_tracer_attributes = using_attributes(
            session_id=self.session_id,
            user_id=self.user_id,
            metadata=self.metadata,
            tags=self.tags,
            prompt_template=self.prompt_template,
            prompt_template_variables=self.prompt_template_variables,
            prompt_template_version=self.prompt_template_version,
        )
        # self._using_span = self.tracer.start_as_current_span(
        #     "User Agent",
        #     openinference_span_kind="agent",
        # )
        self._using_span = self.main_tracer.start_as_current_span(
            "User Agent",
            openinference_span_kind="agent",
        )
        self._using_langchain_context = langchain_context.tracing_v2_enabled()
        self._using_langchain_runs_cb = langchain_context.collect_runs()

        self.input: dict[str, str] = {}
        self.output: dict[str, str] = {}
        self.span_id = None
        self.trace_id = None

    def __enter__(self):
        if self.tracing_enabled:
            self._using_project.__enter__()
            self._using_tracer_attributes.__enter__()
            self.span = self._using_span.__enter__()
            self.span_id = get_span_id(self.span)
            self.trace_id = get_trace_id(self.span)
            self.set_span_attributes(
                prompt_template=self.prompt_template,
                metadata=self.metadata,
            )
            self.langchain_context = self._using_langchain_context.__enter__()
            self.langchain_runs = self._using_langchain_runs_cb.__enter__()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.tracing_enabled:
            self.collected_runs: list[Run | RunTree] = self.langchain_runs.traced_runs

            self._set_langchain_span_attributes(self.langchain_context.latest_run)

            self._using_langchain_context.__exit__(exc_type, exc_val, exc_tb)
            self._using_langchain_runs_cb.__exit__(exc_type, exc_val, exc_tb)
            self._using_span.__exit__(exc_type, exc_val, exc_tb)
            self._using_tracer_attributes.__exit__(exc_type, exc_val, exc_tb)
            self._using_project.__exit__(exc_type, exc_val, exc_tb)

    def add_input(self, input_: dict[str, str] | str):
        self.input = input_
        self.span.set_attributes(
            dict(
                _flatten(
                    chain(
                        _as_input(_convert_io(input_)),
                        _prompts(input_),
                        _input_messages(input_),
                    )
                )
            )
        )

    def add_output(self, output_: dict[str, str] | str):
        self.span.set_attributes(
            dict(
                _flatten(
                    chain(
                        _as_output(_convert_io(output_)),
                        _output_messages(output_),
                    )
                )
            )
        )

    def set_span_attributes(
        self,
        prompt_template,
        metadata,
    ):

        self.span.set_attributes(
            dict(
                _flatten(
                    chain(
                        _prompt_template(prompt_template),
                        _metadata(metadata),
                    )
                )
            )
        )

    def _set_langchain_span_attributes(self, run: Run):

        inputs = self.input or run.inputs
        output = self.output or run.outputs
        self.span.set_attributes(dict(get_attributes_from_context()))
        self.span.set_attributes(
            dict(
                _flatten(
                    chain(
                        _as_input(_convert_io(inputs)),
                        _as_output(_convert_io(output)),
                        _prompts(inputs),
                        _input_messages(inputs),
                        _output_messages(output),
                        _prompt_template(run),
                        _invocation_parameters(run),
                        _model_name(run.extra),
                        _token_counts(output),
                        _function_calls(output),
                        _tools(run),
                        _retrieval_documents(run),
                        _metadata(run),
                    )
                )
            )
        )

    def add_feedback(
        self,
        feedback_name: str = "feedback",
        type: FeedbackType = "thumsup",
        thumbsup: bool = True,
        score: float = 1.0,
        explanation: str = "",
        metadata: dict[str, str] = {},
        headers: dict[str, str] = None,
    ):
        span_id = get_span_id(self.span)
        trace_id = get_trace_id(self.span)
        if not self.span_id:
            raise ValueError("span has not been created.")
        else:
            add_feedback(
                span_id=self.span_id,
                feedback_name=feedback_name,
                type=type,
                thumbsup=thumbsup,
                score=score,
                explanation=explanation,
                metadata=metadata or self.metadata,
                # headers=headers,
            )


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


def add_feedback(
    span_id: str,
    feedback_name: str = "feedback",
    type: FeedbackType = "thumsup",
    thumbsup: bool = True,
    score: float = 1.0,
    explanation: str = "",
    metadata: dict[str, str] = {},
    headers: dict[str, str] = None,
):
    import httpx

    kind: str = "HUMAN"
    name: str = "feedback"

    value: dict[str, str | float]
    if type == "thumbsup":
        value = {
            "label": "thumbsup",
            "score": float(thumbsup),
            "explanation": explanation,
        }
    elif type == "score":
        value = {
            "label": "score",
            "score": score,
            "explanation": explanation,
        }

    client = httpx.Client()
    from httpx import URL

    annotation_payload = {
        "data": [
            {
                "span_id": span_id,
                "name": name,
                "annotator_kind": kind,
                "result": value,
                "metadata": metadata,
            }
        ]
    }

    # headers = {"api_key": "<your phoenix api key>"}
    url = URL(phoenix_config.endpoint)
    host = f"{url.scheme}://{url.netloc.decode()}"

    resp = client.post(
        f"{host}/v1/span_annotations?sync=false",
        json=annotation_payload,
        headers=headers,
    )
    if resp.status_code == 200:
        return resp.json()
    else:
        resp.raise_for_status()
