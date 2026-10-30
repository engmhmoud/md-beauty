# Lists, Code and Answers

GitHub and MkDocs read lists differently. md-beauty fixes that, so you can write lists the GitHub way.

## Lists written the GitHub way
**Right after a paragraph, no blank line:**
- 2-space nesting
  - works
    - at any depth

1. Three-space indents
   keep the numbering going
2. across items with text,

   paragraphs,

   ```bash
   echo "and code blocks"
   ```
3. so this is still **3**.

## Check yourself `[DEEP]`

1. **Why does a cache make a miss slower than no cache at all?**
   <details><summary>Answer</summary>

   A miss pays for the cache round trip, the source query **and** the write back.

   </details>

2. **Where would you cache a feature-flag set read on every request?**
   <details><summary>Answer</summary>

   In process, with a short TTL, refreshed from Redis.

   </details>
