const directory = 'data-management/mainapp/domains/position_management/block';
const schemaPath = `${directory}/schema.py`;
const servicePath = `${directory}/service.py`;
const fields = `from typing import Literal
from pydantic import BaseModel, Field, model_validator

class BlockUpdateRequest(BaseModel):
    name: str = Field(min_length=1)
    block_type: Literal["text", "reference"]
    reference_id: int | None = Field(default=None, gt=0)
`;
const validSchema = fields + `
    @model_validator(mode="after")
    def validate_block_update_type_rules(self):
        if self.block_type == "reference" and self.reference_id is None:
            raise ValueError("reference blocks require reference_id")
        return self
`;
const detachedSchema = fields.replace(', model_validator', '') + `
def validate_block_update_type_rules(request: BlockUpdateRequest) -> None:
    if request.block_type == "reference" and request.reference_id is None:
        raise ValueError("reference blocks require reference_id")
`;
const service = `from .schema import BlockUpdateRequest
from .repository import BlockRecord

def update_block(payload: dict, stored: BlockRecord) -> dict:
    request = BlockUpdateRequest.model_validate(payload)
    return {"id": stored["id"], **request.model_dump()}

def preview_block(payload: dict) -> dict:
    return BlockUpdateRequest.model_validate(payload).model_dump()
`;
const archiveService = service.replace('    return {"id":', '    if stored["archived"]:\n        raise ValueError("archived blocks cannot be updated")\n    return {"id":');
const tests = `import pytest
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
`;
const archiveTests = tests + `
def test_archived_database_state_rejects_update():
    with pytest.raises(ValueError, match="archived"):
        update_block({"name": "alpha", "block_type": "text"}, {"id": 1, "archived": True})
`;
const api = `from .service import update_block, preview_block
from .repository import BlockRepository

def update_endpoint(payload: dict, block_id: int, repository: BlockRepository) -> dict:
    # The repository is a server-owned database adapter, not request input.
    return update_block(payload, repository.get(block_id))

def preview_endpoint(payload: dict) -> dict:
    return preview_block(payload)
`;
export function g04Fixture(name) {
  if (!['defect', 'fixed', 'unrelated'].includes(name)) throw Error('Unknown G04 case');
  const base = {
    [schemaPath]: name === 'fixed' ? detachedSchema : validSchema,
    [servicePath]: service,
    [`${directory}/api.py`]: api,
    [`${directory}/repository.py`]: 'from typing import Protocol, TypedDict\n\nclass BlockRecord(TypedDict):\n    id: int\n    archived: bool\n\nclass BlockRepository(Protocol):\n    def get(self, block_id: int) -> BlockRecord:\n        """Return an authorized existing database row; raise LookupError if absent."""\n        ...\n',
    'tests/test_block_update.py': name === 'unrelated' ? archiveTests : tests,
    'pyproject.toml': '[project]\nname = "g04-validation-fixture"\nversion = "0.0.0"\ndependencies = ["pydantic>=2,<3", "pytest>=8,<9"]\n\n[tool.pytest.ini_options]\npythonpath = ["data-management"]\n',
  };
  return { name, base, target: name === 'unrelated' ? servicePath : schemaPath,
    source: name === 'defect' ? detachedSchema : name === 'fixed' ? validSchema : archiveService };
}
