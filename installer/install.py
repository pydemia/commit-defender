"""Install or remove the commit-defender pre-commit hook."""

from __future__ import annotations

import shutil
import stat
import sys
from pathlib import Path

FRAGMENT_PATH = Path(__file__).parent / "hook_fragment.sh"
DEFAULT_PYTHON = "python3"

MARKER_BEGIN = "# BEGIN commit-defender"
MARKER_END = "# END commit-defender"


def _make_fragment(python: str) -> str:
    return FRAGMENT_PATH.read_text().replace("{{PYTHON}}", python)


def _has_markers(content: str) -> bool:
    return MARKER_BEGIN in content and MARKER_END in content


def _strip_fragment(content: str) -> str:
    """Remove the commit-defender marker block, return remaining content."""
    lines = content.splitlines(keepends=True)
    result = []
    inside = False
    for line in lines:
        stripped = line.strip()
        if stripped == MARKER_BEGIN:
            inside = True
            # Also drop a preceding blank line that was added as a separator
            if result and result[-1].strip() == "":
                result.pop()
            continue
        if stripped == MARKER_END:
            inside = False
            continue
        if not inside:
            result.append(line)
    return "".join(result).rstrip("\n") + "\n"


def _is_empty_hook(content: str) -> bool:
    """True if the hook contains nothing meaningful beyond a shebang/comments."""
    return all(
        not line.strip() or line.strip().startswith("#")
        for line in content.splitlines()
    )


def install(
    repo_path: Path,
    python: str = DEFAULT_PYTHON,
    force: bool = False,
) -> None:
    """Merge the commit-defender hook into repo_path/.git/hooks/pre-commit."""
    git_dir = repo_path / ".git"
    if not git_dir.exists():
        raise ValueError(f"Not a git repository: {repo_path}")

    hooks_dir = git_dir / "hooks"
    hooks_dir.mkdir(exist_ok=True)

    hook_path = hooks_dir / "pre-commit"
    fragment = _make_fragment(python)

    if not hook_path.exists():
        # Fresh install: create the file with a shebang and the marker block.
        hook_path.write_text(f"#!/usr/bin/env sh\n\n{fragment}\n")
        action = "installed"
    else:
        existing = hook_path.read_text()
        if _has_markers(existing):
            # Idempotent reinstall: replace the existing marker block.
            base = _strip_fragment(existing).rstrip("\n")
            hook_path.write_text(f"{base}\n\n{fragment}\n")
            action = "updated"
        else:
            # Existing foreign hook: append our block as a new section.
            base = existing.rstrip("\n")
            hook_path.write_text(f"{base}\n\n{fragment}\n")
            action = "merged into existing hook"

    mode = hook_path.stat().st_mode
    hook_path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    print(f"✓ Hook {action} at {hook_path}")
    print(f"  Python: {python}")
    print()
    print("Next: export these credentials in ~/.zshenv (or ~/.profile):")
    print()
    print("  export CD_AI_PROVIDER=aoai   # or: anthropic | openai | gemini")
    print("  export CD_API_KEY=your-api-key")
    print("  export CD_MODEL=your-deployment-name")
    print("  export CD_ENDPOINT=https://YOUR.openai.azure.com  # Azure only")
    print()
    print("Then reload your shell:  source ~/.zshenv")


def uninstall(repo_path: Path) -> None:
    """Remove the commit-defender section from the pre-commit hook."""
    hook_path = repo_path / ".git" / "hooks" / "pre-commit"
    if not hook_path.exists():
        print(f"commit-defender: no hook found at {hook_path}")
        return

    content = hook_path.read_text()
    if not _has_markers(content):
        print(f"commit-defender: hook at {hook_path} has no commit-defender section — nothing to remove.")
        return

    remaining = _strip_fragment(content)
    if _is_empty_hook(remaining):
        hook_path.unlink()
        print(f"✓ Hook removed from {hook_path}")
    else:
        hook_path.write_text(remaining)
        print(f"✓ commit-defender section removed from {hook_path}")
        print(f"  Existing hook content preserved at {hook_path}")


def main(argv: list[str] | None = None) -> None:
    import argparse

    parser = argparse.ArgumentParser(
        prog="commit-defender",
        description="commit-defender hook installer",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_install = subparsers.add_parser("install", help="Install the pre-commit hook into a git repo")
    p_install.add_argument("repo", nargs="?", default=".", help="Target git repository (default: .)")
    p_install.add_argument("--python", default=DEFAULT_PYTHON,
                           help=f"Python executable with commit-defender installed (default: {DEFAULT_PYTHON})")
    p_install.add_argument("--force", action="store_true", help="Replace existing hook (legacy flag, kept for compatibility)")

    p_uninstall = subparsers.add_parser("uninstall", help="Remove the pre-commit hook")
    p_uninstall.add_argument("repo", nargs="?", default=".", help="Target git repository (default: .)")

    args = parser.parse_args(argv)
    repo_path = Path(args.repo).resolve()

    if args.command == "install":
        python = args.python
        if not shutil.which(python):
            print(f"Warning: '{python}' not found on PATH.", file=sys.stderr)
        try:
            install(repo_path, python=python)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "uninstall":
        try:
            uninstall(repo_path)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
