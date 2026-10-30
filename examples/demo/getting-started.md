# Getting Started

This site is the live demo of [md-beauty](https://github.com/engmhmoud/md-beauty). It was built from plain markdown files in [`examples/demo`](https://github.com/engmhmoud/md-beauty/tree/main/examples/demo) with one command.

## Install

**With Docker (nothing to install):**

```bash
docker build -t md-beauty https://github.com/engmhmoud/md-beauty.git
docker run --rm -p 8000:8000 -v "$PWD":/docs md-beauty serve .
```

**With Python 3.10+:**

```bash
pipx install git+https://github.com/engmhmoud/md-beauty.git
md-beauty serve notes/
```

Open http://127.0.0.1:8000. Saving a file reloads the page.

## Commands

| Command | What it does |
|---|---|
| `md-beauty serve notes/` | Live preview of a folder |
| `md-beauty serve intro.md setup.md` | Only these files |
| `md-beauty build notes/ -o site` | Static HTML, ready for GitHub Pages or any web server |

## Reading controls

Use the buttons at the top right, or the keys: `[` hides the left sidebar, `]` hides the table of contents, `\` hides both (focus mode), `-` and `=` change the text size, and `0` resets it.

> **Tip:** put a `.md-beauty.yml` next to your notes to set the site title, the sidebar order and section names. See the [README](https://github.com/engmhmoud/md-beauty#optional-settings).
