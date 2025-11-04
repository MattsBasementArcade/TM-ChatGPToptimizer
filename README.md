# ChatGPT Optimizer + Archiver (Tampermonkey Userscript)

**Author:** Matt’s Basement Arcade  
**Versions:** 0.5.x (SemVer)  
**What:** A Tampermonkey userscript that keeps ChatGPT responsive for long coding chats and lets you export selected turns (or just the code blocks) to files to improve performance and responsiveness.

## Features / What It does

- **Keep last N** — show only the most recent N turns, earlier ones are replaced with tidy placeholders.
- **Soft Hide Now** — collapse older turns immediately.
  - **v0.6.2:** ignores “sticky” turns so it always works even after you expand items.
- **Auto** — automatically collapses as the conversation grows (respects “sticky”).
- **Sticky turns** — any turn you expand becomes sticky so Auto won’t re-collapse it. (Reset on page reload.)
- **Selection mode** — add checkboxes to turns and placeholders.
  - **Export selected:** Markdown or JSON.
  - **Export code only:** collects only fenced code blocks from the selection.
  - **Snapshot visible:** quick MD export of everything currently expanded.
- **Long code folding** — auto-collapses very tall or very long `<pre>` blocks with an Expand/Collapse toggle.
- **Draggable/minimizable panel** — stays out of your way; remembers position.
- **Colored placeholders** — role stripe + badges for role and code count (toggleable).
- **Stats footer** — Total Turns, Collapsed, Visible, **Code Blocks (in X turns)** for clarity.
- **Reduce motion** toggle for calmer UI.

## Install (Manual)

1. Install Tampermonkey (Chrome/Edge/Firefox).
2. Create a new userscript and paste the code from `chatgpt-optimizer-archiver.user.js`.
3. Visit `https://chatgpt.com/` (or `https://chat.openai.com/`) and open any chat.

## Install (Github)
1. Browser: install **Tampermonkey**.
2. Open this URL to install/update the script:

   - **Auto-update** (releases):  
     `https://github.com/MattsBasementArcade/TM-ChatGPToptimizer/releases/latest/download/ChatGPTOptimizer.js`

3. Supported sites:
   - `https://chat.openai.com/*`
   - `https://chatgpt.com/*`


## Controls (Options Panel)

- **Keep last [N]**: number input (default 8)
- **Auto**: background slimming as new turns arrive
- **Collapse long code**: fold very long/tall code blocks
- **Reduce motion**: disable transitions
- **Colorize placeholders**: tints + role stripe
- **Soft Hide Now**: collapse older turns (ignores sticky; never touches selected)
- **Expand All**: expand all placeholders
- **Hard Purge**: removes older DOM nodes until reload (advanced; destructive UI-only)
- **Selection mode**: toggle selection checkboxes
  - **Select all visible / Select none**
  - **Export selected (MD / JSON / Code only)**
- **Snapshot visible (MD)**
- **Keep last exchange**: sets N=2 and slims (ignores sticky)

## How it works (Under the hood)

- The script scans the page for chat **turns** (`<article>` nodes with message/testid markers).
- When slimming, older turns are replaced by **placeholders** that weigh far less.
- Clicking a placeholder **expands** it back. Expanded nodes you clicked are marked **sticky** so they aren’t instantly re-collapsed by auto-slim.
- A **MutationObserver** watches the chat container and re-applies slimming/selection overlays when content changes.
- **Exports** are built from the DOM: text, markdowny pieces, and fenced code blocks (with language hint if present).
- **Placeholders**: older turns are swapped with light DOM placeholders that include a preview, role badge, and code-block count.
- **Sticky**: if you expand a placeholder, that turn becomes *sticky* (Auto won’t re-collapse it). Sticky state is in-memory only.
- **Selection**: per-turn selection is tracked in-memory. Placeholder and expanded views stay in sync.
- **Storage**: the script stores **only UI preferences** (position, toggles, last N, etc.) in `localStorage` under `tm_chatgpt_opt_arch_v060`.  
  *No chat content is stored; exports are generated on demand and offered as downloads.*

## Storage & privacy

- **Settings only** are saved in `localStorage` (panel position, toggles, N).  
  Example key: `tm_chatgpt_opt_arch_v062` (subject to change).
- **Chat content is *not* stored** by the script.  
- **No network calls** are made by the script.

## Tips

- For huge threads, use **Hard Purge** every so often.
- Use **Keep last exchange** when coding interactively to minimize DOM size.
- If you switch between many chats quickly and selection boxes disappear, toggle **Selection mode** off/on or wait a second for the observer to re-attach them (or use the build ≥0.5.2 which handles this automatically).

## Privacy & permissions

- No network requests; no external libraries.
- Operates entirely on the current page DOM.
- Export happens client-side (Blob download).


## Troubleshooting

- **Selection boxes missing** – Make sure **Selection mode** is on; in ≥0.5.2 they re-attach after route changes automatically. You can also toggle Selection mode off/on.

- **Panel disappears** during navigation: it should restore automatically (hydration keep-alive). If not, reload the page.
- **Soft Hide Now has no effect**: ensure you’re on **v0.6.2+**; this version explicitly ignores sticky.
- **Selection checkboxes missing**: toggle **Selection mode** off/on once to re-bind (rare after heavy UI changes).
- **Counts look “off”**: A single turn can include multiple code blocks (e.g., 1 turn with 8 code blocks). The footer shows `Code Blocks (in X turns)` to clarify density.



## Testing Environment
- This script was developed and tested under the following:
  - Chrome 141.0.7390.108 (Official Build) (64-bit)
  - Version 142.0.7444.60 (Official Build) (64-bit)
  - Tampermonkey v5.4.0


## Versioning / Changelog

- **0.6.2**: Soft Hide Now ignores sticky; sync fixes; clearer stats.
- **0.6.1**: Robust init/hydration stability; overlay timing fixes.
- **0.6.0**: Colored placeholders with badges, stats footer, title versioning, better contrast; keep-alive.
- **0.5.3**: Release-based auto-update URLs; Markdown export fixes.
- See **CHANGELOG.md** for details.

## License

MIT © Matt's Basement Arcade

