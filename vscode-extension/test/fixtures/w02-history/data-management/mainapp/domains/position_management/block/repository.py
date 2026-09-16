from typing import Protocol, TypedDict

class BlockRecord(TypedDict):
    id: int
    archived: bool

class BlockRepository(Protocol):
    def get(self, block_id: int) -> BlockRecord:
        """Return an authorized existing database row; raise LookupError if absent."""
        ...
