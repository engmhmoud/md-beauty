"""Saving pasted or uploaded markdown as real .md files inside the folder being served."""

import os
import re

MAX_BYTES = 5 * 1024 * 1024
MD_EXTENSIONS = (".md", ".markdown")


class WorkspaceError(ValueError):
    """A request we refuse; the message is shown to the user."""


def slugify(text):
    text = re.sub(r"[^\w\s-]", "", text.lower(), flags=re.UNICODE)
    return re.sub(r"[\s_-]+", "-", text).strip("-")


def first_heading(content):
    for line in content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return None


def clean_name(name, content):
    """A safe relative path ending in .md: from `name`, else the first # heading, else "untitled"."""
    name = (name or "").strip().replace("\\", "/")
    if not name:
        name = slugify(first_heading(content) or "") or "untitled"
    parts = []
    for part in name.split("/"):
        part = part.strip()
        if part in ("", "."):
            continue
        if part == ".." or part.startswith("."):
            raise WorkspaceError(f"Not allowed in a page name: {part!r}")
        parts.append(part)
    if not parts:
        raise WorkspaceError("The page name is empty.")
    stem, ext = os.path.splitext(parts[-1])
    if ext.lower() not in MD_EXTENSIONS:
        stem = parts[-1]
    parts[-1] = (slugify(stem) or "untitled") + ".md"
    parts[:-1] = [slugify(p) or "folder" for p in parts[:-1]]
    return "/".join(parts)


def save_page(docs_dir, name, content):
    """Write a new page and return its path relative to docs_dir. Never overwrites: adds -2, -3, ..."""
    if len(content.encode("utf-8")) > MAX_BYTES:
        raise WorkspaceError("The text is larger than 5 MB.")
    rel = clean_name(name, content)
    root = os.path.realpath(docs_dir)
    stem = rel[:-3]
    candidate, n = rel, 1
    while os.path.exists(os.path.join(root, candidate)):
        n += 1
        candidate = f"{stem}-{n}.md"
    path = os.path.realpath(os.path.join(root, candidate))
    if os.path.commonpath([root, path]) != root:
        raise WorkspaceError("The page must stay inside the served folder.")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "x", encoding="utf-8", newline="\n") as fh:
        fh.write(content if content.endswith("\n") else content + "\n")
    return candidate


def page_url(rel):
    """The URL path of a page with use_directory_urls (a/b.md -> a/b/, a/README.md -> a/)."""
    stem = rel[:-3]
    head, _, base = stem.rpartition("/")
    if base.lower() in ("index", "readme"):
        return f"{head}/" if head else ""
    return f"{stem}/"
