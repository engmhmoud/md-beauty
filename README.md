# md-beauty

**Turn your markdown notes into a clean, readable website with one command.**

Point it at one `.md` file, a few files, or a whole folder. You get a site with a sidebar, search, dark mode, colored callouts and a "mark as read" toggle. Your files stay plain GitHub markdown: no front matter and no special syntax.

**[See the live demo →](https://engmhmoud.github.io/md-beauty/)**

![md-beauty light mode](docs/screenshot-light.png)

## Quick start

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
| `md-beauty serve notes/` | Live preview of a folder (all `.md` files inside it) |
| `md-beauty serve intro.md setup.md` | Only these files (and related ones you list) |
| `md-beauty build notes/ -o site` | Static HTML in `site/`, ready for GitHub Pages, Netlify or any web server |
| `--title "My Notes"` | Site name (default: the H1 of `README.md`/`index.md`, or the folder name) |
| `--host 0.0.0.0 --port 8080` | Open it from other devices on your network |

With Docker, put the command after the image name: `docker run --rm -p 8000:8000 -v "$PWD":/docs md-beauty build . -o site`.

## Reading controls

The article is the main part of the page. On large screens the text grows on its own, and you can give the article almost the whole screen:

| Button | Key | What it does |
|---|---|---|
| Left-panel icon | `[` | Show/hide the left sidebar |
| Right-panel icon | `]` | Show/hide the table of contents |
| | `\` | Focus mode: hide or show both |
| **A−** / **A+** | `-` / `=` | Smaller / bigger text (80–300%), only in the article |
| | `0` | Reset the text size |

Your choices are saved in the browser and stay the same on every page.

## What you get from plain markdown

| You write | You see |
|---|---|
| `> **Note:** ...` or any `> **Label:** ...` | Blue info callout |
| `> **Tip:** ...`, `> **Takeaway:** ...` | Teal tip callout |
| `> **Trap:** ...`, `> **Warning:** ...`, `> **Don't ...:**` | Red warning callout |
| `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]` | The same callouts, GitHub style |
| `` `[MUST]` `` `` `[IMPORTANT]` `` `` `[ARCHITECT]` `` `` `[DEEP]` `` | Colored tag pills |
| `<details><summary>Answer</summary> ... </details>` | Collapsible answer card (markdown inside works) |
| `**Interview line:** ...` | Highlighted paragraph |
| Folders with a `README.md` | Sidebar sections named after the README's first heading |

It also fixes the places where GitHub and MkDocs read markdown differently. Lists with 2- or 3-space indents keep their numbering and nesting, a list right after a paragraph still renders as a list, and `#anchor` links use GitHub's heading ids.

![md-beauty dark mode](docs/screenshot-dark.png)

## Optional settings

Put a `.md-beauty.yml` in the folder you serve:

```yaml
title: System Design Notes        # site name
order: [plan.md, learning, labs]  # top-level order in the sidebar
sections:                         # rename sidebar sections (folder path -> title)
  learning: Learning Path
pages:                            # rename pages (file path -> title)
  plan.md: Study Plan
exclude:                          # gitignore-style patterns to leave out
  - /drafts/**
```

## Try the demo

```bash
git clone https://github.com/engmhmoud/md-beauty.git && cd md-beauty
docker build -t md-beauty . && docker run --rm -p 8000:8000 -v "$PWD/examples/demo":/docs md-beauty serve .
```

## How it works

md-beauty generates a [MkDocs](https://www.mkdocs.org/) config on the fly and runs it with [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/), plus:

- `src/md_beauty/hooks.py`: markdown fixes, callouts, tags, sidebar names
- `src/md_beauty/theme/`: the CSS (Open Sans, teal accent, light and dark) and the "mark as read" script

Run the tests with `pip install -e ".[test]" && pytest`.

## License

MIT
