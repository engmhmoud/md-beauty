import importlib.util
import json
import os
import re
import zipfile

from md_beauty import __version__

BUILD = os.path.join(os.path.dirname(__file__), "..", "extension", "build.py")


def _build_module():
    spec = importlib.util.spec_from_file_location("extension_build", BUILD)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_extension_page_runs_only_script_files(tmp_path):
    archive = _build_module().main(dist=str(tmp_path / "dist"), zip_dir=str(tmp_path))
    dist = tmp_path / "dist"
    html = (dist / "index.html").read_text()
    assert not re.search(r"<script>|\son[a-z]+=", html)  # the extension's rules refuse inline scripts
    for src in re.findall(r'<script src="([^"]+)"', html):
        assert (dist / src).is_file(), src
    assert 'rel="manifest"' not in html
    assert 'name="search"' not in html  # no site index in the extension

    manifest = json.loads((dist / "manifest.json").read_text())
    assert manifest["manifest_version"] == 3
    assert manifest["version"] == __version__
    for name in ["background.js", "view.js", "ext.js", *manifest["icons"].values()]:
        assert (dist / name).is_file(), name
    with zipfile.ZipFile(archive) as z:
        assert "manifest.json" in z.namelist() and "index.html" in z.namelist()
