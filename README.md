# ChatGPT Optimizer + Archiver (Userscript)

**Author:** Matt’s Basement Arcade  
**Versions:** 0.5.x (SemVer)  
**What:** A Tampermonkey userscript that keeps ChatGPT responsive for long coding chats and lets you export selected turns (or just the code blocks) to files.

## Features

- **Keep last N turns** – Older messages are replaced by lightweight placeholders to reduce DOM size and memory pressure.
- **Auto slim** – Re-applies “keep last N” when new content streams or you change chats.
- **Collapse long code** – Clip very long `<pre><code>` blocks with Expand/Collapse controls.
- **Reduce motion** – Disable CSS animations/transitions for smoother scrolling.
- **Selection mode** – Per-turn checkboxes (and on placeholders) to export any subset.
- **Export** – Markdown or JSON. Also “code only” export collects all code fences.
- **Snapshot visible** – Temporarily expands everything and exports what you see.
- **Hard purge** – Permanently remove older nodes from the DOM (best memory relief).
- **Draggable, minimizable control panel** – Remembers its position across reloads.
- **“Sticky”** - expanded turns (won’t re-collapse immediately)

## Install

1. Install Tampermonkey (Chrome/Edge/Firefox).
2. Create a new userscript and paste the code from `chatgpt-optimizer-archiver.user.js`.
3. Visit `https://chatgpt.com/` (or `https://chat.openai.com/`) and open any chat.

## Controls (Options Panel)

- **Keep last N** – How many turns stay visible.
- **Auto** – Apply slimming automatically as the chat updates.
- **Collapse long code** – Clip long code blocks with toggles.
- **Reduce motion** – Remove animations/transitions.
- **Soft Hide Now** – Slim immediately.
- **Expand All** – Restore placeholders to full messages (temporary).
- **Hard Purge** – Permanently remove older nodes.
- **Selection mode** – Show selection checkboxes; also on placeholders.
- **Select All/None** - Bulk toggle current view/selection state.
- **Export selected (MD/JSON/Code)** – Export chosen turns to `*.md` or `*.json`.
- **Export code only** – Just the code fences from selected turns (`*.md`).
- **Snapshot visible (MD)** - Expands all then exports everything visible (`*.md`).
- **Keep last exchange** – Quickly set N=2 and slim.

## How it works

- The script scans the page for chat **turns** (`<article>` nodes with message/testid markers).
- When slimming, older turns are replaced by **placeholders** that weigh far less.
- Clicking a placeholder **expands** it back. Expanded nodes you clicked are marked **sticky** so they aren’t instantly re-collapsed by auto-slim.
- A **MutationObserver** watches the chat container and re-applies slimming/selection overlays when content changes.
- **Exports** are built from the DOM: text, markdowny pieces, and fenced code blocks (with language hint if present).

## Storage & privacy

- **Settings only** are saved in `localStorage` (panel position, toggles, N).  
  Example key: `tm_chatgpt_opt_arch_v062` (subject to change).
- **Chat content is *not* stored** by the script.  
- **No network calls** are made by the script.

## Tips

- For huge threads, use **Hard Purge** every so often.
- Use **Keep last exchange** when coding interactively to minimize DOM size.
- If you switch between many chats quickly and selection boxes disappear, toggle **Selection mode** off/on or wait a second for the observer to re-attach them (or use the build ≥0.5.2 which handles this automatically).

## Troubleshooting

- **401 `/backend-api/.../settings` in console** – Harmless SPA noise. It’s a session/cookie thing unrelated to this userscript.
- **Expanded turn collapses immediately** – Fixed in ≥0.5.2 (sticky + short auto-slim pause).
- **Selection boxes missing** – Make sure **Selection mode** is on; in ≥0.5.2 they re-attach after route changes automatically. You can also toggle Selection mode off/on.

## Changelog

See `CHANGELOG.md`.
