"""`md-beauty serve`: MkDocs' live-reload server plus a small API for the page.

POST /_md-beauty/pages  {"name": "optional/path.md", "content": "..."}  ->  {"path": ..., "url": ...}
GET  /_md-beauty/dirs?path=/some/folder                               ->  {"path", "parent", "dirs", "md_files"}
POST /_md-beauty/open   {"path": "/some/folder"}                       ->  restarts md-beauty on that folder

The browser must send the X-MD-Beauty header (a cross-site page cannot, without a CORS
preflight we never answer) and a same-host Origin, so other websites cannot use the API.
"""

import json
import logging
import os
import sys
import threading
from urllib.parse import parse_qs, urlsplit

from .workspace import MD_EXTENSIONS, WorkspaceError, page_url, save_page

API = "/_md-beauty/"
SKIP_DIRS = {"node_modules", "__pycache__", "venv", "site-packages"}
MAX_DIRS = 500

log = logging.getLogger("mkdocs")


def _reply(start_response, status, payload):
    body = json.dumps(payload).encode("utf-8")
    start_response(status, [("Content-Type", "application/json"), ("Content-Length", str(len(body)))])
    return [body]


def _allowed(environ):
    origin = environ.get("HTTP_ORIGIN")
    return environ.get("HTTP_X_MD_BEAUTY") == "1" and not (origin and urlsplit(origin).netloc != environ.get("HTTP_HOST"))


def _json_body(environ):
    length = int(environ.get("CONTENT_LENGTH") or 0)
    return json.loads(environ["wsgi.input"].read(length) or b"{}")


def _count_md(path):
    try:
        with os.scandir(path) as entries:
            return sum(1 for e in entries if e.name.lower().endswith(MD_EXTENSIONS) and e.is_file())
    except OSError:
        return 0


def list_dirs(path):
    """The subfolders of `path` (no hidden or tool folders) and how many .md files each holds directly."""
    path = os.path.abspath(os.path.expanduser(path or "~"))
    if not os.path.isdir(path):
        raise WorkspaceError(f"Not a folder: {path}")
    dirs, md_files = [], 0
    try:
        entries = sorted(os.scandir(path), key=lambda e: e.name.lower())
    except PermissionError:
        raise WorkspaceError(f"No permission to read {path}") from None
    for entry in entries:
        if entry.name.startswith(".") or entry.name in SKIP_DIRS:
            continue
        try:
            if entry.is_dir():
                if len(dirs) < MAX_DIRS:
                    dirs.append({"name": entry.name, "path": entry.path, "md_files": _count_md(entry.path)})
            elif entry.name.lower().endswith(MD_EXTENSIONS):
                md_files += 1
        except OSError:
            continue
    parent = os.path.dirname(path)
    return {"path": path, "parent": parent if parent != path else None, "dirs": dirs, "md_files": md_files}


def handle_pages(environ, start_response, docs_dir, mount_path):
    if not docs_dir:
        return _reply(start_response, "403 Forbidden", {"error": "Adding pages is off (--read-only or single files)."})
    try:
        data = _json_body(environ)
        content = data.get("content")
        if not isinstance(content, str) or not content.strip():
            raise WorkspaceError("There is no markdown text to save.")
        rel = save_page(docs_dir, data.get("name"), content)
    except WorkspaceError as exc:
        return _reply(start_response, "400 Bad Request", {"error": str(exc)})
    except (ValueError, KeyError):
        return _reply(start_response, "400 Bad Request", {"error": "Bad request."})
    except PermissionError:
        return _reply(start_response, "403 Forbidden", {"error": "This folder is read-only."})
    except OSError as exc:
        if exc.errno == 30:  # EROFS: e.g. a Docker volume mounted with :ro
            return _reply(start_response, "403 Forbidden", {"error": "This folder is read-only."})
        raise
    log.info(f"md-beauty: saved {rel}")
    return _reply(start_response, "201 Created", {"path": rel, "url": mount_path + page_url(rel)})


def handle_dirs(environ, start_response, root):
    query = parse_qs(environ.get("QUERY_STRING", ""))
    try:
        return _reply(start_response, "200 OK", list_dirs((query.get("path") or [root])[0]))
    except WorkspaceError as exc:
        return _reply(start_response, "400 Bad Request", {"error": str(exc)})


def handle_open(environ, start_response, restart):
    try:
        path = os.path.abspath(os.path.expanduser(str(_json_body(environ).get("path") or "")))
    except (ValueError, KeyError):
        return _reply(start_response, "400 Bad Request", {"error": "Bad request."})
    if not os.path.isdir(path):
        return _reply(start_response, "400 Bad Request", {"error": f"Not a folder: {path}"})
    log.info(f"md-beauty: opening {path}")
    # answer first, then replace this process with md-beauty serving the new folder
    threading.Timer(0.4, restart, args=(path,)).start()
    return _reply(start_response, "200 OK", {"path": path})


def handle(environ, start_response, *, editable_dir, root, mount_path, restart):
    if not _allowed(environ):
        return _reply(start_response, "403 Forbidden", {"error": "Requests must come from this site."})
    name = environ.get("PATH_INFO", "")[len(API):].strip("/")
    method = environ.get("REQUEST_METHOD")
    if name == "pages" and method == "POST":
        return handle_pages(environ, start_response, editable_dir, mount_path)
    if name == "dirs" and method == "GET":
        return handle_dirs(environ, start_response, root)
    if name == "open" and method == "POST":
        return handle_open(environ, start_response, restart)
    return _reply(start_response, "404 Not Found", {"error": "Unknown request."})


def serve(config_file, host, port, root, editable=False, read_only=False):
    """Run MkDocs' dev server on `root` with the md-beauty API (adding pages only when `editable`)."""
    os.environ.setdefault("NO_MKDOCS_2_WARNING", "1")
    from mkdocs.__main__ import State
    from mkdocs.commands import serve as mkdocs_serve
    from mkdocs.livereload import LiveReloadServer

    state = State()  # MkDocs' own console logging, as with `mkdocs serve` (removed when `state` is freed)

    def restart(path):
        args = [sys.executable, "-m", "md_beauty", "serve", path, "--host", host, "--port", str(port)]
        if read_only:
            args.append("--read-only")
        sys.stdout.flush()
        sys.stderr.flush()
        os.execv(sys.executable, args)

    original = LiveReloadServer.serve_request

    def serve_request(self, environ, start_response):
        if environ.get("PATH_INFO", "").startswith(API):
            return handle(environ, start_response, editable_dir=root if editable else None,
                          root=root, mount_path=self.mount_path, restart=restart)
        return original(self, environ, start_response)

    LiveReloadServer.serve_request = serve_request

    try:
        mkdocs_serve.serve(config_file=config_file, livereload=True, dev_addr=f"{host}:{port}")
    finally:
        del state
    return 0
