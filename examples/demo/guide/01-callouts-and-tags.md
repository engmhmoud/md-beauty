# Callouts and Tags

**Why it matters:** quotes that start with a bold label turn into colored callouts, so normal notes look like a course.

## Callouts `[MUST]`

> **Builds on:** a quote with a neutral label becomes a blue **info** callout.

> **Tip:** labels like *Tip*, *Takeaway* or *Interview line* become a teal **tip** callout.

> **Trap:** labels like *Trap*, *Warning* or *Don't* become a red **warning** callout.

> [!NOTE]
> GitHub alerts work too: `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`.

## Priority tags `[IMPORTANT]`

Put a tag in inline code and it becomes a pill: `[MUST]` `[IMPORTANT]` `[ARCHITECT]` `[DEEP]`. Tags in headings are kept out of the table of contents.

**Interview line:** "A paragraph that starts with *Interview line:* gets a teal rail on the left."

## Tables `[ARCHITECT]`

| Layer | Example | Typical latency |
|---|---|---|
| CDN | static files, images | ~10 ms |
| Cache | Redis | ~1 ms |
| Database | PostgreSQL | 5–50 ms |
