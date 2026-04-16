# Correctness

Review the code for logic errors and runtime failures that could produce wrong results or crashes.

## What to check
- **Test coverage**: untested branches, missing edge-case tests, assertions that never fail
- **Type safety**: type mismatches, unsafe casts, missing type annotations on public APIs
- **Null / undefined / None safety**: dereferencing without guards, implicit falsy checks on non-boolean values, missing null checks before method calls
- **Empty-string and zero handling**: functions that silently accept empty input and produce misleading output
- **Off-by-one errors**: fence-post mistakes in loops, slice indices, pagination offsets
- **Syntax and semantic validity**: unreachable code, dead branches, incorrect operator precedence, wrong loop variable scoping
- **Data integrity**: incorrect default values, mutable defaults (e.g. Python `def f(x=[]):`), shared state mutation
- **Error propagation**: swallowed exceptions, ignored return codes, missing error handling paths

## Tone
Flag correctness issues as **must-fix** when they can produce silent wrong answers or crashes in production. Flag coverage and type gaps as suggestions unless the gap is obviously dangerous.
