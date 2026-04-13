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
    simple_graph,
    simple_graph_with_span,
)


def test(load_env):
    llm_env, emb_env = load_env
    assert True


def test_simplechat(llm, embedding):
    result = llm.invoke("hi")
    print(result)

    assert True


def test_simpleembedding(llm, embedding):
    result = embedding.embed_query("hi")
    print(result)

    assert True


def test_knowledge_legal(legal_knowledge):
    result = legal_knowledge.similarity_search(
        "벌금형의 최대 한도는?",
        k=3,
        search_type="similarity",
    )
    print(result)

    assert result


def test_knowledge_medical(medical_knowledge):
    result = medical_knowledge.similarity_search(
        "무릎이 아플 때는?",
        k=3,
        search_type="similarity",
    )
    print(result)

    assert result


def test_knowledge_tax_federal(embedding, tax_federal_knowledge):
    # vector = embedding.embed_query("hi")
    # docs = tax_federal_knowledge._simple_search(
    #     vector, text_query="", k=3, filters=None
    # )
    result = tax_federal_knowledge.similarity_search(
        "상속세 인적공제 금액은?",
        k=3,
        search_type="similarity",
    )
    print(result)

    assert result


def test_knowledge_tax_regional(tax_regional_knowledge):
    result = tax_regional_knowledge.similarity_search(
        "재산세 납부기한은?",
        k=3,
        search_type="similarity",
    )
    print(result)

    assert result


def test_retriever(embedding, tax_regional_knowledge):
    retriever = tax_regional_knowledge.as_retriever()
    result = retriever.invoke("재산세 납부기한은?")
    print(result)

    assert result


def test_tool(tool_welcome_message):
    result = tool_welcome_message.invoke("hi")
    print(result)

    assert True


def test_functioncall(
    llm,
    tool_get_weather,
    tool_welcome_message,
    tool_add,
    tool_multiply,
):
    llm_with_tools = llm.bind_tools(
        [
            tool_get_weather,
            tool_welcome_message,
            tool_add,
            tool_multiply,
        ]
    )
    # result = llm.invoke("2 곱하기 5는?")
    # print(f"WITHOUT Tool: {result}")

    result = llm_with_tools.invoke("2 곱하기 5는?")
    print(result.tool_calls)

    assert True


def test_langserve(
    llm,
    tool_get_weather,
    tool_welcome_message,
    tool_add,
    tool_multiply,
):
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

    tool_list = [
        tool_get_weather,
        tool_welcome_message,
        tool_add,
        tool_multiply,
    ]

    llm_with_tools = llm.bind_tools(tool_list)
    # result = llm.invoke("2 곱하기 5는?")
    # print(f"WITHOUT Tool: {result}")

    # ── Chain 3: Categorizer ──────────────────────────────────────────────────────
    prompt_variable = [
        {"topic_classes": "의료", "topic_descriptions": "의료 관련 질문"},
        {"topic_classes": "법률", "topic_descriptions": "법률 관련 질문"},
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

    add_routes(app, llm, path="/chat")
    add_routes(app, llm_with_tools, path="/chat-with-tools")
    add_routes(app, categorizer_chain, path="/categorizer")
    add_routes(app, simple_graph, path="/graph")

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)


def test_serve_with_graph(simple_graph):
    from test.server.langserve import serve

    serve(simple_graph, path="/graph")
