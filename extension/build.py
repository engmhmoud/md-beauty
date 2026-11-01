"""Build the md-beauty browser extension (Chrome and Edge) into extension/dist and a .zip for the stores.

    python extension/build.py            # needs md-beauty importable: pip install . (or PYTHONPATH=src)

The workspace page is built with md-beauty itself, then made to fit an extension page:
extensions may only run script files, so inline scripts move into files.
"""
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile

from md_beauty import __version__
from md_beauty.cli import main as md_beauty

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
DIST = os.path.join(HERE, "dist")
STATIC = ["background.js", "view.js", "ext.js", "icons"]
# the website's app parts the extension doesn't use; the header search needs a site index,
# and the workspace has its own page filter
NO_SEARCH = '<style>.md-search, .md-header__button[for="__search"] { display: none !important; }</style>'
DROP_LINKS = re.compile(r'\s*<link rel="(canonical|next|prev|manifest|apple-touch-icon)"[^>]*>')
INLINE = re.compile(r"<script>(.*?)</script>", re.S)


def build_page(out):
    docs = tempfile.mkdtemp(prefix="md-beauty-ext-")
    site = os.path.join(docs, "_site")
    try:
        shutil.copy(os.path.join(SRC, "home.md"), os.path.join(docs, "README.md"))
        if md_beauty(["build", docs, "-o", site, "--title", "md-beauty"]) != 0:
            sys.exit("md-beauty build failed")
        html = open(os.path.join(site, "index.html"), encoding="utf-8").read()
        shutil.copytree(os.path.join(site, "assets"), os.path.join(out, "assets"),
                        ignore=shutil.ignore_patterns("lunr", "icon-*.png"))
    finally:
        shutil.rmtree(docs, ignore_errors=True)

    html = DROP_LINKS.sub("", html)
    html = html.replace('name="search"', "").replace("</head>", NO_SEARCH + "\n</head>")
    count = 0

    def to_file(m):
        nonlocal count
        count += 1
        name = f"assets/page-{count}.js"
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            f.write(m.group(1))
        return f'<script src="{name}"></script>'

    html = INLINE.sub(to_file, html)
    html = html.replace("</body>", '<script src="ext.js"></script>\n</body>')
    if re.search(r"<script>|\son[a-z]+=", html):
        sys.exit("inline script left in the page; extensions would refuse it")
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)


def main(dist=DIST, zip_dir=HERE):
    shutil.rmtree(dist, ignore_errors=True)
    os.makedirs(dist)
    build_page(dist)
    for name in STATIC:
        src = os.path.join(SRC, name)
        (shutil.copytree if os.path.isdir(src) else shutil.copy)(src, os.path.join(dist, name))
    manifest = json.load(open(os.path.join(SRC, "manifest.json"), encoding="utf-8"))
    manifest["version"] = __version__
    with open(os.path.join(dist, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    archive = os.path.join(zip_dir, f"md-beauty-extension-{__version__}.zip")
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for folder, _, files in os.walk(dist):
            for name in sorted(files):
                path = os.path.join(folder, name)
                z.write(path, os.path.relpath(path, dist))
    print(f"md-beauty: extension in {dist}, store upload {archive}")
    return archive


if __name__ == "__main__":
    main()
