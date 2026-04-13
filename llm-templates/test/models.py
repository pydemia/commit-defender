import pytest
from enum import Enum
from settings import (
    LLMSettings,
    EmbeddingSettings,
    KnowledgeSettings,
    MedicalKnowledgeSettings,
    LegalKnowledgeSettings,
    TaxFederalKnowledgeSettings,
    TaxRegionalKnowledgeSettings,
)

from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

import os

os.environ["AZURESEARCH_FIELDS_ID"] = "chunk_id"
os.environ["AZURESEARCH_FIELDS_CONTENT"] = "content"
os.environ["AZURESEARCH_FIELDS_CONTENT_VECTOR"] = (
    "content_dense_vector"  # "content_vector"
)
os.environ["AZURESEARCH_FIELDS_TAG"] = "metadata"

from langchain_community.vectorstores.azuresearch import AzureSearch
from azure.search.documents.indexes.models import (
    ScoringProfile,
    SimpleField,
    SearchField,
    SearchFieldDataType,
)

from langchain_core.tools import tool

# class Field(Enum):
#     ID = "id"
#     CONTENT = "content"
#     CONTENT_DENSE_VECTOR = "content_dense_vector"
#     CONTENT_SPARSE_VECTOR = "content_sparse_vector"
#     METADATA = "metadata"
#     FILE_ID = "file_id"
#     CHUNK_ID = "chunk_id"
#     CHUNK_SEQUENCE = "chunk_sequence"
#     IS_FILE_ENABLED = "is_file_enabled"
#     IS_CHUNK_ENABLED = "is_chunk_enabled"
#     PARTITION_KEY = "partition_key"


# embedding_dimensions = 3072
# ANALYZER_NAME = "ko.microsoft"

# fields = {
#     Field.ID.value: SimpleField(
#         name=Field.ID.value,
#         type=SearchFieldDataType.String,
#         key=True,
#         sortable=False,
#         facetable=False,
#     ),
#     Field.CONTENT.value: SearchField(
#         name=Field.CONTENT.value,
#         type=SearchFieldDataType.String,
#         retrievable=True,
#         searchable=True,
#         filterable=False,
#         sortable=False,
#         facetable=False,
#         analyzer_name=ANALYZER_NAME,
#     ),
#     Field.CONTENT_DENSE_VECTOR: SearchField(  # f"{Field.CONTENT_DENSE_VECTOR.value}_{self.embedding_dimensions}"
#         name=Field.CONTENT_DENSE_VECTOR,
#         # name=vector_field_name,
#         type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
#         filterable=False,
#         sortable=False,
#         facetable=False,
#         vector_search_dimensions=embedding_dimensions,
#         vector_search_profile_name="default-hnsw-profile",  # vector_search_config[USE_PROFILE],
#     ),
#     # self.generate_schema_vector_field(embedding_dimensions, vector_field_name, vector_search_config),
#     Field.METADATA.value: SearchField(
#         name=Field.METADATA.value,
#         type=SearchFieldDataType.String,
#         retrievable=True,
#         searchable=False,
#         filterable=False,
#         facetable=False,
#         sortable=False,
#     ),
#     Field.FILE_ID.value: SearchField(
#         name=Field.FILE_ID.value,
#         type=SearchFieldDataType.String,
#         retrievable=False,
#         searchable=True,
#         sortable=False,
#         filterable=True,
#         facetable=True,
#     ),
#     Field.CHUNK_ID.value: SearchField(
#         name=Field.CHUNK_ID.value,
#         type=SearchFieldDataType.String,
#         retrievable=False,
#         searchable=True,
#         sortable=False,
#         filterable=True,
#         facetable=False,
#     ),
#     Field.CHUNK_SEQUENCE.value: SearchField(
#         name=Field.CHUNK_SEQUENCE.value,
#         type=SearchFieldDataType.Int64,
#         retrievable=True,
#         searchable=False,
#         sortable=True,
#         filterable=True,
#         facetable=False,
#     ),
#     Field.IS_FILE_ENABLED.value: SearchField(
#         name=Field.IS_FILE_ENABLED.value,
#         type=SearchFieldDataType.Boolean,
#         retrievable=True,
#         searchable=False,
#         sortable=True,
#         filterable=True,
#         facetable=True,
#     ),
#     Field.IS_CHUNK_ENABLED.value: SearchField(
#         name=Field.IS_CHUNK_ENABLED.value,
#         type=SearchFieldDataType.Boolean,
#         retrievable=True,
#         searchable=False,
#         sortable=True,
#         filterable=True,
#         facetable=True,
#     ),
# }

# retrieval_options = {
#     "doc_format_metafields": None,
#     "top_k": 5,
#     "threshold": 0.7,
#     "vector_field": "content_vector",
# }


@pytest.fixture
def load_env():
    # code to tear down test environment
    llm_env = LLMSettings()
    emb_env = EmbeddingSettings()
    knw_env = KnowledgeSettings()

    return llm_env, emb_env, knw_env


@pytest.fixture
def llm(load_env):
    llm_env: LLMSettings
    llm_env, _, _ = load_env

    llm = ChatOpenAI(
        base_url=llm_env.base_url,
        model=llm_env.model,
        api_key=llm_env.api_key,
    )

    return llm


@pytest.fixture
def embedding(load_env):
    emb_env: EmbeddingSettings
    _, emb_env, _ = load_env

    emb = OpenAIEmbeddings(
        base_url=emb_env.base_url,
        model=emb_env.model,
        api_key=emb_env.api_key,
    )

    return emb


@pytest.fixture
def knowledge(load_env, embedding):
    knw_env: KnowledgeSettings
    _, _, knw_env = load_env
    knw = AzureSearch(
        azure_search_endpoint=knw_env.endpoint,
        azure_search_key=knw_env.key,
        index_name=knw_env.index_name,
        embedding_function=embedding,
    )

    return knw


@pytest.fixture
def medical_knowledge(load_env, embedding):
    knw_env: MedicalKnowledgeSettings
    _, _, knw_env = load_env
    knw = AzureSearch(
        azure_search_endpoint=knw_env.endpoint,
        azure_search_key=knw_env.key,
        index_name=knw_env.index_name,
        embedding_function=embedding,
        # fields=fields,
    )

    return knw


@pytest.fixture
def legal_knowledge(load_env, embedding):
    knw_env: LegalKnowledgeSettings
    _, _, knw_env = load_env
    knw = AzureSearch(
        azure_search_endpoint=knw_env.endpoint,
        azure_search_key=knw_env.key,
        index_name=knw_env.index_name,
        embedding_function=embedding,
        # fields=fields,
    )

    return knw


@pytest.fixture
def tax_federal_knowledge(load_env, embedding):
    knw_env: TaxFederalKnowledgeSettings
    _, _, knw_env = load_env
    knw = AzureSearch(
        azure_search_endpoint=knw_env.endpoint,
        azure_search_key=knw_env.key,
        index_name=knw_env.index_name,
        embedding_function=embedding,
    )

    return knw


@pytest.fixture
def tax_regional_knowledge(load_env, embedding):
    knw_env: TaxRegionalKnowledgeSettings
    _, _, knw_env = load_env
    knw = AzureSearch(
        azure_search_endpoint=knw_env.endpoint,
        azure_search_key=knw_env.key,
        index_name=knw_env.index_name,
        # index_name=knw_env.repo_id,
        embedding_function=embedding,
        # fields=fields,
    )

    return knw


@tool
def get_weather(location: str):
    """Call to get the current weather."""
    if location in ["서울", "인천"]:
        return "현재 기온은 20도이고 구름이 많아."
    else:
        return "현재 기온은 30도이며 맑아"


@tool
def welcome(query: str):
    """Use this string when say hello"""
    return f"{query} (*＾▽＾)／"


@tool
def add(a: float, b: float):
    """Add two number"""
    return str(float(a) + float(b))


@tool
def multiply(a: float, b: float):
    """Multiply two number"""
    return str(float(a) * float(b))


tool_list = [get_weather, welcome, add, multiply]


@pytest.fixture
def tool_get_weather():
    return get_weather


@pytest.fixture
def tool_welcome_message():
    return welcome


@pytest.fixture
def tool_add():
    return add


@pytest.fixture
def tool_multiply():
    return multiply


@pytest.fixture
def tools():
    return [tool_list]


@pytest.fixture
def llm_with_tools(load_env):
    llm_env: LLMSettings
    llm_env, _, _ = load_env

    llm = ChatOpenAI(
        base_url=llm_env.base_url,
        model=llm_env.model,
        api_key=llm_env.api_key,
    )
    llm = llm.bind_tools(tool_list)

    return llm


@pytest.fixture
def categorizer(load_env):

    llm_env: LLMSettings
    llm_env, _, _ = load_env

    llm = ChatOpenAI(
        base_url=llm_env.base_url,
        model=llm_env.model,
        api_key=llm_env.api_key,
    )

    from langchain_core.runnables import (
        RunnableLambda,
        RunnablePassthrough,
        RunnableSerializable,
    )

    context_from_retriever = RunnablePassthrough.assign(
        context=lambda x: x.get("context", "")
    )
    # prompt_variable = self.categories_to_str(self.categories)
    prompt_variable = [
        {
            "topic_classes": "의료",
            "topic_descriptions": "의료 관련 질문",
        },
        {
            "topic_classes": "법률",
            "topic_descriptions": "법률 관련 질문",
        },
    ]
    intent_topic_descriptions = "".join(
        [
            f"{t['topic_classes']} : {t['topic_descriptions']} \n"
            for t in prompt_variable
        ]
    )
    intent_topic_classes = ",".join(
        [f"'{t['topic_classes']}'" for t in prompt_variable]
    )

    prompt_variable = dict(
        topic_classes=intent_topic_classes,
        topic_descriptions=intent_topic_descriptions,
    )

    from langchain_core.prompts import ChatPromptTemplate

    #     prompt_str = """Given the user question below, classify it     as either being about \{\{topic_classes\}\}
    # Additional information to help decision:
    # \{\{topic_descriptions\}\}
    # Do not respond with more than one word.
    # <question>
    # \{\{query\}\}
    # </question>
    # """
    prompt_str = """Given the user question below, classify it     as either being about {topic_classes}
Additional information to help decision:
{topic_descriptions}
Do not respond with more than one word.
<question>
{query}
</question>
"""
    prompt = ChatPromptTemplate.from_template(prompt_str)

    class CategoryPromptVariable(BaseModel):
        topic_classes: str
        topic_descriptions: str

    class CategoryResponse(BaseModel):
        query: str = Field(description="User question")
        selected: str = Field(description="Selected category")

    chain = (
        RunnablePassthrough.assign(
            topic_classes=lambda x: prompt_variable["topic_classes"],
            topic_descriptions=lambda x: prompt_variable["topic_descriptions"],
        )
        # | context_from_retriever
        | prompt
        # | llm.with_structured_output(CategoryResponse)
        | llm
        # | RunnableLambda(
        #     lambda x: x.convert_to_result(self.input_key[0], self.output_key)
        # )
        # | StrOutputParser()
    )
    return chain


@pytest.fixture
def simple_graph(load_env):

    llm_env: LLMSettings
    llm_env, _, _ = load_env

    llm = ChatOpenAI(
        base_url=llm_env.base_url,
        model=llm_env.model,
        api_key=llm_env.api_key,
    )

    from typing import Annotated

    from langchain_anthropic import ChatAnthropic
    from langchain_community.tools.tavily_search import TavilySearchResults
    from langchain_core.tools import tool
    from typing_extensions import TypedDict

    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import StateGraph, START, END
    from langgraph.graph.message import add_messages
    from langgraph.prebuilt import ToolNode, tools_condition

    from langgraph.types import Command, interrupt

    class State(TypedDict):
        query: str
        messages: Annotated[list, add_messages]

    graph_builder = StateGraph(State)

    # @tool
    # def human_assistance(query: str) -> str:
    #     """Request assistance from a human."""
    #     human_response = interrupt({"query": query})
    #     return human_response["data"]

    def chatbot(state: State):
        message = llm.invoke(state["query"])
        # Because we will be interrupting during tool execution,
        # we disable parallel tool calling to avoid repeating any
        # tool invocations when we resume.
        assert len(message.tool_calls) <= 1
        return {"messages": [message]}

    graph_builder.add_node("chatbot", chatbot)

    tool_node = ToolNode(tools=tool_list)
    graph_builder.add_node("tools", tool_node)

    graph_builder.add_conditional_edges(
        "chatbot",
        tools_condition,
    )
    graph_builder.add_edge("tools", "chatbot")
    graph_builder.add_edge(START, "chatbot")

    graph = graph_builder.compile()

    return graph


@pytest.fixture
def simple_graph_with_span(load_env):

    llm_env: LLMSettings
    llm_env, _, _ = load_env

    llm = ChatOpenAI(
        base_url=llm_env.base_url,
        model=llm_env.model,
        api_key=llm_env.api_key,
    )

    from typing import Annotated

    from langchain_anthropic import ChatAnthropic
    from langchain_community.tools.tavily_search import TavilySearchResults
    from langchain_core.tools import tool
    from typing_extensions import TypedDict

    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.graph import StateGraph, START, END
    from langgraph.graph.message import add_messages
    from langgraph.prebuilt import ToolNode, tools_condition

    from langgraph.types import Command, interrupt

    from test.tracer_for_sdk import get_langchain_span_id

    class State(TypedDict):
        query: str
        messages: Annotated[list, add_messages]

    graph_builder = StateGraph(State)

    # @tool
    # def human_assistance(query: str) -> str:
    #     """Request assistance from a human."""
    #     human_response = interrupt({"query": query})
    #     return human_response["data"]

    def chatbot(state: State):
        message = llm.invoke(state["query"])
        # Because we will be interrupting during tool execution,
        # we disable parallel tool calling to avoid repeating any
        # tool invocations when we resume.
        assert len(message.tool_calls) <= 1
        return {"messages": [message]}

    graph_builder.add_node("chatbot", chatbot)

    tool_node = ToolNode(tools=tool_list)
    graph_builder.add_node("tools", tool_node)

    graph_builder.add_conditional_edges(
        "chatbot",
        tools_condition,
    )
    graph_builder.add_edge("tools", "chatbot")
    graph_builder.add_edge(START, "chatbot")

    graph = graph_builder.compile()

    return graph
