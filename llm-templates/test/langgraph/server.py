"""
LangServe server exposing chains and graphs from test_langchain.py
Run: uvicorn test.langgraph.server:app --reload --port 8000
"""

import os
from typing import Annotated

from fastapi import FastAPI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langserve import add_routes
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from pydantic import BaseModel, Field
from typing_extensions import TypedDict

from settings import LLMSettings, EmbeddingSettings

# ── Azure Search field env vars ────────────────────────────────────────────────
os.environ["AZURESEARCH_FIELDS_ID"] = "chunk_id"
os.environ["AZURESEARCH_FIELDS_CONTENT"] = "content"
os.environ["AZURESEARCH_FIELDS_CONTENT_VECTOR"] = "content_dense_vector"
os.environ["AZURESEARCH_FIELDS_TAG"] = "metadata"

# ── Settings ───────────────────────────────────────────────────────────────────
llm_env = LLMSettings()
emb_env = EmbeddingSettings()

# ── Base components ────────────────────────────────────────────────────────────
llm = ChatOpenAI(
    base_url=llm_env.base_url,
    model=llm_env.model,
    api_key=llm_env.api_key,
)

embedding = OpenAIEmbeddings(
    base_url=emb_env.base_url,
    model=emb_env.model,
    api_key=emb_env.api_key,
)

# ── Tools ──────────────────────────────────────────────────────────────────────
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

# ── Chain 1: Simple chat ───────────────────────────────────────────────────────
simple_chat_chain = llm

# ── Chain 2: LLM with tools (function calling) ────────────────────────────────
llm_with_tools = llm.bind_tools(tool_list)

# ── Chain 3: Categorizer ──────────────────────────────────────────────────────
prompt_variable = [
    {"topic_classes": "의료", "topic_descriptions": "의료 관련 질문"},
    {"topic_classes": "법률", "topic_descriptions": "법률 관련 질문"},
]
intent_topic_descriptions = "".join(
    [f"{t['topic_classes']} : {t['topic_descriptions']} \n" for t in prompt_variable]
)
intent_topic_classes = ",".join([f"'{t['topic_classes']}'" for t in prompt_variable])
pv = dict(
    topic_classes=intent_topic_classes,
    topic_descriptions=intent_topic_descriptions,
)

prompt_str = """Given the user question below, classify it as either being about {topic_classes}
Additional information to help decision:
{topic_descriptions}
Do not respond with more than one word.
<question>
{query}
</question>
"""
categorizer_prompt = ChatPromptTemplate.from_template(prompt_str)

categorizer_chain = (
    RunnablePassthrough.assign(
        topic_classes=lambda x: pv["topic_classes"],
        topic_descriptions=lambda x: pv["topic_descriptions"],
    )
    | categorizer_prompt
    | llm
)

# ── Chain 4: Simple LangGraph ─────────────────────────────────────────────────
class State(TypedDict):
    query: str
    messages: Annotated[list, add_messages]


graph_builder = StateGraph(State)


def chatbot(state: State):
    message = llm.invoke(state["query"])
    assert len(message.tool_calls) <= 1
    return {"messages": [message]}


graph_builder.add_node("chatbot", chatbot)

tool_node = ToolNode(tools=tool_list)
graph_builder.add_node("tools", tool_node)

graph_builder.add_conditional_edges("chatbot", tools_condition)
graph_builder.add_edge("tools", "chatbot")
graph_builder.add_edge(START, "chatbot")

simple_graph = graph_builder.compile()

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="LangServe API",
    description="LangChain / LangGraph chains served via LangServe",
    version="0.1.0",
)

add_routes(app, simple_chat_chain, path="/chat")
add_routes(app, llm_with_tools, path="/chat-with-tools")
add_routes(app, categorizer_chain, path="/categorizer")
add_routes(app, simple_graph, path="/graph")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
