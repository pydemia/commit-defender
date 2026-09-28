from typing import Literal
from pydantic import BaseModel, Field

class BlockUpdateRequest(BaseModel):
    name: str = Field(min_length=1)
    block_type: Literal["text", "reference"]
    reference_id: int | None = Field(default=None, gt=0)

def validate_block_update_type_rules(request: BlockUpdateRequest) -> None:
    if request.block_type == "reference" and request.reference_id is None:
        raise ValueError("reference blocks require reference_id")
