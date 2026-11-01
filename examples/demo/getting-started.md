# Getting Started

This site is the live demo of [md-beauty](https://github.com/engmhmoud/md-beauty). It was built from plain markdown files in [`examples/demo`](https://github.com/engmhmoud/md-beauty/tree/main/examples/demo) with one command.

## In your browser: nothing to install

On the **[Workspace](README.md)** (this site's home page):

- **Open folder** or **Open files**, or drop `.md` files or a folder anywhere on the page. Your markdown shows up in this style. Nothing is uploaded; your browser reads the files directly.
- **Edit** (or press `e`) shows the markdown on the left and a live preview on the right. **Hide preview** gives the text the full width. Save with `Ctrl+S`.
- **+ New page** creates a new `.md` file.

| | Chrome / Edge | Firefox / Safari |
|---|---|---|
| Open a folder, open files, drop them | Yes | Yes (a snapshot: pick them again to see changes) |
| Pages update when a file changes | Yes | No |
| Save | Writes back to your files | Downloads the `.md` file |
| Recent folders and files | Yes | No |
| Install as an app (works offline, **Open with → md-beauty** for `.md` files) | Yes | No |

**Browser extension (Chrome / Edge):** the same workspace from a toolbar button, and `.md` files you open in a tab show in this style. See the [README](https://github.com/engmhmoud/md-beauty#browser-extension-chrome--edge) to install it.

## Publish your notes as a website

For developers who want their own site, like this one, there's a command line tool.

**With Docker:**

```bash
docker build -t md-beauty https://github.com/engmhmoud/md-beauty.git
docker run --rm -p 127.0.0.1:8000:8000 -v "$PWD":/docs md-beauty serve .
```

**With Python 3.10+:**

```bash
pipx install git+https://github.com/engmhmoud/md-beauty.git
md-beauty serve notes/
```

Open http://127.0.0.1:8000. Saving a file reloads the page.

| Command | What it does |
|---|---|
| `md-beauty serve` | Empty workspace: add or paste pages in the browser (**+** button, drop files, or `Ctrl+V`) |
| `md-beauty serve notes/` | Live preview of a folder |
| Folder button or `o` (while serving) | Open another folder: browse, pick, and md-beauty restarts on it |
| `md-beauty serve intro.md setup.md` | Only these files |
| `md-beauty build notes/ -o site` | Static HTML, ready for GitHub Pages or any web server |
| `md-beauty serve . --port 8080` | Another port (with Docker: `-p 127.0.0.1:8080:8000`). Without `--port`, a busy 8000 moves to the next free port |

## Reading controls

Use the buttons at the top right, or the keys: `[` hides the left sidebar, `]` hides the table of contents, `\` hides both (focus mode), `-` and `=` change the text size, and `0` resets it.

> **Tip:** put a `.md-beauty.yml` next to your notes to set the site title, the sidebar order and section names. See the [README](https://github.com/engmhmoud/md-beauty#optional-settings).
