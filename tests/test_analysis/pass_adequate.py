"""data loader client - API 기반"""

from __future__ import annotations
import httpx
from mainapp.core.config import agentstore_config


async def _fetch_paginated(endpoint: str) -> list[dict]:
    """페이지네이션으로 전체 데이터 조회"""
    all_data = []
    page = 1

    async with httpx.AsyncClient(
        base_url=agentstore_config.data_management_url, timeout=90
    ) as client:
        while True:
            response = await client.get(
                endpoint, params={"is_open": True, "size": 100, "page": page}
            )  # size = 100 (max)
            response.raise_for_status()

            data = response.json().get("data", [])
            if not data:
                break

            all_data.extend(data)
            page += 1

    return all_data


async def fetch_all_candidates() -> list[dict]:
    """전체 후보자 조회"""
    return await _fetch_paginated("/candidates")


async def fetch_all_positions() -> list[dict]:
    """전체 포지션 조회"""
    return await _fetch_paginated("/position")
