# Review History

Apply accumulated knowledge from past code reviews and merge-request feedback patterns.

## What to check
- **Recurring review patterns**: issues that appear repeatedly in this codebase's review history — the AI should surface these proactively rather than waiting for a reviewer to catch them again
- **Merge Request best practices**: overly large MRs that mix unrelated concerns; missing description or acceptance criteria; changes without corresponding test updates; breaking changes without migration notes
- **Reviewer feedback alignment**: code that structurally resembles patterns previously rejected in review (e.g. a certain anti-pattern the team has agreed to avoid)
- **Code review whitepaper principles**: single-responsibility principle at the PR level; incremental changesets; backward-compatible interfaces before breaking ones; clear rollback strategy for risky changes
- **Knowledge transfer**: non-obvious logic that lacks an explanation of *why*, not just *what*; decisions that future engineers will question without context
- **Definition of done**: feature work without updated docs, missing changelog entry, unreferenced migrations, skipped integration tests

## Tone
Frame findings in this category as team-awareness notes — "based on the review patterns in this project…" rather than direct commands. These are softer suggestions unless a pattern is a known blocker.
