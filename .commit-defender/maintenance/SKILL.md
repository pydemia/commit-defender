# Maintenance

Review the code for readability, consistency, and long-term maintainability.

## What to check
- **Readability**: overly complex expressions, deeply nested logic, functions that do too many things, magic numbers without named constants
- **Naming**: variables, functions, and classes that don't clearly convey intent; inconsistent naming style within the same module
- **Code conventions**: inconsistent formatting, line length, import ordering, spacing; deviations from the project's stated style guide
- **Linting rules**: violations of the active linter configuration (ruff, eslint, etc.); do not repeat individual lint messages — synthesize patterns
- **Comments and documentation**: missing docstrings on public APIs, outdated comments that contradict the code, commented-out dead code left behind
- **Structure and organisation**: logic in the wrong layer (e.g. DB calls in a view), circular imports, God objects/modules, feature envy
- **Consistency**: different patterns for the same operation across the codebase, copy-pasted code that should be a shared helper
- **Refactoring opportunities**: code that would be significantly clearer with a small restructure — but only flag if the gain is substantial

## Tone
Raise maintenance issues as suggestions unless a violation is so egregious it will actively mislead the next engineer. Avoid nitpicking trivial style details covered by the active linter.
