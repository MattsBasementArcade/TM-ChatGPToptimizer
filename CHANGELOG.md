# Changelog

All notable changes to **ChatGPT Optimizer + Archiver** will be documented here.  
Versioning: SemVer (feature ⇒ minor, fix ⇒ patch, breaking ⇒ major).

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
