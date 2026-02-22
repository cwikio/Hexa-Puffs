#!/usr/bin/env python3
"""
Claude Code PreToolUse hook: auto-generate CHANGELOG.md entries on git commit.

Intercepts `git commit -m "..."` commands before they execute.
Parses the commit message, determines affected packages from staged files,
and prepends a changelog entry under ## [Unreleased].
Then stages CHANGELOG.md so it's included in the same commit.

Skips: --amend, merge commits, non-commit bash commands.

Configured in .claude/settings.json as a PreToolUse hook with matcher "Bash".
"""
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Conventional commit prefix → Keep a Changelog section
PREFIX_MAP = {
    "feat": "Added",
    "fix": "Fixed",
    "refactor": "Changed",
    "docs": "Documentation",
    "perf": "Performance",
    "chore": "Maintenance",
    "ci": "Maintenance",
    "build": "Maintenance",
    "style": "Changed",
    "test": "Maintenance",
}
DEFAULT_SECTION = "Changed"

CHANGELOG_HEADER = """\
# Changelog

All notable changes to Hexa Puffs will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [1.0.0] - 2026-02-15

- Initial release
"""

# Root-level files/dirs that aren't packages
NON_PACKAGE_PATHS = {
    "_scripts", ".claude", "docs", ".git", ".github",
    "node_modules", ".vscode",
}


def parse_commit_command(command: str) -> str | None:
    """Extract commit message from a git commit command. Returns None if not a commit."""
    if not re.match(r"^git\s+commit\b", command):
        return None
    if "--amend" in command:
        return None
    if "--no-edit" in command:
        return None

    # Match -m with various quoting styles (HEREDOC, single, double quotes)
    # Claude Code often uses HEREDOC: git commit -m "$(cat <<'EOF'\nmessage\nEOF\n)"
    heredoc = re.search(r"<<'?EOF'?\s*\n(.+?)\n\s*EOF", command, re.DOTALL)
    if heredoc:
        # Extract just the first line (commit title) from HEREDOC messages
        full_msg = heredoc.group(1).strip()
        # Return first line only (the title), ignore Co-Authored-By etc.
        return full_msg.split("\n")[0].strip()

    # Standard -m "message" or -m 'message'
    match = re.search(r'''-m\s+["'](.+?)["']''', command, re.DOTALL)
    if match:
        return match.group(1).split("\n")[0].strip()

    # -m message (unquoted, single word — unlikely but handle it)
    match = re.search(r"-m\s+(\S+)", command)
    if match:
        return match.group(1)

    return None


def classify_message(message: str) -> tuple[str, str]:
    """Return (section, cleaned_message) from a commit message."""
    match = re.match(r"^(\w+)(?:\(.+?\))?:\s*(.+)", message)
    if match:
        prefix = match.group(1).lower()
        section = PREFIX_MAP.get(prefix, DEFAULT_SECTION)
        return section, match.group(2).strip()
    return DEFAULT_SECTION, message.strip()


def get_affected_packages(cwd: str) -> list[str]:
    """Determine which packages are affected from staged files."""
    try:
        result = subprocess.run(
            ["git", "diff", "--cached", "--name-only"],
            capture_output=True, text=True, cwd=cwd, timeout=5,
        )
        if result.returncode != 0:
            return []
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []

    packages = set()
    for filepath in result.stdout.strip().splitlines():
        if not filepath:
            continue
        # Exclude CHANGELOG.md itself to avoid self-referencing
        if filepath == "CHANGELOG.md":
            continue
        top_dir = filepath.split("/")[0]
        if "/" not in filepath:
            # Root-level file
            packages.add("core")
        elif top_dir in NON_PACKAGE_PATHS:
            packages.add("core")
        else:
            packages.add(top_dir)

    return sorted(packages)


def format_entry(packages: list[str], message: str) -> str:
    """Format a single changelog bullet point."""
    if packages and packages != ["core"]:
        pkg_label = ", ".join(packages)
        return f"- **{pkg_label}**: {message}"
    return f"- {message}"


def update_changelog(changelog_path: Path, section: str, entry: str, today: str) -> None:
    """Insert an entry into the changelog under ## [Unreleased] / ### Section."""
    if not changelog_path.exists():
        changelog_path.write_text(CHANGELOG_HEADER, encoding="utf-8")

    content = changelog_path.read_text(encoding="utf-8")

    # Parse the [Unreleased] block out of the full content
    unreleased_match = re.search(
        r"(## \[Unreleased\]\n)(.*?)(?=\n## \[|\Z)",
        content,
        re.DOTALL,
    )
    if not unreleased_match:
        # No [Unreleased] section — find where to insert one
        first_version = re.search(r"\n## \[", content)
        if first_version:
            pos = first_version.start()
            content = content[:pos] + "\n## [Unreleased]\n\n" + content[pos:]
        else:
            content = content.rstrip("\n") + "\n\n## [Unreleased]\n\n"
        unreleased_match = re.search(
            r"(## \[Unreleased\]\n)(.*?)(?=\n## \[|\Z)",
            content,
            re.DOTALL,
        )

    unreleased_heading = unreleased_match.group(1)
    unreleased_body = unreleased_match.group(2)

    # Parse existing subsections within [Unreleased]
    # Each subsection: ### Name\n- entry\n- entry\n
    subsections: dict[str, list[str]] = {}
    current_sub = None
    for line in unreleased_body.splitlines():
        heading_match = re.match(r"^### (.+)", line)
        if heading_match:
            current_sub = heading_match.group(1)
            if current_sub not in subsections:
                subsections[current_sub] = []
        elif line.startswith("- ") and current_sub:
            subsections[current_sub].append(line)

    # Add the new entry
    if section not in subsections:
        subsections[section] = []
    subsections[section].insert(0, entry)  # newest first

    # Rebuild the [Unreleased] block with consistent formatting
    # Order subsections by conventional changelog order
    section_order = [
        "Added", "Changed", "Fixed", "Removed",
        "Documentation", "Performance", "Maintenance",
    ]
    ordered_sections = []
    for s in section_order:
        if s in subsections:
            ordered_sections.append(s)
    for s in subsections:
        if s not in ordered_sections:
            ordered_sections.append(s)

    new_body_parts = []
    for s in ordered_sections:
        new_body_parts.append(f"### {s}")
        for e in subsections[s]:
            new_body_parts.append(e)
        new_body_parts.append("")  # blank line after each subsection

    new_unreleased = unreleased_heading + "\n" + "\n".join(new_body_parts)

    # Replace the old [Unreleased] block in the full content
    before = content[: unreleased_match.start()]
    after = content[unreleased_match.end() :]

    # Ensure a blank line before the next ## heading
    if after and not after.startswith("\n"):
        after = "\n" + after

    changelog_path.write_text(before + new_unreleased + after, encoding="utf-8")


def stage_changelog(cwd: str, changelog_path: Path) -> None:
    """Stage CHANGELOG.md so it's included in the commit."""
    try:
        subprocess.run(
            ["git", "add", str(changelog_path)],
            capture_output=True, cwd=cwd, timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass


def main() -> None:
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name != "Bash":
        sys.exit(0)

    command = hook_input.get("tool_input", {}).get("command", "")
    commit_message = parse_commit_command(command)
    if commit_message is None:
        sys.exit(0)

    cwd = hook_input.get("cwd", "")
    if not cwd:
        sys.exit(0)

    section, cleaned_message = classify_message(commit_message)
    packages = get_affected_packages(cwd)
    entry = format_entry(packages, cleaned_message)
    today = datetime.now().strftime("%Y-%m-%d")

    # Find the repo root (where CHANGELOG.md should live)
    repo_root = Path(cwd)
    while repo_root != repo_root.parent:
        if (repo_root / ".git").exists():
            break
        repo_root = repo_root.parent
    else:
        sys.exit(0)

    changelog_path = repo_root / "CHANGELOG.md"
    update_changelog(changelog_path, section, entry, today)
    stage_changelog(cwd, changelog_path)

    # Exit 0 — allow the commit to proceed
    sys.exit(0)


if __name__ == "__main__":
    main()
