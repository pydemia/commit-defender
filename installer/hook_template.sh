#!/usr/bin/env sh
# commit-defender pre-commit hook
# Installed by: commit-defender install
# To bypass (not recommended): git commit --no-verify

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
STAGED="$(git diff --cached --name-only --diff-filter=ACMR)"

[ -z "$STAGED" ] && exit 0

PYTHON="${COMMIT_DEFENDER_PYTHON:-{{PYTHON}}}"

if ! command -v "${PYTHON}" >/dev/null 2>&1; then
    echo "commit-defender: python not found at '${PYTHON}' — skipping." >&2
    exit 0
fi

export CD_REPO_PATH="${REPO_ROOT}"
export CD_STAGED_FILES="${STAGED}"

# If no AI credentials are configured, fall back to linter-only mode.
# Set CD_AI_PROVIDER + CD_API_KEY in your shell profile to enable AI review.
if [ -z "${CD_API_KEY}" ]; then
    echo "commit-defender: CD_API_KEY not set — running linters only (AI review skipped)." >&2
    echo "  To enable AI review, set CD_AI_PROVIDER and CD_API_KEY in your shell profile." >&2
    export CD_SKIP_AI=1
fi

"${PYTHON}" -m commit_defender.app 1>&2
exit $?
