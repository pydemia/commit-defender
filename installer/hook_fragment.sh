# BEGIN commit-defender
# commit-defender pre-commit hook
# To bypass (not recommended): git commit --no-verify
_cd_python="${COMMIT_DEFENDER_PYTHON:-{{PYTHON}}}"
_cd_staged="$(git diff --cached --name-only --diff-filter=ACMR)"

if [ -n "${_cd_staged}" ]; then
    if ! command -v "${_cd_python}" >/dev/null 2>&1; then
        echo "commit-defender: python not found at '${_cd_python}' — skipping." >&2
    else
        export CD_REPO_PATH="$(git rev-parse --show-toplevel)"
        export CD_STAGED_FILES="${_cd_staged}"
        if [ -z "${CD_API_KEY}" ]; then
            echo "commit-defender: CD_API_KEY not set — running linters only (AI review skipped)." >&2
            echo "  To enable AI review, set CD_AI_PROVIDER and CD_API_KEY in your shell profile." >&2
            export CD_SKIP_AI=1
        fi
        "${_cd_python}" -m commit_defender.app 1>&2 || exit $?
    fi
fi
# END commit-defender
