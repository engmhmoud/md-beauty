"""`md-beauty serve`: MkDocs' live-reload server plus a small endpoint that saves new pages.

POST /_md-beauty/pages  {"name": "optional/path.md", "content": "..."}  ->  {"path": ..., "url": ...}

The browser must send the X-MD-Beauty header (a cross-site page cannot, without a CORS
preflight we never answer) and a same-host Origin, so other websites cannot write files.
"""

import json
import logging
import os
from urllib.parse import urlsplit

from .workspace import WorkspaceError, page_url, save_page

API_PATH = "/_md-beauty/pages"

log = logging.getLogger("mkdocs")


def _reply(start_response, status, payload):
    body = json.dumps(payload).encode("utf-8")
    start_response(status, [("Content-Type", "application/json"), ("Content-Length", str(len(body)))])
    return [body]


def handle_api(environ, start_response, docs_dir, mount_path):
    if environ.get("REQUEST_METHOD") != "POST":
        return _reply(start_response, "405 Method Not Allowed", {"error": "Use POST."})
    origin = environ.get("HTTP_ORIGIN")
    if environ.get("HTTP_X_MD_BEAUTY") != "1" or (origin and urlsplit(origin).netloc != environ.get("HTTP_HOST")):
        return _reply(start_response, "403 Forbidden", {"error": "Requests must come from this site."})
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
        data = json.loads(environ["wsgi.input"].read(length) or b"{}")
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


def serve(config_file, host, port, docs_dir=None):
    """Run MkDocs' dev server; with docs_dir, also accept new pages through the API."""
    os.environ.setdefault("NO_MKDOCS_2_WARNING", "1")
    from mkdocs.__main__ import State
    from mkdocs.commands import serve as mkdocs_serve
    from mkdocs.livereload import LiveReloadServer

    state = State()  # MkDocs' own console logging, as with `mkdocs serve` (removed when `state` is freed)

    if docs_dir:
        original = LiveReloadServer.serve_request

        def serve_request(self, environ, start_response):
            if environ.get("PATH_INFO", "").rstrip("/") == API_PATH:
                return handle_api(environ, start_response, docs_dir, self.mount_path)
            return original(self, environ, start_response)

        LiveReloadServer.serve_request = serve_request

    try:
        mkdocs_serve.serve(config_file=config_file, livereload=True, dev_addr=f"{host}:{port}")
    finally:
        del state
    return 0
