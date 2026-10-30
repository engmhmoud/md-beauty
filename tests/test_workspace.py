import io
import json

import pytest

from md_beauty.server import handle
from md_beauty.workspace import WorkspaceError, clean_name, page_url, save_page


def test_name_comes_from_the_first_heading_when_empty():
    assert clean_name("", "intro\n# Caching 101: Why?\ntext") == "caching-101-why.md"


def test_name_without_heading_is_untitled():
    assert clean_name(None, "just text") == "untitled.md"


def test_name_keeps_folders_and_adds_md():
    assert clean_name("Guide/My Page", "x") == "guide/my-page.md"
    assert clean_name("notes.markdown", "x") == "notes.md"


@pytest.mark.parametrize("bad", ["../escape.md", "a/../../b.md", ".hidden.md", "a/.git/config"])
def test_names_that_leave_the_folder_or_are_hidden_are_refused(bad):
    with pytest.raises(WorkspaceError):
        clean_name(bad, "x")


def test_save_never_overwrites(tmp_path):
    assert save_page(tmp_path, "page", "# One") == "page.md"
    assert save_page(tmp_path, "page", "# Two") == "page-2.md"
    assert (tmp_path / "page.md").read_text() == "# One\n"
    assert (tmp_path / "page-2.md").read_text() == "# Two\n"


def test_save_creates_folders(tmp_path):
    assert save_page(tmp_path, "guide/intro", "# Intro") == "guide/intro.md"
    assert (tmp_path / "guide" / "intro.md").exists()


def test_page_urls_follow_directory_urls():
    assert page_url("guide/intro.md") == "guide/intro/"
    assert page_url("guide/README.md") == "guide/"
    assert page_url("index.md") == ""


def _call(tmp_path, body, headers):
    raw = json.dumps(body).encode()
    environ = {"REQUEST_METHOD": "POST", "PATH_INFO": "/_md-beauty/pages", "CONTENT_LENGTH": str(len(raw)),
               "wsgi.input": io.BytesIO(raw), "HTTP_HOST": "localhost:8000", **headers}
    seen = {}
    out = handle(environ, lambda status, _: seen.setdefault("status", status),
                 editable_dir=str(tmp_path), root=str(tmp_path), mount_path="/", restart=None)
    return seen["status"], json.loads(b"".join(out))


def test_api_saves_and_returns_the_page_url(tmp_path):
    status, data = _call(tmp_path, {"content": "# Hello world"},
                         {"HTTP_X_MD_BEAUTY": "1", "HTTP_ORIGIN": "http://localhost:8000"})
    assert status.startswith("201")
    assert data == {"path": "hello-world.md", "url": "/hello-world/"}


def test_api_refuses_requests_without_the_header(tmp_path):
    status, _ = _call(tmp_path, {"content": "# x"}, {})
    assert status.startswith("403")
    assert not list(tmp_path.iterdir())


def test_api_refuses_other_origins(tmp_path):
    status, _ = _call(tmp_path, {"content": "# x"}, {"HTTP_X_MD_BEAUTY": "1", "HTTP_ORIGIN": "https://evil.example"})
    assert status.startswith("403")


def test_api_refuses_empty_text(tmp_path):
    status, data = _call(tmp_path, {"content": "  "}, {"HTTP_X_MD_BEAUTY": "1"})
    assert status.startswith("400") and "no markdown" in data["error"]


def test_list_dirs_shows_folders_with_md_counts_and_hides_noise(tmp_path):
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "a.md").write_text("# a")
    (tmp_path / "notes" / "b.md").write_text("# b")
    (tmp_path / ".git").mkdir()
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "top.md").write_text("# top")
    from md_beauty.server import list_dirs
    data = list_dirs(str(tmp_path))
    assert data["path"] == str(tmp_path)
    assert data["md_files"] == 1
    assert data["dirs"] == [{"name": "notes", "path": str(tmp_path / "notes"), "md_files": 2}]
    assert data["parent"] == str(tmp_path.parent)


def _request(method, path, body=None, query=""):
    raw = json.dumps(body or {}).encode()
    return {"REQUEST_METHOD": method, "PATH_INFO": path, "QUERY_STRING": query, "CONTENT_LENGTH": str(len(raw)),
            "wsgi.input": io.BytesIO(raw), "HTTP_HOST": "localhost:8000", "HTTP_X_MD_BEAUTY": "1"}


def test_open_restarts_on_an_existing_folder_only(tmp_path):
    opened = []
    seen = {}

    def start_response(status, _):
        seen["status"] = status

    def restart(path):
        opened.append(path)

    out = handle(_request("POST", "/_md-beauty/open", {"path": "/no/such/folder"}), start_response,
                 editable_dir=None, root=str(tmp_path), mount_path="/", restart=restart)
    assert seen["status"].startswith("400") and "Not a folder" in json.loads(b"".join(out))["error"]

    out = handle(_request("POST", "/_md-beauty/open", {"path": str(tmp_path)}), start_response,
                 editable_dir=None, root=str(tmp_path), mount_path="/", restart=restart)
    assert seen["status"].startswith("200")
    import time
    time.sleep(0.6)  # restart runs just after the answer is sent
    assert opened == [str(tmp_path)]


def test_adding_pages_is_refused_when_not_editable(tmp_path):
    seen = {}
    handle(_request("POST", "/_md-beauty/pages", {"content": "# x"}), lambda s, _: seen.setdefault("status", s),
           editable_dir=None, root=str(tmp_path), mount_path="/", restart=None)
    assert seen["status"].startswith("403")
    assert not list(tmp_path.iterdir())
