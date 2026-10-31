"""md-beauty: view one markdown file, several, or a whole folder as a clean website.

    md-beauty serve                        empty workspace (./md-beauty-notes): add or paste pages
    md-beauty serve notes/                 live preview at http://127.0.0.1:8000 (you can add pages)
    md-beauty serve intro.md setup.md      only these files
    md-beauty build notes/ -o site         static HTML you can upload anywhere
"""

import argparse
import os
import shutil
import socket
import subprocess
import sys
import tempfile

import yaml

from . import __version__

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_NAME = ".md-beauty.yml"
ALWAYS_EXCLUDED = ["node_modules/**", "__pycache__/**", ".venv/**", "venv/**"]
IMAGES = ["*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.webp"]
WORKSPACE = "md-beauty-notes"


def _resolve(paths):
    """Return (docs_dir, include patterns) for the given files and folders."""
    paths = [os.path.abspath(p) for p in paths]
    for p in paths:
        if not os.path.exists(p):
            sys.exit(f"md-beauty: no such file or folder: {p}")
    if len(paths) == 1 and os.path.isdir(paths[0]):
        return paths[0], ["*.md"]
    docs_dir = os.path.commonpath([p if os.path.isdir(p) else os.path.dirname(p) for p in paths])
    include = []
    for p in paths:
        rel = os.path.relpath(p, docs_dir).replace(os.sep, "/")
        include.append(f"/{rel}/**/*.md" if os.path.isdir(p) else f"/{rel}")
    return docs_dir, include


def _load_options(docs_dir):
    path = os.path.join(docs_dir, CONFIG_NAME)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _title(docs_dir, include, options, cli_title):
    if cli_title or options.get("title"):
        return cli_title or options["title"]
    if include == ["*.md"]:
        candidates = ["index.md", "README.md"]
    elif len(include) == 1 and not include[0].endswith("/**/*.md"):
        candidates = [include[0].lstrip("/")]  # a single file names the site
    else:
        candidates = []
    for name in candidates:
        path = os.path.join(docs_dir, name)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("# "):
                        return line[2:].strip()
    return os.path.basename(docs_dir).replace("-", " ").replace("_", " ").title() or "Notes"


def write_config(paths, title=None, site_url=None, extra_exclude=(), edit=False, serving=False):
    docs_dir, include = _resolve(paths)
    options = _load_options(docs_dir)
    exclude = ["*", *[f"!{p}" for p in include], *[f"!{p}" for p in IMAGES], "!/assets/**", "!/sw.js",
               *ALWAYS_EXCLUDED, *(options.get("exclude") or []), *extra_exclude]
    theme = os.path.join(HERE, "theme")
    config = {
        "site_name": _title(docs_dir, include, options, title),
        "site_url": site_url or options.get("site_url") or "http://localhost:8000/",
        "docs_dir": docs_dir,
        "use_directory_urls": True,
        "theme": {
            "name": "material",
            "custom_dir": theme,
            "font": {"text": "Open Sans", "code": "JetBrains Mono"},
            "icon": {"logo": "material/hexagon-multiple-outline"},
            "favicon": "assets/favicon.svg",
            "palette": [
                {"media": "(prefers-color-scheme: light)", "scheme": "default", "primary": "custom",
                 "accent": "custom", "toggle": {"icon": "material/weather-night", "name": "Dark mode"}},
                {"media": "(prefers-color-scheme: dark)", "scheme": "slate", "primary": "custom",
                 "accent": "custom", "toggle": {"icon": "material/weather-sunny", "name": "Light mode"}},
            ],
            "features": [
                "navigation.instant", "navigation.instant.progress", "navigation.tracking",
                "navigation.sections", "navigation.indexes", "navigation.prune", "navigation.top",
                "navigation.footer", "toc.follow", "search.suggest", "search.highlight", "content.code.copy",
            ],
        },
        "extra_css": ["assets/md-beauty.css"],
        "extra_javascript": ["assets/md-beauty.js", "assets/md-beauty-workspace.js"],
        "hooks": [os.path.join(HERE, "hooks.py")],
        "extra": {"md_beauty": options, "md_beauty_edit": edit, "md_beauty_serving": serving, "generator": False,
                  "md_beauty_single_file": len(include) == 1 and include[0] != "*.md" and not include[0].endswith("/**/*.md")},
        "exclude_docs": "\n".join(exclude),
        "validation": {
            "omitted_files": "ignore",
            "links": {"not_found": "info", "anchors": "ignore", "absolute_links": "ignore",
                      "unrecognized_links": "ignore"},
        },
        "markdown_extensions": [
            "abbr", "admonition", "attr_list", "def_list", "footnotes", "md_in_html", "tables",
            {"toc": {"permalink": "#", "toc_depth": 3, "slugify": "__GITHUB_SLUGIFY__"}},
            "pymdownx.details",
            {"pymdownx.highlight": {"anchor_linenums": True, "line_spans": "__span", "pygments_lang_class": True}},
            "pymdownx.inlinehilite", "pymdownx.superfences",
            {"pymdownx.tasklist": {"custom_checkbox": True}}, "pymdownx.tilde",
        ],
    }
    text = yaml.safe_dump(config, sort_keys=False, allow_unicode=True)
    # GitHub-style heading ids, so #anchors written for GitHub keep working
    text = text.replace("__GITHUB_SLUGIFY__",
                        "!!python/object/apply:pymdownx.slugs.slugify {kwds: {case: lower}}")
    tmp = tempfile.mkdtemp(prefix="md-beauty-")
    path = os.path.join(tmp, "mkdocs.yml")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def _mkdocs(*args):
    env = dict(os.environ, NO_MKDOCS_2_WARNING="1")
    return subprocess.call([sys.executable, "-m", "mkdocs", *args], env=env)


def _port_free(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # as the server does; ignores closing connections
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def pick_port(host, wanted, explicit, tries=20):
    """The wanted port; when it was only the default and is busy, the next free one."""
    if _port_free(host, wanted):
        return wanted
    if explicit:
        sys.exit(f"md-beauty: port {wanted} is already in use. Pick another one with --port.")
    for port in range(wanted + 1, wanted + tries + 1):
        if _port_free(host, port):
            print(f"md-beauty: port {wanted} is busy, using {port} instead.", flush=True)
            return port
    sys.exit(f"md-beauty: ports {wanted}-{wanted + tries} are all busy. Pick one with --port.")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="md-beauty", description="View markdown files as a clean website.")
    parser.add_argument("--version", action="version", version=f"md-beauty {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="live preview; reloads when you save a file")
    serve.add_argument("paths", nargs="*",
                       help=f"a folder, or one or more .md files (default: an empty workspace in ./{WORKSPACE})")
    serve.add_argument("--read-only", action="store_true",
                       help="hide 'Add page' (adding is on when you serve a folder)")
    serve.add_argument("--host", default=os.environ.get("MD_BEAUTY_HOST", "127.0.0.1"),
                       help="address to listen on (default: 127.0.0.1, or $MD_BEAUTY_HOST)")
    serve.add_argument("--port", type=int,
                       help="port (default: $MD_BEAUTY_PORT or 8000; the next free one if 8000 is busy)")
    serve.add_argument("--title", help="site name (default: README/index H1 or folder name)")

    build = sub.add_parser("build", help="write static HTML")
    build.add_argument("paths", nargs="+", help="a folder, or one or more .md files")
    build.add_argument("-o", "--output", default="site", help="output folder (default: ./site)")
    build.add_argument("--title", help="site name (default: README/index H1 or folder name)")
    build.add_argument("--site-url", help="public URL the site will live at")

    args = parser.parse_args(argv)

    if args.command == "serve":
        env_port = os.environ.get("MD_BEAUTY_PORT")
        explicit = args.port is not None or env_port is not None
        port = pick_port(args.host, args.port or int(env_port or 8000), explicit)
        paths, title = args.paths, args.title
        if not paths:
            os.makedirs(WORKSPACE, exist_ok=True)
            print(f"md-beauty: workspace {os.path.abspath(WORKSPACE)} (pages you add are saved here)", flush=True)
            paths = [WORKSPACE]
            if not title and not _load_options(WORKSPACE).get("title"):
                title = "My Notes"
        # adding pages only makes sense when a whole folder is served
        editable = not args.read_only and len(paths) == 1 and os.path.isdir(paths[0])
        config = write_config(paths, title=title, edit=editable, serving=True)
        if not os.path.exists("/.dockerenv"):  # in Docker the host port comes from `-p`, not from us
            print(f"md-beauty: open http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{port}", flush=True)
        from .server import serve as run_server
        root = os.path.abspath(paths[0]) if os.path.isdir(paths[0]) else _resolve(paths)[0]
        return run_server(config, args.host, port, root, editable=editable, read_only=args.read_only)

    output = os.path.abspath(args.output)
    docs_dir, _ = _resolve(args.paths)
    rel = os.path.relpath(output, docs_dir)
    extra = [f"/{rel}/**"] if not rel.startswith("..") else []
    config = write_config(args.paths, title=args.title, site_url=args.site_url, extra_exclude=extra)
    tmp_out = tempfile.mkdtemp(prefix="md-beauty-site-")  # mkdocs refuses a site dir inside the docs dir
    code = _mkdocs("build", "-f", config, "-d", tmp_out, "--clean")
    if code == 0:
        shutil.rmtree(output, ignore_errors=True)
        shutil.copytree(tmp_out, output)
        print(f"md-beauty: site written to {output}")
    shutil.rmtree(tmp_out, ignore_errors=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
