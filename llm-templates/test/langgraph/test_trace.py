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

from test.tracer_for_sdk import get_tracer, using_tracer, add_feedback
from openinference.instrumentation.helpers import get_span_id, get_trace_id
from openinference.semconv.trace import SpanAttributes

from uuid import uuid4

PROJECT_ID = "test_project"  # "default"
# EXAMPLE_UUID = "6fed3f77-d972-45b9-b3dd-cdc37b80de06"
EXAMPLE_UUID = "11111111-1111-1111-1111-111111111111"  # uuid4(), None
TAGS = ["tag1", "tag2"]  # None


def test_simplechat(llm, embedding):

    # tracer = get_tracer(
    #     project_name=PROJECT_ID,
    #     verbose=True,
    # )
    with using_tracer(
        project_name=PROJECT_ID,
        session_id="11",
        user_id="user1",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:
        result = llm.invoke("hi")

    assert result


def test_simplegraph(simple_graph):

    tracer = get_tracer(
        project_name=PROJECT_ID,
        verbose=True,
    )
    with using_tracer(
        tracer_provider=tracer,
        session_id="11",
        user_id="user1",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:
        result = simple_graph.invoke({"query": "흰색을 영어로 뭐라고 해?"})

    assert result


def test_simplegraph_with_session(simple_graph):

    tracer = get_tracer(
        project_name=PROJECT_ID,
        verbose=True,
    )
    with using_tracer(
        tracer_provider=tracer,
        session_id="12",
        user_id="user1",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:
        query_input1 = {"query": "흰색을 영어로 뭐라고 해?"}
        # tracing.set_input(query_input1)
        result1 = simple_graph.invoke(query_input1)
        # tracing.set_output(result1)
        # result1 = simple_graph.invoke({"query": "흰색을 영어로 뭐라고 해?"})

    assert result1

    with using_tracer(
        tracer_provider=tracer,
        session_id="12",
        user_id="user2",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:

        query_input2 = {"query": "다른 표현도 있어?"}
        # tracing.set_input(query_input2)
        result2 = simple_graph.invoke(query_input2)

        tracing.add_input(query_input2)
        tracing.add_output(result2)

    assert result2


def test_simplegraph_with_session_2(simple_graph):
    with using_tracer(
        project_name="test_project",
        session_id="12",
        user_id="user1",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:
        result1 = simple_graph.invoke({"query": "흰색을 프랑스어로 뭐라고 해?"})
        result2 = simple_graph.invoke({"query": "방금 너가 말한 단어들을 조합해 줘"})

        assert result1, result2

    with using_tracer(
        project_name="test_project",
        session_id="12",
        user_id="user1",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:
        query_input1 = {"query": "흰색을 프랑스어로 뭐라고 해?"}
        query_input2 = {"query": "방금 너가 말한 단어들을 조합해 줘"}
        result3 = simple_graph.invoke(query_input1)
        result4 = simple_graph.invoke(query_input2)

        tracing.add_input(query_input1)
        tracing.add_output(result4)

    assert result4


def test_get_trace_history():
    import phoenix as px
    from phoenix.trace.dsl import SpanQuery
    import datetime as dt

    # Initiate Phoenix client
    px_client = px.Client()

    # Get spans from the last 7 days only
    start_tm = dt.datetime.now() - dt.timedelta(days=7)

    # Get spans to exclude the last 24 hours
    end_tm = dt.datetime.now() - dt.timedelta(days=1)

    query = (
        SpanQuery()
        .where(
            # The filter condition is a string of valid Python boolean expression.
            # "span_kind == 'AGENT'",
            " and ".join(
                [
                    "span_kind == 'AGENT'",
                    "name == 'User Agent'",
                    "metadata['meta1'] == 'a'",
                ]
            )
        )
        .select(
            # "usage"
            # input="input.value",
        )
    )

    # The Phoenix Client can take this query and return the dataframe.
    traces = px_client.query_spans(
        query,
        project_name=PROJECT_ID,
        # start_time=start_tm,
        # end_time=end_tm,
        root_spans_only=True,
    )
    traces = px_client.query_spans(
        query,
        project_name=PROJECT_ID,
        # start_time=start_tm,
        # end_time=end_tm,
        root_spans_only=False,
    )
    print(traces.columns)

    assert traces is not None


def test_simplegraph_with_feedback(simple_graph):

    from opentelemetry.trace import format_span_id
    from openinference.instrumentation.langchain import (
        get_current_span,
        get_ancestor_spans,
    )

    from opentelemetry import trace

    tracer = get_tracer(
        project_name=PROJECT_ID,
        verbose=True,
    )
    with using_tracer(
        tracer_provider=tracer,
        session_id="13",
        user_id="user1",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:
        result1 = simple_graph.invoke({"query": "흰색을 영어로 뭐라고 해?"})

        tracing.add_feedback(
            feedback_name="user_feedback",
            type="thumbsup",
            thumbsup=True,
            explanation="Test Value",
            metadata={
                "meta1": "a",
                "mata2": "b",
            },
            headers={"testheader": "testvalue"},
        )

    with using_tracer(
        tracer_provider=tracer,
        session_id="13",
        user_id="user2",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        tags=[
            "app: tax",
            "profile=production",
        ],
    ) as tracing:

        query_input = {"query": "다른 표현도 있어?"}
        result2 = simple_graph.invoke(query_input)

        span_id = tracing.span_id

    add_feedback(
        span_id,
        feedback_name="user_feedback",
        type="thumbsup",
        thumbsup=False,
        explanation="Test Value",
        metadata={
            "meta1": "a",
            "mata2": "b",
        },
        headers={"testheader": "testvalue"},
    )

    assert result1, result2

    # from opentelemetry.sdk.trace import Span
    # from typing import List, Optional

    # def get_root_span(spans: List[Span], target_span: Span) -> Optional[Span]:
    #     current_span = target_span
    #     while current_span.parent:
    #         parent_span_id = current_span.parent.span_id
    #         parent_span = next(
    #             (span for span in spans if span.context.span_id == parent_span_id), None
    #         )
    #         if parent_span is None:
    #             break
    #         current_span = parent_span
    #     return current_span

    # active_span_processsor = tracer._active_span_processor
    # span_processors = active_span_processsor._span_processors
    # span_processor = span_processors[0]
    # span_exporter = span_processor.span_exporter
    # span_exporter._headers

    # from httpx import URL, _urlparse
    # span_exporter._endpoint
    # url = URL(span_exporter._endpoint)

    # finished_spans = span_exporter.get_finished_spans()
