from .service import update_block, preview_block
from .repository import BlockRepository

def update_endpoint(payload: dict, block_id: int, repository: BlockRepository) -> dict:
    # The repository is a server-owned database adapter, not request input.
    return update_block(payload, repository.get(block_id))

def preview_endpoint(payload: dict) -> dict:
    return preview_block(payload)
