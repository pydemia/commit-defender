"""Install the commit-defender pre-commit hook into a target git repository."""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import sys
from pathlib import Path

TEMPLATE_PATH = Path(__file__).parent / "hook_template.sh"
DEFAULT_IMAGE = "commit-defender:latest"
ENV_FILE = Path.home() / ".commit-defender.env"

_ENV_TEMPLATE = """\
# commit-defender credentials
# This file is sourced by the pre-commit hook — keep it out of any git repo.
AZURE_OPENAI_API_KEY=your-api-key-here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-5.1
AZURE_OPENAI_API_VERSION=2024-08-01-preview
"""


def install(
    repo_path: Path,
    image: str = DEFAULT_IMAGE,
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
    hook_content = template.replace("{{IMAGE}}", image)
    hook_path.write_text(hook_content)

    # Make executable
    current = hook_path.stat().st_mode
    hook_path.chmod(current | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    print(f"commit-defender: hook installed at {hook_path}")
    print(f"  Image: {image}")
    _ensure_env_file()


def _ensure_env_file() -> None:
    """Create ~/.commit-defender.env with a template if it doesn't exist."""
    if ENV_FILE.exists():
        print(f"  Credentials file: {ENV_FILE} (already exists)")
    else:
        ENV_FILE.write_text(_ENV_TEMPLATE)
        ENV_FILE.chmod(0o600)  # owner read/write only
        print(f"  Credentials file created: {ENV_FILE}")
        print(f"  *** Edit it and fill in your Azure OpenAI credentials. ***")


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
    print(f"commit-defender: hook removed from {hook_path}")


def check_docker() -> bool:
    return shutil.which("docker") is not None


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="commit-defender",
        description="commit-defender pre-commit hook installer",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # install sub-command
    p_install = subparsers.add_parser("install", help="Install the pre-commit hook")
    p_install.add_argument(
        "repo",
        nargs="?",
        default=".",
        help="Path to the target git repository (default: current directory)",
    )
    p_install.add_argument(
        "--image",
        default=DEFAULT_IMAGE,
        help=f"Docker image to use (default: {DEFAULT_IMAGE})",
    )
    p_install.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing hook without prompting",
    )

    # uninstall sub-command
    p_uninstall = subparsers.add_parser("uninstall", help="Remove the pre-commit hook")
    p_uninstall.add_argument(
        "repo",
        nargs="?",
        default=".",
        help="Path to the target git repository (default: current directory)",
    )

    args = parser.parse_args()

    if not check_docker():
        print("Warning: docker not found on PATH. The hook requires Docker at commit time.", file=sys.stderr)

    repo_path = Path(args.repo).resolve()

    try:
        if args.command == "install":
            install(repo_path, image=args.image, force=args.force)
        elif args.command == "uninstall":
            uninstall(repo_path)
    except (ValueError, FileExistsError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
