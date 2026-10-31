"""MkDocs hooks that make plain GitHub-style markdown look good with the md-beauty theme.

1. on_page_markdown: GitHub list rules for Python-Markdown (2/3-space indents, a list
   right after a paragraph, markdown inside <details>).
2. on_files: a home page when the folder has no index.md / README.md.
3. on_nav: section names from each folder's README/index H1, custom order, "_" folders last.
4. on_page_content: blockquotes -> info / tip / warning callouts, `[MUST]` -> tag pills.
5. on_post_build: an app manifest when a page uses the workspace template, so the site can be
   installed as an app (and open .md files from the computer's "Open with" menu).

Options come from `extra.md_beauty` in the generated mkdocs.yml (see cli.py).
"""

import json
import os
import re

from mkdocs.structure.files import File, InclusionLevel

OPTIONS = {}
WORKSPACE_TEMPLATE = "md-beauty-workspace.html"
WORKSPACE_URLS = []

# ---------------------------------------------------------------- 1. markdown fixes

LIST_RE = re.compile(r"^( *)([-*+]|\d{1,3}[.)])( +)(?=\S)")
FENCE_RE = re.compile(r"^( *)(`{3,}|~{3,})")
DETAILS_RE = re.compile(r"<details(?![^>]*\bmarkdown=)")


def _indent(line):
    return len(line) - len(line.lstrip(" "))


BREAK = "<!-- -->"  # an empty HTML block: ends a list or quote for Python-Markdown


def fix_lists(md):
    """Rewrite markdown so Python-Markdown reads it the way GitHub does.

    - list content is re-indented to 4-space levels (GitHub accepts 2 or 3)
    - a list right after a paragraph, a code fence or a question line gets its blank line
    - a bullet list followed by a numbered list stays two lists
    - two quotes separated by a blank line stay two quotes
    - <details> under a line of text starts its own block
    """
    out = []
    stack = []  # content column of each open list item (original spacing)
    fence = None  # (marker, original indent, new indent) while inside a fenced block
    prev_blank = True
    prev_is_text = False
    after_fence = False
    top_kind = None  # "ul" / "ol" of the last top-level list, until a paragraph ends it
    last_quote = False  # the last non-blank top-level line was a quote

    def separate():
        if out and out[-1] != "":
            out.append("")
        out.extend([BREAK, ""])

    for line in md.expandtabs(4).split("\n"):
        if fence:
            marker, old, new = fence
            if line.strip().startswith(marker) and line.strip().strip(marker[0]) == "":
                fence = None
                after_fence = True
            if _indent(line) >= old:
                line = " " * new + line[old:]
            out.append(line)
            prev_blank, prev_is_text = False, False
            continue

        if not line.strip():
            out.append("")
            prev_blank, prev_is_text = True, False
            continue

        n = _indent(line)
        item = LIST_RE.match(line)
        stripped = line.strip()

        # leave the list when the text drops back to (or left of) the item's content column
        while stack and n < stack[-1] and (item or prev_blank or n == 0):
            stack.pop()

        if item:
            kind = "ol" if item.group(2)[0].isdigit() else "ul"
            if not stack and top_kind and kind != top_kind and prev_blank:
                separate()
            elif (not stack and prev_is_text) or after_fence:
                out.append("")  # Python-Markdown needs a blank line before a list (item)
            if not stack:
                top_kind = kind
            stack.append(n + len(item.group(2)) + len(item.group(3)))
            out.append(" " * (4 * (len(stack) - 1)) + line[n:])
            prev_blank, prev_is_text, after_fence, last_quote = False, False, False, False
            continue

        new = n
        if stack:
            new = 4 * len(stack) + max(0, n - stack[-1])
            line = " " * new + line[n:]
        else:
            top_kind = None
            if stripped.startswith(">"):
                if last_quote and prev_blank:
                    separate()
                last_quote = True
            else:
                last_quote = False

        if stripped.startswith("<details") and not prev_blank and out:
            out.append("")

        f = FENCE_RE.match(line)
        if f:
            fence = (f.group(2), n, new)

        out.append(line)
        prev_blank, after_fence = False, False
        prev_is_text = not stack and not stripped.startswith(("|", "<", "#", ">", "---"))

    return "\n".join(out)


def on_config(config, **_):
    WORKSPACE_URLS.clear()
    OPTIONS.clear()
    OPTIONS.update(config.get("extra", {}).get("md_beauty", {}) or {})
    return config


def on_page_markdown(markdown, page, **_):
    if page.meta.get("template") == WORKSPACE_TEMPLATE:
        WORKSPACE_URLS.append(page.url)
    title = (OPTIONS.get("pages") or {}).get(page.file.src_uri)
    if title:
        page.meta["title"] = title
    markdown = fix_lists(markdown)
    return DETAILS_RE.sub('<details markdown="1"', markdown)


# ---------------------------------------------------------------- 2. home page


def _h1(path):
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("# "):
                    return line[2:].strip()
    except OSError:
        pass
    return None


def on_files(files, config, **_):
    pages = [f for f in files.documentation_pages() if f.inclusion.is_included()]
    if not pages:  # empty folder: a home page with "add a page" (md-beauty.js fills .mb-empty)
        content = f'# {config["site_name"]}\n\n<div class="mb-empty"><p>No pages yet.</p></div>\n'
        files.append(File.generated(config, "index.md", content=content, inclusion=InclusionLevel.INCLUDED))
        return files
    if any(f.src_uri in ("index.md", "README.md") for f in pages):
        return files
    if len(pages) == 1 and config["extra"].get("md_beauty_single_file"):
        pages[0].dest_uri = "index.html"  # `serve file.md`: that file is the whole site
        pages[0].url = ""
        return files
    lines = [f"# {config['site_name']}", ""]
    for f in sorted(pages, key=lambda f: f.src_uri):
        title = _h1(f.abs_src_path) or os.path.splitext(os.path.basename(f.src_uri))[0]
        lines.append(f"- [{title}]({f.src_uri})")
    files.append(File.generated(config, "index.md", content="\n".join(lines) + "\n", inclusion=InclusionLevel.INCLUDED))
    return files


# ---------------------------------------------------------------- 3. sidebar


def _short(title):
    # "001 — Network Foundations (Kurose & Ross, ...)" -> "001 — Network Foundations"
    title = re.sub(r"\s*\(.*$", "", title)
    title = re.sub(r":\s.*$", "", title)
    return title.replace("`", "").strip()


def _src_dir(section):
    for child in section.children:
        f = getattr(child, "file", None)
        if f:
            return os.path.dirname(f.src_uri)
        if getattr(child, "children", None):
            sub = _src_dir(child)
            if sub is not None:
                return os.path.dirname(sub)
    return None


def _retitle(items, docs_dir, sections):
    for item in items:
        if not item.is_section:
            continue
        folder = _src_dir(item)
        if folder in sections:
            item.title = sections[folder]
        elif folder:
            h1 = _h1(os.path.join(docs_dir, folder, "README.md")) or _h1(os.path.join(docs_dir, folder, "index.md"))
            if h1:
                item.title = _short(h1)
        item.children.sort(key=lambda c: c.is_section and (_src_dir(c) or "").rsplit("/", 1)[-1].startswith("_"))
        _retitle(item.children, docs_dir, sections)


def _top_key(item, order):
    if item.is_section:
        key = (_src_dir(item) or "").split("/")[0]
    else:
        key = item.file.src_uri if getattr(item, "file", None) else ""
    if key in ("README.md", "index.md"):
        return (0, 0)
    if key in order:
        return (1, order.index(key))
    return (2, 1 if key.startswith("_") else 0)


def on_nav(nav, config, **_):
    _retitle(nav.items, config["docs_dir"], OPTIONS.get("sections") or {})
    order = OPTIONS.get("order") or []
    nav.items.sort(key=lambda item: _top_key(item, order))
    return nav


# ---------------------------------------------------------------- 4. callouts + tags

WARN_WORDS = ("warning", "trap", "gotcha", "caution", "careful", "danger", "pitfall", "don't",
              "do not", "never", "common mistake", "watch out", "bug", "wrong")
TIP_WORDS = ("tip", "interview", "takeaway", "remember", "rule of thumb", "must know", "shortcut",
             "key idea", "core idea", "try it", "in short", "tl;dr", "answer")
ALERTS = {"NOTE": "info", "IMPORTANT": "info", "TIP": "tip", "WARNING": "warning", "CAUTION": "warning"}
TAGS = "MUST|IMPORTANT|ARCHITECT|DEEP|SENIOR|OPTIONAL"

BQ_RE = re.compile(r"<blockquote>(\s*<p>)(\[!(\w+)\]\s*(?:<br\s*/?>)?\s*|<strong>([^<]{1,60})</strong>)?")
TAG_RE = re.compile(rf"<code>\[({TAGS})\]</code>")
TOC_TAG_RE = re.compile(rf"\s*\[({TAGS})\]")
INTERVIEW_RE = re.compile(r"<p><strong>(Interview line|Interview answer|Say this)(:?)</strong>(:?)")
P_DETAILS_RE = re.compile(r"<p>\s*(<details[^>]*>\s*<summary>.*?</summary>)\s*</p>", re.S)
P_DETAILS_END_RE = re.compile(r"<p>\s*</details>\s*</p>")


def callout_kind(label):
    low = label.lower()
    if any(w in low for w in WARN_WORDS):
        return "warning"
    if any(w in low for w in TIP_WORDS):
        return "tip"
    return "info"


def _callout(m):
    p, alert, label = m.group(1), m.group(3), m.group(4)
    if alert:
        kind = ALERTS.get(alert.upper(), "info")
        return f'<blockquote class="callout callout-{kind}">{p}'
    if label:
        return f'<blockquote class="callout callout-{callout_kind(label)}">{p}<strong>{label}</strong>'
    return f'<blockquote class="callout callout-info">{p or ""}'


def _clean_toc(items):
    for item in items:
        item.title = TOC_TAG_RE.sub("", item.title)
        _clean_toc(item.children)


def render_extras(html):
    html = BQ_RE.sub(_callout, html)
    html = TAG_RE.sub(lambda m: f'<span class="tag tag-{m.group(1).lower()}">{m.group(1)}</span>', html)
    html = INTERVIEW_RE.sub(lambda m: f'<p class="interview-line"><strong>{m.group(1)}{m.group(2)}</strong>{m.group(3)}', html)
    html = P_DETAILS_RE.sub(r"\1", html)
    return P_DETAILS_END_RE.sub("</details>", html)


def on_page_content(html, page, **_):
    _clean_toc(page.toc.items)
    return render_extras(html)


# ---------------------------------------------------------------- 5. installable workspace


def manifest(site_name, workspace_url):
    """The web app manifest; URLs are relative to the manifest at the site root."""
    start = "./" + workspace_url
    return {
        "id": start,
        "name": site_name,
        "short_name": site_name[:12],
        "description": "Read and edit markdown files and folders from your computer.",
        "start_url": start,
        "scope": "./",
        "display": "standalone",
        "background_color": "#ffffff",
        "theme_color": "#299a8d",
        "icons": [
            {"src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "assets/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
        "file_handlers": [{"action": start, "accept": {"text/markdown": [".md", ".markdown"]}}],
    }


def on_post_build(config, **_):
    if not WORKSPACE_URLS:
        return
    path = os.path.join(config["site_dir"], "manifest.webmanifest")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest(config["site_name"], WORKSPACE_URLS[0]), fh, indent=2)
