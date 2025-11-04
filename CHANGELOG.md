# Changelog

All notable changes to **ChatGPT Optimizer + Archiver** will be documented here.  
Versioning: SemVer (feature ⇒ minor, fix ⇒ patch, breaking ⇒ major).

## [0.6.2] - 2025-11-03
### Fixed
- **Soft Hide Now** now ignores “sticky” turns (ones you expanded manually). Works on first run and after you’ve expanded items.
- Selection overlays and placeholder checkboxes stay in sync after expand/collapse.
### Changed
- Stats footer clarifies code density: **Code Blocks: N (in M turns)**.

## [0.6.1] - 2025-11-03
### Fixed
- More robust init on first page load and after React re-mounts; panel reliably reappears.
- Minor race conditions around selection overlay bootstrapping.

## [0.6.0] - 2025-11-03
### Added
- **Colored, info-rich placeholders** for collapsed turns:
  - Role stripe (blue = user, green = assistant) with optional background tint.
  - Badges for **User/Assistant** and **code block count**.
  - Toggle: **Colorize placeholders**.
- **Stats footer** on the panel:
  - Total Turns, Collapsed Turns, Visible Turns, Code Blocks (in X turns).
- **Panel title** shows “ChatGPT Optimizer + Archiver vX.Y.Z”.
### Changed
- Higher-contrast badge styles for readability.
- Hydration-safe UI mount + keep-alive: if the site re-renders, the panel is restored.
### Fixed
- Selection overlay layering/position so it doesn’t block UI.

## [0.5.3] - 2025-11-03
### Changed
- Tampermonkey headers now point to GitHub **releases/latest** for auto-updates:
  - `@downloadURL  https://github.com/MattsBasementArcade/TM-ChatGPToptimizer/releases/latest/download/ChatGPTOptimizer.js`
  - `@updateURL    https://github.com/MattsBasementArcade/TM-ChatGPToptimizer/releases/latest/ChatGPTOptimizer.js`
- Panel title updated to **ChatGPT Optimizer + Archiver**.
### Fixed
- Markdown export edge cases that produced near-empty files.


## [0.5.2] – Sticky + placeholder selection + overlay reapply
- Fix: Expanded turns become **sticky** and don’t re-collapse immediately.
- New: **Select** checkbox on collapsed placeholders (export without expanding).
- Fix: **Selection overlays** re-attach after DOM changes/route switches.
- Fix: Hydration-safe init + keep-alive so the panel persists across route changes.
- Fix: Selection overlays re-attach after DOM mutations.
- Fix: Markdown export now captures user turns (non-.markdown containers) and strips UI noise.
- New: “Sticky” expanded turns don’t immediately re-collapse.
- New: Selection checkboxes on collapsed placeholders (export without expanding).


## [0.5.1] – Draggable/minimizable panel
- New: Control panel is **draggable**; position persists across reloads.
- New: **Minimize/restore** button + header **double-click** to toggle.
- Fix: Panel no longer blocks selection checkboxes (minimize/move out of the way).
- DX: Keeps all 0.4.0 features; no behavioral changes to slimming/export.

## [0.5.0] – Optimizer + Archiver merge
- New: **Selection mode** with per-turn checkboxes.
- New: **Export selected turns** to **Markdown** or **JSON**.
- New: **Export code blocks only** (from selected turns) to Markdown.
- New: **Snapshot visible** → expands everything and exports current DOM to Markdown.
- Change: Adopted robust **turn detection** and **placeholder/restore** technique (inspired by “Thread Slimmer”) for resilience across UI updates.
- Keep: Soft-hide / Hard-purge, **Collapse long code**, **Reduce motion**, “Keep last exchange”.

## [0.4.2] – UI polish + quick actions
- Fix: “Keep last N” input had **white text on white background** in some themes.
- New: **“Keep last exchange”** one-click action (sets N=2 and slims).
- Tweak: Minor style refinements; no functional changes otherwise.

## [0.4.1] – Safety hardening
- Add: `@noframes` (don’t inject into iframes).
- Add: Extra **null/DOM guards** and try/catch around panel build.
- Add: **Debounced MutationObserver** to reduce churn while streaming.
- Tweak: Stricter message-node filter heuristics.

## [0.4.0] – First release (Optimizer)
- New: **Soft-hide** older turns with clickable placeholders.
- New: **Hard-purge** older turns (remove from DOM) for real memory relief.
- New: **Auto-collapse long code** blocks with Expand/Collapse toggle.
- New: **Reduce motion** (disable transitions/animations).
- New: Floating **control panel** with **heap monitor** and basic settings.
