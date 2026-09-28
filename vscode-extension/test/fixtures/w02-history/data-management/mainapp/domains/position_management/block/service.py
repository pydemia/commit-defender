from .schema import BlockUpdateRequest
from .repository import BlockRecord

def update_block(payload: dict, stored: BlockRecord) -> dict:
    request = BlockUpdateRequest.model_validate(payload)
    return {"id": stored["id"], **request.model_dump()}

def preview_block(payload: dict) -> dict:
    return BlockUpdateRequest.model_validate(payload).model_dump()
