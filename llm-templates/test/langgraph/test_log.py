import pytest
from test.models import (
    load_env,
    llm,
    embedding,
    knowledge,
    medical_knowledge,
    legal_knowledge,
    tax_federal_knowledge,
    tax_regional_knowledge,
    tool_get_weather,
    tool_welcome_message,
    tool_add,
    tool_multiply,
    tools,
    categorizer,
    simple_graph,
)

from langchain_core.tracers import context

# from langchain_core.tracers.context import tracing_v2_enabled

from uuid import uuid4

PROJECT_ID = "test_project"  # "default"
# EXAMPLE_UUID = "6fed3f77-d972-45b9-b3dd-cdc37b80de06"
EXAMPLE_UUID = "11111111-1111-1111-1111-111111111111"  # uuid4(), None
TAGS = ["tag1", "tag2"]  # None


def test_simplechat(llm, embedding):

    with context.tracing_v2_enabled(
        project_name=PROJECT_ID,
        example_id=EXAMPLE_UUID,
        tags=TAGS,
        client=None,
        # **kwargs,  # _TracerCore (O), BaseCallbackHandler (X)
        # _schema_format: Literal[
        #     "original", "streaming_events", "original+chat"
        # ] = "original",  # For internal use only API will change.
    ) as tracing_context:
        result = llm.invoke("hi")
    print(result)

    from langchain_core.tracers import LangChainTracer
    from langsmith import Client, AsyncClient

    # API Reference: https://api.smith.langchain.com/redoc

    from langsmith.run_trees import RunTree
    from langchain_core.tracers import Run, RunLogPatch, RunLog, run_collector
    from langchain_core.tracers.log_stream import RunState

    tracing_context  # langchain_core.tracers.langchain.LangChainTracer
    tracing_context.project_name  # str: 'test_project'
    tracing_context.example_id  # UUID | str: UUID('11111111-1111-1111-1111-111111111111')
    tracing_context.tags  # sorted(list[str]): ['tag1', 'tag2']
    # tracing_context.ignore_agent = False
    # tracing_context.ignore_chain = False
    # tracing_context.ignore_chat_model = False
    # tracing_context.ignore_custom_event = False
    # tracing_context.ignore_llm = False
    # tracing_context.ignore_retriever = False
    # tracing_context.ignore_retry = False
    # tracing_context.log_missing_parent = True
    # tracing_context.raise_error = False
    # tracing_context.run_inline = True

    tracing_context.client  # LangSmith Client
    tracing_context.client.api_key  # None
    tracing_context.client.api_url  # 'https://api.smith.langchain.com'

    tracing_context.client.retry_config  # LangSmithRetry(total=3, connect=None, read=None, redirect=None, status=None)
    tracing_context.client.session  # requests.session.Session
    tracing_context.client.tracing_queue  # queue.PriorityQueue

    tracing_context.run_map  # dict[str, Run]: {}
    "Map of run ID to run. Cleared on run end."

    tracing_context.order_map  # dict[UUID, tuple[UUID, str]]: {UUID('59455ae2-7867-44a4-8ad9-63b54b4de888'): (UUID('59455ae2-7867-44a4-8ad9-63b54b4de888'), '20250225T121820399433Z59455ae2-7867-44a4-8ad9-63b54b4de888')}
    "Map of run ID to (trace_id, dotted_order). Cleared when tracer GCed."

    tracing_context.latest_run  # Run(Run=Runtree for v2): RunTree(id=59455ae2-7867-44a4-8ad9-63b54b4de888, name='ChatOpenAI', run_type='llm', dotted_order='20250225T121820399433Z59455ae2-7867-44a4-8ad9-63b54b4de888')
    from langchain_core.tracers.schemas import Run
    from langsmith.run_trees import RunTree

    tracing_context.latest_run.reference_example_id  # UUID('11111111-1111-1111-1111-111111111111')
    tracing_context.latest_run.session_name  # project_name if exists
    "alias='project_name'"
    tracing_context.latest_run.session_id  # UUID | None: None
    "alias='project_id'"
    tracing_context.latest_run.id  # UUID: UUID('59455ae2-7867-44a4-8ad9-63b54b4de888')
    "run_id."

    tracing_context.latest_run.trace_id  # UUID: UUID('59455ae2-7867-44a4-8ad9-63b54b4de888')
    "The trace id of the run."

    tracing_context.latest_run.run_type  # llm  # default='chain'
    'RUN_TYPE_T = Literal["tool", "chain", "llm", "retriever", "embedding", "prompt", "parser"]'

    tracing_context.latest_run.events  # list[dict[str, Any]]: [{'name': 'start', 'time': datetime.datetime(2025, 2, 25, 12, 18, 20, 399433, tzinfo=datetime.timezone.utc)}, {'name': 'end', 'time': datetime.datetime(2025, 2, 25, 12, 18, 21, 642901, tzinfo=datetime.timezone.utc)}]
    "List of events associated with the run, like start and end events."
    tracing_context.latest_run.events[0]["name"]  # start
    tracing_context.latest_run.events[0]["time"]  # datetime.datetime. UTC
    tracing_context.latest_run.events[-1]["name"]  # end
    tracing_context.latest_run.events[-1]["time"]  # datetime.datetime. UTC

    tracing_context.latest_run.start_time  # datetime.datetime. UTC
    tracing_context.latest_run.end_time  # datetime.datetime. UTC
    tracing_context.latest_run.extra  # dict[str, Any]: {'invocation_params': {'model': 'GIP/gpt-4o-new', 'model_name': 'GIP/gpt-4o-new', 'stream': False, '_type': 'openai-chat', 'stop': None}, 'options': {'stop': None}, 'batch_size': 1, 'metadata': {'ls_provider': 'openai', 'ls_model_name': 'GIP/gpt-4o-new', 'ls_model_type': 'chat', 'ls_temperature': None}, 'inputs_is_truthy': True}
    tracing_context.latest_run.serialized  # dict[str, Any]: {'lc': 1, 'type': 'constructor', 'id': ['langchain', 'chat_models', 'openai', 'ChatOpenAI'], 'kwargs': {'model_name': 'GIP/gpt-4o-new', 'openai_api_key': {...}, 'openai_api_base': '<OPENAI__ENDPOINT>'}, 'name': 'ChatOpenAI'}
    "The serialized model."
    tracing_context.latest_run.metadata  # {'ls_provider': 'openai', 'ls_model_name': 'GIP/gpt-4o-new', 'ls_model_type': 'chat', 'ls_temperature': None}
    tracing_context.latest_run.inputs  # {'messages': [[{'lc': 1, 'type': 'constructor', 'id': ['langchain', 'schema', 'messages', 'HumanMessage'], 'kwargs': {'content': 'hi', 'type': 'human'}}]]}
    tracing_context.latest_run.outputs  # {'generations': [[{'text': 'Hello! How can I help you today?', 'generation_info': {'finish_reason': 'stop', 'logprobs': None}, 'type': 'ChatGeneration', 'message': {'lc': 1, 'type': 'constructor', 'id': ['langchain', 'schema', 'messages', 'AIMessage'], 'kwargs': {'content': 'Hello! How can I help you today?', 'additional_kwargs': {'refusal': None}, 'response_metadata': {'token_usage': {'completion_tokens': 9, 'prompt_tokens': 8, 'total_tokens': 17, 'completion_tokens_details': {'accepted_prediction_tokens': 0, 'audio_tokens': 0, 'reasoning_tokens': 0, 'rejected_prediction_tokens': 0}, 'prompt_tokens_details': {'audio_tokens': 0, 'cached_tokens': 0}}, 'model_name': 'gpt-4o-2024-05-13', 'system_fingerprint': 'fp_65792305e4', 'finish_reason': 'stop', 'logprobs': None}, 'type': 'ai', 'id': 'run-59455ae2-7867-44a4-8ad9-63b54b4de888-0', 'usage_metadata': {'input_tokens': 8, 'output_tokens': 9, 'total_tokens': 17, 'input_token_details': {'audio': 0, 'cache_read': 0}, 'output_token_details': {'audio': 0, 'reasoning': 0}}, 'tool_calls': [], 'invalid_tool_calls': []}}}]], 'llm_output': {'token_usage': {'completion_tokens': 9, 'prompt_tokens': 8, 'total_tokens': 17, 'completion_tokens_details': {'accepted_prediction_tokens': 0, 'audio_tokens': 0, 'reasoning_tokens': 0, 'rejected_prediction_tokens': 0}, 'prompt_tokens_details': {'audio_tokens': 0, 'cached_tokens': 0}}, 'model_name': 'gpt-4o-2024-05-13', 'system_fingerprint': 'fp_65792305e4'}, 'run': None, 'type': 'LLMResult'}
    tracing_context.latest_run.parent_run  # RunTree | None
    tracing_context.latest_run.parent_run_id  # None
    tracing_context.latest_run.child_runs  # list[RunTree]

    tracing_context.latest_run.dotted_order  # UUID: '20250225T121820399433Z59455ae2-7867-44a4-8ad9-63b54b4de888'
    "The order of the run in the tree."

    assert True


def test_simpleembedding(llm, embedding):
    with context.tracing_v2_enabled(
        project_name=PROJECT_ID,
        example_id=EXAMPLE_UUID,
        tags=TAGS,
        client=None,
    ) as tracing_context:
        result = embedding.embed_query("hi")
    print(result)

    assert True


def test_knowledge_legal(legal_knowledge):
    with context.tracing_v2_enabled(
        project_name=PROJECT_ID,
        example_id=EXAMPLE_UUID,
        tags=TAGS,
        client=None,
    ) as tracing_context:
        result = legal_knowledge.similarity_search(
            "벌금형의 최대 한도는?",
            k=3,
            search_type="similarity",
        )
    print(result)

    assert result


def test_category(llm, categorizer):

    from langsmith import Client

    class LocalClient(Client): ...

    # client = Client(api_url="https://aip.sktai.io", api_key="x")

    with context.tracing_v2_enabled(
        project_name=PROJECT_ID,
        example_id=EXAMPLE_UUID,
        tags=TAGS,
        client=None,
    ) as tracing_context:
        result = categorizer.invoke({"query": "무릎이 아플 때는?"})
        print("finished")

    print(result)

    assert True


def test_phoenix_langchain(llm, categorizer):

    from phoenix.otel import register

    tracer_provider = register(
        endpoint="http://localhost:4317",  # gRPC
        project_name="my-llm-app",  # Default is 'default'
        verbose=False,
        auto_instrument=True,  # Auto-instrument your app based on installed OI dependencies
    )

    with context.tracing_v2_enabled(
        project_name=PROJECT_ID,
        example_id=EXAMPLE_UUID,
        tags=TAGS,
        # client=tracer_provider,
    ) as tracing_context:
        result = categorizer.invoke({"query": "무릎이 아플 때는?"})
        print("finished")

    print(result)

    assert True


def test_phoenix_langgraph(simple_graph):

    from phoenix.otel import register

    tracer_provider = register(
        endpoint="http://localhost:4317",  # gRPC
        project_name="myproject",  # Default is 'default'
        verbose=False,
        auto_instrument=True,  # Auto-instrument your app based on installed OI dependencies
    )

    with context.tracing_v2_enabled(
        project_name=PROJECT_ID,
        example_id=EXAMPLE_UUID,
        tags=TAGS,
        # client=tracer_provider,
    ) as tracing_context:
        result = simple_graph.invoke({"query": "흰색을 영어로 뭐라고 해?"})
        print("finished")

    print(result)

    assert True
