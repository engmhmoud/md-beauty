import json
import os
import subprocess
import sys

from md_beauty.hooks import manifest

DEMO = os.path.join(os.path.dirname(__file__), "..", "examples", "demo")


def _build(src, out):
    subprocess.run([sys.executable, "-m", "md_beauty", "build", src, "-o", str(out)], check=True, capture_output=True)


def test_manifest_points_at_the_workspace_and_opens_md_files():
    data = manifest("My Notes", "workspace/")
    assert data["start_url"] == "./workspace/"
    assert data["scope"] == "./"
    assert data["file_handlers"] == [{"action": "./workspace/", "accept": {"text/markdown": [".md", ".markdown"]}}]


def test_site_with_a_workspace_page_is_installable_and_offline_ready(tmp_path):
    _build(DEMO, tmp_path)
    data = json.loads((tmp_path / "manifest.webmanifest").read_text())
    assert data["name"] == "md-beauty"
    assert data["start_url"] == "./"  # the demo's home page is the workspace
    for path in ["sw.js", "assets/icon-192.png", "assets/icon-maskable-512.png",
                 "assets/vendor/markdown-it.min.js", "assets/vendor/purify.min.js", "assets/vendor/js-yaml.min.js"]:
        assert (tmp_path / path).is_file(), path


def test_site_without_a_workspace_page_has_no_manifest(tmp_path):
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "README.md").write_text("# Notes\n")
    _build(str(notes), tmp_path / "site")
    assert not (tmp_path / "site" / "manifest.webmanifest").exists()
