from functools import wraps
from fastapi import FastAPI
from langserve import add_routes
import uvicorn


def serve(runnable, path="/agent", host="0.0.0.0", port=8000):

    # ── FastAPI app ───────────────────────────────────────────────────────────────
    app = FastAPI(
        title="LangServe API",
        description="LangChain / LangGraph chains served via LangServe",
        version="0.1.0",
    )

    add_routes(app, runnable, path=path)

    uvicorn.run(app, host=host, port=port)
