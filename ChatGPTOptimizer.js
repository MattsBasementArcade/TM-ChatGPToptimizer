// ==UserScript==
// @name         ChatGPT Optimizer + Archiver (keep last N, select+export, draggable panel)
// @namespace    https://github.com/MattsBasementArcade/TM-ChatGPToptimizer
// @version      0.5.3
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
// @downloadURL  https://raw.githubusercontent.com/MattsBasementArcade/TM-ChatGPToptimizer/main/ChatGPTOptimizer.user.js
// @updateURL    https://raw.githubusercontent.com/MattsBasementArcade/TM-ChatGPToptimizer/main/ChatGPTOptimizer.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------
  // Settings (only UI prefs; chat content is never stored)
  // ------------------------------------------------------------
  const LS = 'tm_chatgpt_opt_arch_v052';
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
    panelMin: false
  };
  let st = load();
  function load() {
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem(LS) || '{}')) }; }
    catch { return { ...defaults }; }
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(st)); } catch {} }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const nowISO = () => new Date().toISOString().replace(/[:.]/g, '-');
  const raf = (fn)=> (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1000 }) : requestAnimationFrame(fn));

  // Panel keep-alive: if React/route swaps remove our UI, quietly restore it.
  let uiKeepAliveTimer = null;
  function startUIKeepAlive(){
    if (uiKeepAliveTimer) return;
    uiKeepAliveTimer = setInterval(() => {
      if (!document.getElementById('tm-panel')) {
        try {
          ensureStyles();
          buildUI();
          applyReduceMotion(st.reduceMotion);
        } catch { /* try again next tick */ }
      }
    }, 1000);
  }

  // Wait until React has hydrated the main app before we inject UI.
  function afterHydration(cb, timeoutMs = 8000){
    const t0 = Date.now();
    (function tick(){
      const hydrated = document.querySelector('main')?.querySelector('*');
      if (hydrated) return cb();
      if (Date.now() - t0 > timeoutMs) return cb(); // fall back if it never signals
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

  // -------- placeholders (selection-aware) --------
  function makePlaceholder(node, idx, total){
    const ph = document.createElement('div');
    ph.className = 'tm-ph';
    ph.setAttribute('role', 'button');
    ph.setAttribute('tabindex', '0');
    ph.innerHTML = `
      <div class="tm-ph-inner">
        <span>Collapsed turn (${idx}/${total}) — click to expand</span>
        <label class="tm-ph-sel" style="margin-left:auto;display:flex;gap:6px;align-items:center;cursor:pointer">
          <input type="checkbox" class="tm-ph-cb">
          <span style="font-size:12px">Select</span>
        </label>
      </div>
    `;

    // clicking the label/checkbox shouldn't expand
    ph.addEventListener('click', (e) => {
      if (e.target?.classList?.contains('tm-ph-cb') || e.target?.closest?.('.tm-ph-sel')) return;
      expand(ph);
    });
    ph.addEventListener('keydown', (e)=>{ if (e.key === ' ' || e.key === 'Enter') expand(ph); });

    // bind selection state to hidden node
    const cb = ph.querySelector('.tm-ph-cb');
    if (cb) {
      cb.checked = isSelected(node);
      cb.addEventListener('change', ()=> {
        setSelected(node, cb.checked);
        ph.style.borderColor = cb.checked ? '#60a5fa' : '#777';
      });
      if (cb.checked) ph.style.borderColor = '#60a5fa';
    }

    return ph;
  }

  function collapse(node, idx, total){
    if (!node || node.__tmCollapsed) return;
    const ph = makePlaceholder(node, idx, total);
    Store.set(ph, node);
    node.__tmCollapsed = true;
    node.replaceWith(ph);
  }

  function expand(ph){
    const node = Store.get(ph);
    if (!node) return;
    node.__tmCollapsed = false;
    ph.replaceWith(node);
    Store.delete(ph);

    // make expanded node sticky & pause auto-slim briefly
    setSticky(node, true);
    suspend(2000);

    // If selection mode is on, ensure overlay exists on this node
    if (st.selectionMode) ensureSelectionOverlay(node);
  }

  function expandAll(){
    suspend(10000);
    $$('.tm-ph').forEach(expand);
  }

  function slimNow(){
    if (running) return;
    if (Date.now() < suspendUntil) return;
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
          // don't collapse sticky or explicitly selected nodes
          if (isSticky(el) || isSelected(el)) continue;
          collapse(el, i+1, total);
        }
      } finally { running = false; }
    });
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
          slimNow();
          ensureSelectionOverlays(); // re-attach selection UI after DOM changes
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
  }

  // ------------------------------------------------------------
  // Selection & Export (with resilient overlays + placeholder selection)
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
    });

    el.style.position = el.style.position || 'relative';
    el.prepend(box);
  }

  function ensureSelectionOverlays(){
    if (!st.selectionMode) return;
    getTurns().forEach(ensureSelectionOverlay);
  }

  function toggleSelectionMode(on){
    st.selectionMode = !!on;
    save();
    if (st.selectionMode) {
      ensureSelectionOverlays();
    } else {
      getTurns().forEach(el => {
        el.classList.remove('tm-selected');
        el.querySelector(':scope > .tm-select')?.remove();
        // keep Meta.selected so placeholder checkboxes stay in sync if you re-enable later
      });
    }
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
    // Role detection
    let role = turn.getAttribute('data-message-author-role') ||
               turn.querySelector('[data-message-author-role]')?.getAttribute?.('data-message-author-role') || '';
    if (!role) role = turn.querySelector('pre, code, .markdown, [data-message-author-role="assistant"]') ? 'assistant' : 'user';

    const heading = turn.querySelector('h1,h2,h3')?.innerText?.trim();

    // Prefer real content containers; fall back to the node itself
    const contentRoot =
      turn.querySelector('.markdown') ||
      turn.querySelector('.whitespace-pre-wrap') || // user prompts usually live here
      turn;

    const mdParts = [];

    // Paragraphs / list items / quotes
    $$('.markdown p, .markdown li, .markdown blockquote, p, li, blockquote', contentRoot).forEach(el => {
      if (el.closest('.tm-select')) return; // skip our overlay
      let t = (el.innerText || '').replace(/\u00A0/g, ' ').trim();
      if (!t) return;
      if (t === 'Select' || t === 'Copy code' || t === 'You said:' || /^Send$/i.test(t)) return;
      if (el.tagName === 'LI' && !el.closest('.markdown')) t = `- ${t}`;
      mdParts.push(t);
    });

    // Tables → GitHub-flavored markdown
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

    // Fallback: plain text if nothing parsed
    if (!mdParts.length) {
      const lines = (contentRoot.innerText || '').split('\n')
        .map(s => s.replace(/\u00A0/g, ' ').trim())
        .filter(Boolean)
        .filter(s => s !== 'Select' && s !== 'Copy code' && s !== 'You said:' && !/^Send$/i.test(s));
      if (lines.length) mdParts.push(lines.join('\n\n'));
    }

    // Code blocks
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
  // UI (draggable + minimize)
  // ------------------------------------------------------------
  function ensureStyles(){
    if ($('#tm-style')) return;
    const css = document.createElement('style');
    css.id = 'tm-style';
    css.textContent = `
      .tm-panel{position:fixed;z-index:2147483647;background:rgba(28,28,28,.95);color:#fff;border-radius:14px;backdrop-filter:blur(4px);box-shadow:0 6px 24px rgba(0,0,0,.2);width:max-content;max-width:320px}
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
      .tm-ph{margin:8px 0;border:1px dashed #777;border-radius:10px;padding:10px;background:rgba(127,127,127,.08)}
      .tm-ph-inner{display:flex;align-items:center;gap:10px;min-height:40px;font-size:12px;color:#888}
      .tm-code-wrap .tm-code-bar button{color:#111}
      .tm-min .tm-body{display:none}
      .tm-min{width:auto}
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
        <span class="tm-title">Chat Optimizer + Archiver</span>
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
    `;
    document.body.appendChild(p);

    // Controls
    $('#tm-keep').addEventListener('change', e => { st.keepLastN = Math.max(1, (+e.target.value||8)); save(); if (st.autoSlim) slimNow(); });
    $('#tm-auto').addEventListener('change', e => { st.autoSlim = !!e.target.checked; save(); if (st.autoSlim) slimNow(); });
    $('#tm-collapse').addEventListener('change', e => { st.collapseLongCode = !!e.target.checked; save(); collapseLongCode(document); });
    $('#tm-motion').addEventListener('change', e => { st.reduceMotion = !!e.target.checked; save(); applyReduceMotion(st.reduceMotion); });
    $('#tm-hide').addEventListener('click', ()=> slimNow());
    $('#tm-expand').addEventListener('click', ()=> expandAll());
    $('#tm-purge').addEventListener('click', ()=> {
      const turns = getTurns();
      const keep = Math.max(1, parseInt(st.keepLastN,10)||1);
      const older = turns.slice(0, Math.max(0, turns.length - keep));
      if (!older.length) return;
      if (!confirm(`Hard purge will remove ${older.length} older nodes from the DOM until reload. Continue?`)) return;
      older.forEach(n => n.remove());
    });
    $('#tm-selectmode').addEventListener('change', e => toggleSelectionMode(e.target.checked));
    $('#tm-selectall').addEventListener('click', () => {
      toggleSelectionMode(true);
      getTurns().forEach(t => {
        setSelected(t, true);
        const cb = t.querySelector(':scope > .tm-select input');
        if (cb) cb.checked = true;
        t.classList.add('tm-selected');
      });
      $$('.tm-ph .tm-ph-cb').forEach(cb => { cb.checked = true; cb.closest('.tm-ph').style.borderColor='#60a5fa'; });
    });
    $('#tm-selectnone').addEventListener('click', () => {
      getTurns().forEach(t => {
        setSelected(t, false);
        const cb = t.querySelector(':scope > .tm-select input');
        if (cb) cb.checked = false;
        t.classList.remove('tm-selected');
      });
      $$('.tm-ph .tm-ph-cb').forEach(cb => { cb.checked = false; cb.closest('.tm-ph').style.borderColor='#777'; });
    });
    $('#tm-export-md').addEventListener('click', ()=> exportSelected({ format:'md' }));
    $('#tm-export-json').addEventListener('click', ()=> exportSelected({ format:'json' }));
    $('#tm-export-code').addEventListener('click', ()=> exportSelected({ codeOnly:true }));
    $('#tm-snapshot').addEventListener('click', ()=> snapshotVisible());
    $('#tm-last2').addEventListener('click', () => {
      st.keepLastN = 2; save();
      $('#tm-keep').value = 2;
      expandAll();
      slimNow();
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
  }

  function setMinimized(on){
    const p = $('#tm-panel'); if (!p) return;
    st.panelMin = !!on; save();
    p.classList.toggle('tm-min', st.panelMin);
    syncMinBtn();
  }
  function syncMinBtn(){
    const b = $('#tm-min'); if (!b) return;
    b.textContent = st.panelMin ? '▢' : '–';
  }

  function clampPanelIntoView(){
    const p = $('#tm-panel'); if (!p) return;
    const r = p.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = Math.min(Math.max(8, r.left), vw - Math.min(r.width, 260));
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
  // Init
  // ------------------------------------------------------------
  function init(){
    ensureStyles();
    afterHydration(() => {
      buildUI();
      applyReduceMotion(st.reduceMotion);
      collapseLongCode(document);
      reobserveIfNeeded();
      if (st.autoSlim) slimNow();
      ensureSelectionOverlays();
      startUIKeepAlive();
      console.log('[ChatGPT Optimizer + Archiver] v0.5.2 ready (hydration-safe)');
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
