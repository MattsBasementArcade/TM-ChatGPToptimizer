// ==UserScript==
// @name         ChatGPT Optimizer + Archiver (keep last N, select+export, draggable panel)
// @namespace    https://github.com/MattsBasementArcade/TM-ChatGPToptimizer
// @version      0.6.2
// @description  Keep chats snappy for long code, plus select and export chat turns or code blocks. Draggable/minimizable control panel.
// @author       Matt's Basement Arcade
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/MattsBasementArcade/TM-ChatGPToptimizer
// @supportURL   https://github.com/MattsBasementArcade/TM-ChatGPToptimizer/issues
// @downloadURL  https://github.com/MattsBasementArcade/TM-ChatGPToptimizer/releases/latest/download/ChatGPTOptimizer.js
// @updateURL    https://github.com/MattsBasementArcade/TM-ChatGPToptimizer/releases/latest/ChatGPTOptimizer.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.6.2';

  // ------------------------------------------------------------
  // Settings (UI prefs only; no chat content is stored)
  // ------------------------------------------------------------
  const LS = 'tm_chatgpt_opt_arch_v060';
  const defaults = {
    keepLastN: 8,
    autoSlim: true,
    collapseLongCode: true,
    codeLineThreshold: 120,
    codeHeightThreshold: 600,
    reduceMotion: false,
    selectionMode: false,
    panelX: 12,
    panelY: 12,
    panelMin: false,
    colorizePlaceholders: true,
  };
  let st = load();
  function load() { try { return { ...defaults, ...(JSON.parse(localStorage.getItem(LS) || '{}')) }; } catch { return { ...defaults }; } }
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch {} }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const nowISO = () => new Date().toISOString().replace(/[:.]/g, '-');
  const raf = (fn)=> (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1000 }) : requestAnimationFrame(fn));

  function detectRole(node){
    let role = node.getAttribute('data-message-author-role') ||
               node.querySelector('[data-message-author-role]')?.getAttribute?.('data-message-author-role') || '';
    if (!role) role = node.querySelector('pre, code, .markdown, [data-message-author-role="assistant"]') ? 'assistant' : 'user';
    return role === 'assistant' ? 'assistant' : 'user';
  }

  // Panel keep-alive (in case React remounts the page)
  let uiKeepAliveTimer = null;
  function startUIKeepAlive(){
    if (uiKeepAliveTimer) return;
    uiKeepAliveTimer = setInterval(() => {
      if (!document.getElementById('tm-panel')) {
        try { ensureStyles(); buildUI(); applyReduceMotion(st.reduceMotion); updateStats(); } catch {}
      }
    }, 1000);
  }

  // Wait for hydration
  function afterHydration(cb, timeoutMs = 8000){
    const t0 = Date.now();
    (function tick(){
      const hydrated = document.querySelector('main')?.querySelector('*');
      if (hydrated) return cb();
      if (Date.now() - t0 > timeoutMs) return cb();
      setTimeout(tick, 120);
    })();
  }

  // ------------------------------------------------------------
  // Per-turn meta (selection + sticky) — in-memory only
  // ------------------------------------------------------------
  const Meta = new WeakMap(); // node -> { selected?: boolean, sticky?: boolean }
  function stateFor(n){ let s=Meta.get(n); if(!s){s={}; Meta.set(n,s);} return s; }
  function isSticky(n){ return !!stateFor(n).sticky; }
  function setSticky(n,v){ stateFor(n).sticky = !!v; }
  function isSelected(n){ return !!stateFor(n).selected; }
  function setSelected(n,v){ stateFor(n).selected = !!v; }

  // ------------------------------------------------------------
  // Turn discovery & slimmer
  // ------------------------------------------------------------
  const Store = new WeakMap(); // placeholder -> original turn
  let running = false, mo = null, currentRoot = null;
  let suspendUntil = 0;

  function suspend(ms=10000){ suspendUntil = Date.now() + ms; }
  function findMessageContainer(){ return $('main') || document.body; }

  function getTurns(){
    const root = findMessageContainer();
    if (!root) return [];
    const candidates = $$('article[data-message-id], article[data-testid^="conversation-turn"], article', root);
    const turns = candidates.filter(el => {
      const r = el.getBoundingClientRect?.() || { width:1, height:1 };
      return (el.offsetParent !== null) || (r.width > 0 && r.height > 0);
    });
    return turns.length ? turns : $$('.text-base', root);
  }

  // -------- placeholders (selection-aware & colored) --------
  function makePlaceholder(node, idx, total){
    const role = detectRole(node);
    const codeCount = $$('pre', node).length;
    const previewRoot = node.querySelector('.markdown,.whitespace-pre-wrap') || node;
    const previewText = (previewRoot.innerText || '').replace(/\s+/g,' ').trim().slice(0, 140);
    const tintClass = st.colorizePlaceholders ? ' tint' : '';

    const ph = document.createElement('div');
    ph.className = 'tm-ph' + tintClass + (role === 'assistant' ? ' role-assistant' : ' role-user') + (codeCount ? ' codeheavy' : '');
    ph.dataset.role = role;
    ph.dataset.code = String(codeCount);
    ph.setAttribute('role', 'button');
    ph.setAttribute('tabindex', '0');

    ph.innerHTML = `
      <div class="tm-ph-inner">
        <span class="tm-ph-text">${previewText ? previewText : `Collapsed turn (${idx}/${total}) — click to expand`}</span>
        <div class="tm-badges">
          <span class="tm-badge role-${role}">${role === 'assistant' ? 'Assistant' : 'User'}</span>
          ${codeCount ? `<span class="tm-badge code">${codeCount} code</span>` : ''}
        </div>
        <label class="tm-ph-sel">
          <input type="checkbox" class="tm-ph-cb">
          <span>Select</span>
        </label>
      </div>
    `;

    ph.addEventListener('click', (e) => {
      if (e.target?.classList?.contains('tm-ph-cb') || e.target?.closest?.('.tm-ph-sel')) return;
      expand(ph);
    });
    ph.addEventListener('keydown', (e)=>{ if (e.key === ' ' || e.key === 'Enter') expand(ph); });

    const cb = ph.querySelector('.tm-ph-cb');
    if (cb) {
      cb.checked = isSelected(node);
      cb.addEventListener('change', ()=> {
        setSelected(node, cb.checked);
        ph.style.borderColor = cb.checked ? '#60a5fa' : '';
        updateStats();
      });
      if (cb.checked) ph.style.borderColor = '#60a5fa';
    }

    return ph;
  }

  function refreshPlaceholderStyles(){ $$('.tm-ph').forEach(ph => ph.classList.toggle('tint', !!st.colorizePlaceholders)); }

  function collapse(node, idx, total){
    if (!node || node.__tmCollapsed) return;
    const ph = makePlaceholder(node, idx, total);
    Store.set(ph, node);
    node.__tmCollapsed = true;
    node.replaceWith(ph);
    updateStats();
  }

  function expand(ph){
    const node = Store.get(ph);
    if (!node) return;
    node.__tmCollapsed = false;
    ph.replaceWith(node);
    Store.delete(ph);
    setSticky(node, true);      // expanded turns become sticky
    suspend(2000);              // gentle cooldown to avoid thrash
    if (st.selectionMode) ensureSelectionOverlay(node);
    updateStats();
  }

  function expandAll(){
    suspend(10000);
    $$('.tm-ph').forEach(expand);
    updateStats();
  }

  // ⬇️ MAIN CHANGE: allow Soft Hide to ignore sticky
  function slimNow(opts = {}){
    const { force = false, ignoreSticky = false } = (typeof opts === 'boolean' ? { force: opts } : opts);
    if (running) return;
    if (!force && Date.now() < suspendUntil) return;
    running = true;
    raf(() => {
      try {
        reobserveIfNeeded();
        const turns = getTurns();
        if (!turns.length) return;
        const keep = Math.max(1, parseInt(st.keepLastN,10)||0);
        const total = turns.length;
        const cutoff = Math.max(0, total - keep);
        for (let i=0; i<cutoff; i++) {
          const el = turns[i];
          if (!el || el.__tmCollapsed) continue;
          if (isSelected(el)) continue;                // never collapse selected
          if (isSticky(el) && !ignoreSticky) continue; // respect sticky unless overridden
          collapse(el, i+1, total);
        }
      } finally { running = false; updateStats(); }
    });
  }

  // Robust “Soft Hide Now”: wait for turns on first run, then slim ignoring sticky.
  function softHideNow(){
    let tries = 0;
    (function tick(){
      const turns = getTurns();
      if (turns.length || tries > 25) { // ~3s worst case
        slimNow({ force:true, ignoreSticky:true });
      } else {
        tries++; setTimeout(tick, 120);
      }
    })();
  }

  function reobserveIfNeeded(){
    const root = findMessageContainer();
    if (!root || root === currentRoot) return;
    currentRoot = root;
    mo && mo.disconnect();
    mo = new MutationObserver(muts => {
      if (!st.autoSlim) return;
      if (Date.now() < suspendUntil) return;
      const changed = muts.some(m => m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length));
      if (changed) {
        clearTimeout(reobserveIfNeeded._t);
        reobserveIfNeeded._t = setTimeout(() => {
          slimNow();                // auto mode respects sticky
          ensureSelectionOverlays();
          updateStats();
        }, 150);
      }
    });
    mo.observe(currentRoot, { childList: true, subtree: true });
  }
  setInterval(reobserveIfNeeded, 1000);

  // ------------------------------------------------------------
  // Long-code collapse
  // ------------------------------------------------------------
  function collapseLongCode(root=document){
    if (!st.collapseLongCode) return;
    $$('pre', root).forEach(pre => {
      if (!pre || pre.dataset.tmClip === '1') return;
      const code = pre.querySelector('code') || pre;
      const text = code.innerText || '';
      const lines = text.split('\n').length;
      const tall = (pre.getBoundingClientRect?.().height || 0) > st.codeHeightThreshold;
      if (!(tall || lines >= st.codeLineThreshold)) return;

      const wrap = document.createElement('div');
      wrap.className = 'tm-code-wrap';
      wrap.style.position = 'relative';
      wrap.style.border = '1px solid rgba(127,127,127,.2)';
      wrap.style.borderRadius = '12px';
      wrap.style.margin = '8px 0';
      wrap.style.overflow = 'hidden';

      const clip = document.createElement('div');
      clip.className = 'tm-code-clip';
      clip.style.maxHeight = '300px';
      clip.style.overflow = 'auto';

      const bar = document.createElement('div');
      bar.className = 'tm-code-bar';
      bar.style.position = 'absolute';
      bar.style.right = '8px';
      bar.style.top = '8px';
      bar.style.display = 'flex';
      bar.style.gap = '8px';
      const b = (t,fn)=>{ const x=document.createElement('button'); x.textContent=t; x.style.fontSize='12px'; x.style.padding='4px 8px'; x.style.border='1px solid rgba(127,127,127,.4)'; x.style.borderRadius='8px'; x.style.background='rgba(240,240,240,.5)'; x.style.cursor='pointer'; x.addEventListener('click',fn); return x; };
      const btnExp = b('Expand', ()=>set(false));
      const btnCol = b('Collapse', ()=>set(true)); btnCol.style.display = 'none';

      pre.parentNode.insertBefore(wrap, pre);
      wrap.append(bar, clip);
      clip.append(pre);
      pre.dataset.tmClip = '1';
      set(true);

      function set(collapsed){
        clip.style.maxHeight = collapsed ? '300px' : 'none';
        btnExp.style.display = collapsed ? '' : 'none';
        btnCol.style.display = collapsed ? 'none' : '';
      }
    });
    updateStats();
  }

  // ------------------------------------------------------------
  // Selection & Export
  // ------------------------------------------------------------
  function ensureSelectionOverlay(el){
    if (!st.selectionMode || !el || !el.isConnected) return;
    let box = el.querySelector(':scope > .tm-select');
    if (box) return;

    box = document.createElement('label');
    box.className = 'tm-select';
    box.innerHTML = `<input type="checkbox"><span>Select</span>`;
    Object.assign(box.style, {
      position:'absolute', right:'8px', top:'8px', zIndex:'2',
      display:'flex', gap:'6px', alignItems:'center',
      background:'rgba(28,28,28,.85)', color:'#fff',
      border:'1px solid rgba(255,255,255,.2)', borderRadius:'10px', padding:'4px 8px'
    });

    const cb = box.querySelector('input');
    cb.checked = isSelected(el);
    cb.addEventListener('change', e => {
      setSelected(el, e.target.checked);
      el.classList.toggle('tm-selected', e.target.checked);
      updateStats();
    });

    el.style.position = el.style.position || 'relative';
    el.prepend(box);
  }

  function ensureSelectionOverlays(){ if (st.selectionMode) getTurns().forEach(ensureSelectionOverlay); }

  function toggleSelectionMode(on){
    st.selectionMode = !!on;
    save();
    if (st.selectionMode) {
      ensureSelectionOverlays();
    } else {
      getTurns().forEach(el => {
        el.classList.remove('tm-selected');
        el.querySelector(':scope > .tm-select')?.remove();
      });
    }
    updateStats();
  }

  function selectedTurns(){
    const turns = getTurns();
    const selectedVisible = turns.filter(t =>
      t.classList.contains('tm-selected') ||
      isSelected(t) ||
      !!t.querySelector(':scope > .tm-select input:checked')
    );
    const selectedFromPH = $$('.tm-ph .tm-ph-cb:checked')
      .map(cb => Store.get(cb.closest('.tm-ph')))
      .filter(Boolean);

    const seen = new Set(), out = [];
    [...selectedVisible, ...selectedFromPH].forEach(n => { if (n && !seen.has(n)) { seen.add(n); out.push(n); } });
    return out.length ? out : turns.slice(-Math.max(1, parseInt(st.keepLastN,10)||1));
  }

  function extractTurn(turn){
    let role = turn.getAttribute('data-message-author-role') ||
               turn.querySelector('[data-message-author-role]')?.getAttribute?.('data-message-author-role') || '';
    if (!role) role = turn.querySelector('pre, code, .markdown, [data-message-author-role="assistant"]') ? 'assistant' : 'user';

    const heading = turn.querySelector('h1,h2,h3')?.innerText?.trim();
    const contentRoot =
      turn.querySelector('.markdown') ||
      turn.querySelector('.whitespace-pre-wrap') ||
      turn;

    const mdParts = [];

    $$('.markdown p, .markdown li, .markdown blockquote, p, li, blockquote', contentRoot).forEach(el => {
      if (el.closest('.tm-select')) return;
      let t = (el.innerText || '').replace(/\u00A0/g, ' ').trim();
      if (!t) return;
      if (t === 'Select' || t === 'Copy code' || t === 'You said:' || /^Send$/i.test(t)) return;
      if (el.tagName === 'LI' && !el.closest('.markdown')) t = `- ${t}`;
      mdParts.push(t);
    });

    $$('.markdown table', contentRoot).forEach(table => {
      const rows = $$('tr', table).map(tr =>
        $$('th,td', tr).map(td => (td.innerText || '').replace(/\|/g, '\\|').trim())
      );
      if (rows.length) {
        const header = rows.shift();
        mdParts.push(`| ${header.join(' | ')} |`);
        mdParts.push(`| ${header.map(() => '---').join(' | ')} |`);
        rows.forEach(r => mdParts.push(`| ${r.join(' | ')} |`));
      }
    });

    if (!mdParts.length) {
      const lines = (contentRoot.innerText || '').split('\n')
        .map(s => s.replace(/\u00A0/g, ' ').trim())
        .filter(Boolean)
        .filter(s => s !== 'Select' && s !== 'Copy code' && s !== 'You said:' && !/^Send$/i.test(s));
      if (lines.length) mdParts.push(lines.join('\n\n'));
    }

    const codeBlocks = [];
    $$('pre', turn).forEach(pre => {
      const code = pre.querySelector('code') || pre;
      if (!code || code.closest('.tm-select')) return;
      const text = code.innerText || '';
      if (!text.trim()) return;
      const lang = (code.className.match(/language-([\w+-]+)/)?.[1]) || '';
      codeBlocks.push({ lang, text });
    });

    const md = [
      `### ${role === 'user' ? 'User' : 'Assistant'} ${heading ? `— ${heading}` : ''}`.trim(),
      mdParts.join('\n\n'),
      ...codeBlocks.map(cb => '```' + cb.lang + '\n' + cb.text + '\n```')
    ].filter(Boolean).join('\n\n');

    return {
      role,
      heading: heading || null,
      markdown: md,
      text: (contentRoot.innerText || '').trim(),
      codeBlocks
    };
  }

  function exportSelected({ format='md', codeOnly=false }={}){
    const sel = selectedTurns();
    const data = sel.map(extractTurn);
    const title = (document.title || 'ChatGPT Conversation').replace(/[^\w.-]+/g,'_').slice(0,80);
    const stamp = nowISO();

    if (codeOnly) {
      const out = data.flatMap((t,i) => {
        if (!t.codeBlocks.length) return [];
        const header = `\n\n----- Turn ${i+1} (${t.role}) -----\n\n`;
        const codes = t.codeBlocks.map(cb => '```' + (cb.lang||'') + '\n' + cb.text + '\n```').join('\n\n');
        return [header + codes];
      }).join('\n');
      return download(`${title}__codeblocks__${stamp}.md`, out || '*No code blocks in selection.*');
    }

    if (format === 'json') {
      const out = JSON.stringify({ title: document.title, exportedAt: new Date().toISOString(), turns: data }, null, 2);
      return download(`${title}__selection__${stamp}.json`, out);
    }

    const md = [
      `# ${document.title || 'ChatGPT Conversation'}`,
      `_Exported ${new Date().toLocaleString()}_`,
      '',
      ...data.map(t => t.markdown)
    ].join('\n');
    return download(`${title}__selection__${stamp}.md`, md);
  }

  function snapshotVisible(){
    expandAll();
    const turns = getTurns();
    const title = (document.title || 'ChatGPT Conversation').replace(/[^\w.-]+/g,'_').slice(0,80);
    const stamp = nowISO();
    const md = [
      `# ${document.title || 'ChatGPT Conversation'}`,
      `_Snapshot ${new Date().toLocaleString()}_`,
      '',
      ...turns.map((t, i) => extractTurn(t, i).markdown)
    ].join('\n');
    return download(`${title}__snapshot__${stamp}.md`, md);
  }

  function download(filename, content){
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    requestAnimationFrame(() => { a.remove(); URL.revokeObjectURL(url); });
  }

  // ------------------------------------------------------------
  // Reduce motion
  // ------------------------------------------------------------
  function applyReduceMotion(on){
    const id = 'tm-reduce-motion-style';
    let style = $('#'+id);
    if (on && !style) {
      style = document.createElement('style');
      style.id = id;
      style.textContent = `*{animation:none!important;transition:none!important}`;
      document.head.appendChild(style);
    } else if (!on && style) style.remove();
  }

  // ------------------------------------------------------------
  // UI (draggable + minimize) + styles
  // ------------------------------------------------------------
  function ensureStyles(){
    if ($('#tm-style')) return;
    const css = document.createElement('style');
    css.id = 'tm-style';
    css.textContent = `
      .tm-panel{position:fixed;z-index:2147483647;background:rgba(28,28,28,.95);color:#fff;border-radius:14px;backdrop-filter:blur(4px);box-shadow:0 6px 24px rgba(0,0,0,.2);width:max-content;max-width:360px}
      .tm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;cursor:move}
      .tm-title{font-weight:700}
      .tm-head .tm-iconbtn{border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:2px 6px;cursor:pointer}
      .tm-body{padding:6px 10px}
      .tm-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
      .tm-panel label{display:flex;align-items:center;gap:6px}
      .tm-panel input[type=number]{width:72px;padding:4px 6px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#fff;color:#111}
      .tm-btn{font-size:12px;padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.1);color:#fff;cursor:pointer}
      .tm-btn.danger{background:rgba(200,40,40,.9)}
      .tm-select{user-select:none}
      .tm-selected{outline:2px solid #60a5fa;outline-offset:2px;border-radius:12px}
      .tm-min .tm-body{display:none}
      .tm-min{width:auto}
      .tm-footer{padding:8px 10px;border-top:1px solid rgba(255,255,255,.12);display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#e5e7eb}

      /* Collapsed placeholder */
      .tm-ph{position:relative;margin:8px 0;border:1px dashed #777;border-radius:10px;padding:10px;background:rgba(245,245,250,.6);overflow:hidden}
      .tm-ph-inner{display:flex;align-items:center;gap:10px;min-height:40px;font-size:12px;color:#1f2937}
      .tm-ph .tm-ph-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
      .tm-ph .tm-ph-sel{margin-left:10px;display:flex;gap:6px;align-items:center;cursor:pointer}
      .tm-code-wrap .tm-code-bar button{color:#111}

      /* Left color stripe */
      .tm-ph::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:10px 0 0 10px;background:var(--tm-ph-stripe,#777)}
      .tm-ph.role-user{--tm-ph-stripe:#3b82f6}
      .tm-ph.role-assistant{--tm-ph-stripe:#10b981}
      .tm-ph.codeheavy{box-shadow: inset 0 0 0 1px rgba(245,158,11,.35)}

      /* Per-role subtle tints (toggle-able) */
      .tm-ph.tint.role-user{background:linear-gradient(0deg, rgba(59,130,246,.12), rgba(245,245,250,.6))}
      .tm-ph.tint.role-assistant{background:linear-gradient(0deg, rgba(16,185,129,.12), rgba(245,245,250,.6))}

      /* Badges — increased contrast */
      .tm-badges{display:flex;gap:6px;margin-left:auto;align-items:center}
      .tm-badge{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;border:1px solid transparent}
      .tm-badge.role-user{background:#3b82f6;color:#fff;border-color:#2f6fcc}
      .tm-badge.role-assistant{background:#10b981;color:#fff;border-color:#0e8f6c}
      .tm-badge.code{background:#f59e0b;color:#111;border-color:#b45309}
    `;
    document.head.appendChild(css);
  }

  function buildUI(){
    if ($('#tm-panel')) return;
    const p = document.createElement('div');
    p.id = 'tm-panel';
    p.className = 'tm-panel' + (st.panelMin ? ' tm-min' : '');
    p.style.top = (st.panelY|0) + 'px';
    p.style.left = (st.panelX|0) + 'px';

    p.innerHTML = `
      <div class="tm-head" id="tm-head">
        <span class="tm-title">ChatGPT Optimizer + Archiver v${VERSION}</span>
        <div>
          <button id="tm-min" class="tm-iconbtn" title="Minimize/Restore">${st.panelMin ? '▢' : '–'}</button>
        </div>
      </div>
      <div class="tm-body">
        <div class="tm-row">
          <label>Keep last</label>
          <input id="tm-keep" type="number" min="1" max="200" step="1" value="${st.keepLastN}">
          <label><input id="tm-auto" type="checkbox" ${st.autoSlim ? 'checked' : ''}>Auto</label>
          <label><input id="tm-collapse" type="checkbox" ${st.collapseLongCode ? 'checked' : ''}>Collapse long code</label>
          <label><input id="tm-motion" type="checkbox" ${st.reduceMotion ? 'checked' : ''}>Reduce motion</label>
          <label><input id="tm-colorph" type="checkbox" ${st.colorizePlaceholders ? 'checked' : ''}>Colorize placeholders</label>
        </div>

        <div class="tm-row">
          <button id="tm-hide" class="tm-btn">Soft Hide Now</button>
          <button id="tm-expand" class="tm-btn">Expand All</button>
          <button id="tm-purge" class="tm-btn danger">Hard Purge</button>
        </div>

        <div class="tm-row">
          <label><input id="tm-selectmode" type="checkbox" ${st.selectionMode ? 'checked' : ''}>Selection mode</label>
          <button id="tm-selectall" class="tm-btn">Select all visible</button>
          <button id="tm-selectnone" class="tm-btn">Select none</button>
        </div>

        <div class="tm-row">
          <button id="tm-export-md" class="tm-btn">Export selected (MD)</button>
          <button id="tm-export-json" class="tm-btn">Export selected (JSON)</button>
          <button id="tm-export-code" class="tm-btn">Export code only</button>
        </div>

        <div class="tm-row">
          <button id="tm-snapshot" class="tm-btn">Snapshot visible (MD)</button>
          <button id="tm-last2" class="tm-btn">Keep last exchange</button>
        </div>
      </div>
      <div class="tm-footer">
        <div>Total Turns: <b id="tm-stat-total">0</b></div>
        <div>Collapsed Turns: <b id="tm-stat-collapsed">0</b></div>
        <div>Visible Turns: <b id="tm-stat-visible">0</b></div>
        <div>Code Blocks: <b id="tm-stat-code">0</b> <span style="opacity:.8">(in <span id="tm-stat-code-turns">0</span> turns)</span></div>
      </div>
    `;
    document.body.appendChild(p);

    // Controls
    $('#tm-keep').addEventListener('change', e => { st.keepLastN = Math.max(1, (+e.target.value||8)); save(); if (st.autoSlim) slimNow(); });
    $('#tm-auto').addEventListener('change', e => { st.autoSlim = !!e.target.checked; save(); if (st.autoSlim) slimNow(); });
    $('#tm-collapse').addEventListener('change', e => { st.collapseLongCode = !!e.target.checked; save(); collapseLongCode(document); });
    $('#tm-motion').addEventListener('change', e => { st.reduceMotion = !!e.target.checked; save(); applyReduceMotion(st.reduceMotion); });
    $('#tm-colorph').addEventListener('change', e => { st.colorizePlaceholders = !!e.target.checked; save(); refreshPlaceholderStyles(); });

    $('#tm-hide').addEventListener('click', ()=> softHideNow());                     // ⬅️ ignore sticky
    $('#tm-expand').addEventListener('click', ()=> { expandAll(); updateStats(); });
    $('#tm-purge').addEventListener('click', ()=> {
      const turns = getTurns();
      const keep = Math.max(1, parseInt(st.keepLastN,10)||1);
      const older = turns.slice(0, Math.max(0, turns.length - keep));
      if (!older.length) return;
      if (!confirm(`Hard purge will remove ${older.length} older nodes from the DOM until reload. Continue?`)) return;
      older.forEach(n => n.remove());
      updateStats();
    });

    $('#tm-selectmode').addEventListener('change', e => toggleSelectionMode(e.target.checked));
    $('#tm-selectall').addEventListener('click', () => {
      toggleSelectionMode(true);
      getTurns().forEach(t => {
        setSelected(t, true);
        const cb = t.querySelector(':scope > .tm-select input'); if (cb) cb.checked = true;
        t.classList.add('tm-selected');
      });
      $$('.tm-ph .tm-ph-cb').forEach(cb => { cb.checked = true; cb.closest('.tm-ph').style.borderColor='#60a5fa'; });
      updateStats();
    });
    $('#tm-selectnone').addEventListener('click', () => {
      getTurns().forEach(t => {
        setSelected(t, false);
        const cb = t.querySelector(':scope > .tm-select input'); if (cb) cb.checked = false;
        t.classList.remove('tm-selected');
      });
      $$('.tm-ph .tm-ph-cb').forEach(cb => { cb.checked = false; cb.closest('.tm-ph').style.borderColor=''; });
      updateStats();
    });

    $('#tm-export-md').addEventListener('click', ()=> exportSelected({ format:'md' }));
    $('#tm-export-json').addEventListener('click', ()=> exportSelected({ format:'json' }));
    $('#tm-export-code').addEventListener('click', ()=> exportSelected({ codeOnly:true }));
    $('#tm-snapshot').addEventListener('click', ()=> snapshotVisible());
    $('#tm-last2').addEventListener('click', () => {
      st.keepLastN = 2; save();
      $('#tm-keep').value = 2;
      expandAll();
      slimNow({ force:true, ignoreSticky:true });      // ⬅️ also ignore sticky
    });

    // Minimize / restore
    $('#tm-min').addEventListener('click', () => setMinimized(!st.panelMin));
    $('#tm-head').addEventListener('dblclick', () => setMinimized(!st.panelMin));

    // Dragging
    makeDraggable(p, $('#tm-head'));

    // Keep on-screen if window resizes
    window.addEventListener('resize', clampPanelIntoView);
    clampPanelIntoView();
    syncMinBtn();
    updateStats();
  }

  function setMinimized(on){
    const p = $('#tm-panel'); if (!p) return;
    st.panelMin = !!on; save();
    p.classList.toggle('tm-min', st.panelMin);
    syncMinBtn();
  }
  function syncMinBtn(){ const b = $('#tm-min'); if (b) b.textContent = st.panelMin ? '▢' : '–'; }
  function clampPanelIntoView(){
    const p = $('#tm-panel'); if (!p) return;
    const r = p.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = Math.min(Math.max(8, r.left), vw - Math.min(r.width, 300));
    let y = Math.min(Math.max(8, r.top),  vh - 40);
    p.style.left = x + 'px'; p.style.top = y + 'px';
    st.panelX = Math.round(x); st.panelY = Math.round(y); save();
  }
  function makeDraggable(elm, handle){
    let sx=0, sy=0, ox=0, oy=0, dragging=false;
    (handle||elm).addEventListener('mousedown',e=>{
      dragging = true; sx = e.clientX; sy = e.clientY;
      const r = elm.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove',e=>{
      if (!dragging) return;
      const nx = Math.max(0, ox + (e.clientX - sx));
      const ny = Math.max(0, oy + (e.clientY - sy));
      elm.style.left = nx + 'px'; elm.style.top = ny + 'px';
    });
    window.addEventListener('mouseup',()=>{
      if (!dragging) return;
      dragging = false;
      const r = elm.getBoundingClientRect();
      st.panelX = Math.round(r.left); st.panelY = Math.round(r.top); save();
      clampPanelIntoView();
    });
  }

  // ------------------------------------------------------------
  // Stats footer
  // ------------------------------------------------------------
  function updateStats(){
    const visibleTurns = getTurns();
    const ph = $$('.tm-ph');
    const total = visibleTurns.length + ph.length;

    let codeBlocks = 0;
    let turnsWithCode = 0;

    visibleTurns.forEach(t => {
      const c = $$('pre', t).length;
      codeBlocks += c;
      if (c > 0) turnsWithCode++;
    });
    ph.forEach(x => {
      const c = parseInt(x.dataset.code || '0', 10) || 0;
      codeBlocks += c;
      if (c > 0) turnsWithCode++;
    });

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    set('tm-stat-total', total);
    set('tm-stat-collapsed', ph.length);
    set('tm-stat-visible', visibleTurns.length);
    set('tm-stat-code', codeBlocks);
    set('tm-stat-code-turns', turnsWithCode);
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  function ensureStyles(){
    if ($('#tm-style')) return;
    const css = document.createElement('style');
    css.id = 'tm-style';
    css.textContent = `
      .tm-panel{position:fixed;z-index:2147483647;background:rgba(28,28,28,.95);color:#fff;border-radius:14px;backdrop-filter:blur(4px);box-shadow:0 6px 24px rgba(0,0,0,.2);width:max-content;max-width:360px}
      .tm-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;cursor:move}
      .tm-title{font-weight:700}
      .tm-head .tm-iconbtn{border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.1);color:#fff;border-radius:8px;padding:2px 6px;cursor:pointer}
      .tm-body{padding:6px 10px}
      .tm-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
      .tm-panel label{display:flex;align-items:center;gap:6px}
      .tm-panel input[type=number]{width:72px;padding:4px 6px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#fff;color:#111}
      .tm-btn{font-size:12px;padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.1);color:#fff;cursor:pointer}
      .tm-btn.danger{background:rgba(200,40,40,.9)}
      .tm-select{user-select:none}
      .tm-selected{outline:2px solid #60a5fa;outline-offset:2px;border-radius:12px}
      .tm-min .tm-body{display:none}
      .tm-min{width:auto}
      .tm-footer{padding:8px 10px;border-top:1px solid rgba(255,255,255,.12);display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#e5e7eb}

      .tm-ph{position:relative;margin:8px 0;border:1px dashed #777;border-radius:10px;padding:10px;background:rgba(245,245,250,.6);overflow:hidden}
      .tm-ph-inner{display:flex;align-items:center;gap:10px;min-height:40px;font-size:12px;color:#1f2937}
      .tm-ph .tm-ph-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
      .tm-ph .tm-ph-sel{margin-left:10px;display:flex;gap:6px;align-items:center;cursor:pointer}
      .tm-code-wrap .tm-code-bar button{color:#111}

      .tm-ph::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:10px 0 0 10px;background:var(--tm-ph-stripe,#777)}
      .tm-ph.role-user{--tm-ph-stripe:#3b82f6}
      .tm-ph.role-assistant{--tm-ph-stripe:#10b981}
      .tm-ph.codeheavy{box-shadow: inset 0 0 0 1px rgba(245,158,11,.35)}

      .tm-ph.tint.role-user{background:linear-gradient(0deg, rgba(59,130,246,.12), rgba(245,245,250,.6))}
      .tm-ph.tint.role-assistant{background:linear-gradient(0deg, rgba(16,185,129,.12), rgba(245,245,250,.6))}

      .tm-badges{display:flex;gap:6px;margin-left:auto;align-items:center}
      .tm-badge{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;border:1px solid transparent}
      .tm-badge.role-user{background:#3b82f6;color:#fff;border-color:#2f6fcc}
      .tm-badge.role-assistant{background:#10b981;color:#fff;border-color:#0e8f6c}
      .tm-badge.code{background:#f59e0b;color:#111;border-color:#b45309}
    `;
    document.head.appendChild(css);
  }

  function init(){
    ensureStyles();
    afterHydration(() => {
      buildUI();
      applyReduceMotion(st.reduceMotion);
      collapseLongCode(document);
      reobserveIfNeeded();
      if (st.autoSlim) slimNow(); // auto respects sticky
      ensureSelectionOverlays();
      startUIKeepAlive();
      updateStats();
      setInterval(updateStats, 1500);
      console.log('[ChatGPT Optimizer + Archiver]', VERSION, 'ready (hydration-safe)');
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
