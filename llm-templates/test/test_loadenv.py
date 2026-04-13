import pytest


def test_load_env():
    from settings import LLMSettings, EmbeddingSettings

    llm_env = LLMSettings()
    emb_env = EmbeddingSettings()
    assert True
