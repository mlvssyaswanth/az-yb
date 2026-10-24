#!/usr/bin/env python3
"""PreToolUse hook: block writes to source files that have no test yet.

Applies to Write, Edit and MultiEdit on:
  backend/app/**/*.py       needs backend/tests/test_<module>.py, or a test that imports the module
  frontend/src/**/*.ts(x)   needs <module>.test.ts(x) beside it, or a test that imports the module

A test file can also claim a module with a comment such as `# covers: forecasts` (Python)
or `// covers: KpiStrip` (TypeScript), for code exercised only through a higher-level test.

Test files, migrations, shadcn components (components/ui), *.d.ts, main.tsx and
__init__.py are exempt, as is everything outside those two trees. Exit code 2 blocks
the call and sends the message on stderr back to Claude.
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.environ.get("CLAUDE_PROJECT_DIR", ".")).resolve()
BACKEND_APP = ROOT / "backend" / "app"
BACKEND_TESTS = ROOT / "backend" / "tests"
FRONTEND_SRC = ROOT / "frontend" / "src"
FRONTEND_EXEMPT = {"main.tsx"}


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def imports_module(test_file: Path, stem: str, import_line: re.Pattern[str]) -> bool:
    word = re.compile(rf"\b{re.escape(stem)}\b")
    return any(import_line.match(line) and word.search(line) for line in read(test_file).splitlines())


def claims(test_files: list[Path], stem: str) -> bool:
    marker = re.compile(rf"(#|//)\s*covers:.*\b{re.escape(stem)}\b")
    return any(marker.search(read(t)) for t in test_files)


def backend_has_test(path: Path) -> bool:
    stem = path.stem
    if (BACKEND_TESTS / f"test_{stem}.py").exists():
        return True
    import_line = re.compile(r"\s*(from|import)\s+app\b")
    tests = list(BACKEND_TESTS.glob("test_*.py"))
    return any(imports_module(t, stem, import_line) for t in tests) or claims(tests, stem)


def frontend_has_test(path: Path) -> bool:
    stem = path.stem
    if any((path.parent / f"{stem}.test{ext}").exists() for ext in (".ts", ".tsx")):
        return True
    import_line = re.compile(r"\s*(import|\}?\s*from)\b")
    tests = [*FRONTEND_SRC.rglob("*.test.ts"), *FRONTEND_SRC.rglob("*.test.tsx")]
    return any(imports_module(t, stem, import_line) for t in tests) or claims(tests, stem)


def check(path: Path) -> str | None:
    """Return a block message, or None to allow."""
    if path.is_relative_to(BACKEND_APP) and path.suffix == ".py" and path.name != "__init__.py":
        if not backend_has_test(path):
            rel = path.relative_to(ROOT)
            return f"No test covers {rel}. Write backend/tests/test_{path.stem}.py first (a failing test is fine), then retry."
    elif path.is_relative_to(FRONTEND_SRC) and path.suffix in (".ts", ".tsx"):
        rel_parts = path.relative_to(FRONTEND_SRC).parts
        name = path.name
        exempt = (
            ".test." in name
            or name.endswith(".d.ts")
            or name in FRONTEND_EXEMPT
            or rel_parts[0] == "test"
            or rel_parts[:2] == ("components", "ui")
        )
        if not exempt and not frontend_has_test(path):
            rel = path.relative_to(ROOT)
            return f"No test covers {rel}. Write {path.with_suffix('').name}.test{path.suffix} beside it first, then retry."
    return None


def main() -> int:
    try:
        event = json.load(sys.stdin)
        file_path = event["tool_input"]["file_path"]
    except (ValueError, KeyError, TypeError):
        return 0  # not a file write we understand; do not block

    path = Path(file_path)
    if not path.is_absolute():
        path = ROOT / path
    message = check(path.resolve())
    if message:
        print(f"Blocked by test-first hook: {message}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
