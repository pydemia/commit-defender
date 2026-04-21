"""Install or remove the commit-defender pre-commit hook."""

from __future__ import annotations

import shutil
import stat
import sys
from pathlib import Path

TEMPLATE_PATH = Path(__file__).parent / "hook_template.sh"
DEFAULT_PYTHON = "python3"


def install(
    repo_path: Path,
    python: str = DEFAULT_PYTHON,
    force: bool = False,
) -> None:
    """Write the pre-commit hook into repo_path/.git/hooks/pre-commit."""
    git_dir = repo_path / ".git"
    if not git_dir.exists():
        raise ValueError(f"Not a git repository: {repo_path}")

    hooks_dir = git_dir / "hooks"
    hooks_dir.mkdir(exist_ok=True)

    hook_path = hooks_dir / "pre-commit"

    if hook_path.exists() and not force:
        existing = hook_path.read_text()
        if "commit-defender" not in existing:
            raise FileExistsError(
                f"A pre-commit hook already exists at {hook_path}.\n"
                "Use --force to overwrite, or manually merge the hooks."
            )

    template = TEMPLATE_PATH.read_text()
    hook_content = template.replace("{{PYTHON}}", python)
    hook_path.write_text(hook_content)

    mode = hook_path.stat().st_mode
    hook_path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    print(f"✓ Hook installed at {hook_path}")
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
    """Remove the commit-defender hook from a repository."""
    hook_path = repo_path / ".git" / "hooks" / "pre-commit"
    if not hook_path.exists():
        print(f"commit-defender: no hook found at {hook_path}")
        return

    content = hook_path.read_text()
    if "commit-defender" not in content:
        print(f"commit-defender: hook at {hook_path} was not installed by commit-defender — not removing.")
        return

    hook_path.unlink()
    print(f"✓ Hook removed from {hook_path}")


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
    p_install.add_argument("--force", action="store_true", help="Overwrite existing hook")

    p_uninstall = subparsers.add_parser("uninstall", help="Remove the pre-commit hook")
    p_uninstall.add_argument("repo", nargs="?", default=".", help="Target git repository (default: .)")

    args = parser.parse_args(argv)
    repo_path = Path(args.repo).resolve()

    if args.command == "install":
        python = args.python
        if not shutil.which(python):
            print(f"Warning: '{python}' not found on PATH.", file=sys.stderr)
        try:
            install(repo_path, python=python, force=args.force)
        except (ValueError, FileExistsError) as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "uninstall":
        try:
            uninstall(repo_path)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
