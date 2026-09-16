import pytest
from pydantic import ValidationError
from mainapp.domains.position_management.block.service import update_block, preview_block

@pytest.mark.parametrize("extra", [{}, {"reference_id": None}])
def test_reference_requires_id_in_both_entrypoints(extra):
    payload = {"name": "alpha", "block_type": "reference", **extra}
    with pytest.raises(ValidationError):
        preview_block(payload)
    with pytest.raises(ValidationError):
        update_block(payload, {"id": 1, "archived": False})

@pytest.mark.parametrize("extra", [{}, {"reference_id": None}])
def test_text_allows_omitted_or_null_reference(extra):
    payload = {"name": "alpha", "block_type": "text", **extra}
    assert preview_block(payload)["reference_id"] is None

def test_reference_with_id_is_valid():
    payload = {"name": "alpha", "block_type": "reference", "reference_id": 7}
    assert update_block(payload, {"id": 1, "archived": False})["reference_id"] == 7
