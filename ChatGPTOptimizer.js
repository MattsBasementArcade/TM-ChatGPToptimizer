// ==UserScript==
// @name         ChatGPT Optimizer + Archiver (keep last N, select+export)
// @namespace    https://greg.dev/userscripts
// @version      0.5.0
// @description  Keep chats snappy for long code, plus select and export chat turns or code blocks.
// @author       Matt's Basement Arcade
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  const LS = 'tm_chatgpt_opt_arch_v060';
  const defaults = {
    keepLastN: 8,
    autoSlim: true,
    collapseLongCode: true,
    codeLineThreshold: 120,
    codeHeightThreshold: 600,
    reduceMotion: false,
    selectionMode: false
  };
  let st = load();

  function load() {
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem(LS) || '{}')) }; }
    catch { return { ...defaults }; }
  }
  function save() {
    try { localStorage.setItem(LS, JSON.stringify(st)); } catch {}
  }

  // ------------------------------------------------------------
  // Short helpers
  // ------------------------------------------------------------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const nowISO = () => new Date().toISOString().replace(/[:.]/g, '-');
  const raf = (fn)=> (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1000 }) : requestAnimationFrame(fn));

  // ------------------------------------------------------------
  // Turn discovery & slimmer (based on "Thread Slimmer" selectors/approach)
  // - getTurns(): look for articles in <main>, fallback to legacy nodes
  // - collapse(): replace node with placeholder; store mapping to restore
  // - expand(): restore node from placeholder
  // - slimNow(): keep last N visible
  // ------------------------------------------------------------
  const Store = new WeakMap(); // placeholder -> original turn
  let running = false, mo = null, currentRoot = null;
  let suspendUntil = 0;

  function suspend(ms=10000){ suspendUntil = Date.now() + ms; }

  function findMessageContainer(){
    // As in the base: prefer <main>, fallback body.  :contentReference[oaicite:4]{index=4}
    return $('main') || document.body;
  }

  function getTurns(){
    const root = findMessageContainer();
    if (!root) return [];
    // Robust turn query (base technique): articles with message/testid. :contentReference[oaicite:5]{index=5}
    const candidates = $$('article[data-message-id], article[data-testid^="conversation-turn"], article', root);
    const turns = candidates.filter(el => {
      const r = el.getBoundingClientRect();
      return (el.offsetParent !== null) || (r && r.width > 0 && r.height > 0);
    });
    return turns.length ? turns : $$('.text-base', root);
  }

  function makePlaceholder(idx, total){
    const ph = document.createElement('div');
    ph.className = 'tm-ph';
    ph.setAttribute('role', 'button');
    ph.setAttribute('tabindex', '0');
    ph.innerHTML = `<div class="tm-ph-inner"><span>Collapsed turn (${idx}/${total}) — click to expand</span></div>`;
    ph.addEventListener('click', ()=> expand(ph));
    ph.addEventListener('keydown', (e)=>{ if (e.key === ' ' || e.key === 'Enter') expand(ph); });
    return ph;
  }

  function collapse(node, idx, total){
    if (!node || node.__tmCollapsed) return;
    const ph = makePlaceholder(idx, total);
    Store.set(ph, node);
    node.__tmCollapsed = true;
    node.replaceWith(ph); // Placeholder swap (same idea as base). :contentReference[oaicite:6]{index=6}
  }

  function expand(ph){
    const node = Store.get(ph);
    if (!node) return;
    node.__tmCollapsed = false;
    ph.replaceWith(node);
    Store.delete(ph);
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
          if (el && !el.__tmCollapsed) collapse(el, i+1, total);
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
      if (changed) { clearTimeout(reobserveIfNeeded._t); reobserveIfNeeded._t = setTimeout(slimNow, 150); }
    });
    mo.observe(currentRoot, { childList: true, subtree: true }); // As in base, watch subtree. :contentReference[oaicite:7]{index=7}
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
  // Selection & Export
  // ------------------------------------------------------------
  function toggleSelectionMode(on){
    st.selectionMode = !!on;
    save();
    const turns = getTurns();
    turns.forEach((el, i) => {
      let box = el.querySelector(':scope > .tm-select');
      if (!st.selectionMode) { box && box.remove(); el.classList.remove('tm-selected'); return; }
      if (!box) {
        box = document.createElement('label');
        box.className = 'tm-select';
        box.innerHTML = `<input type="checkbox"><span>Select</span>`;
        box.style.position = 'absolute';
        box.style.right = '8px';
        box.style.top = '8px';
        box.style.zIndex = '2';
        box.style.display = 'flex';
        box.style.gap = '6px';
        box.style.alignItems = 'center';
        box.style.background = 'rgba(28,28,28,.85)';
        box.style.color = '#fff';
        box.style.border = '1px solid rgba(255,255,255,.2)';
        box.style.borderRadius = '10px';
        box.style.padding = '4px 8px';
        box.querySelector('input').addEventListener('change', e => {
          el.classList.toggle('tm-selected', e.target.checked);
        });
        el.style.position = el.style.position || 'relative';
        el.prepend(box);
      }
    });
  }

  function selectedTurns(){
    const turns = getTurns();
    const sel = turns.filter(t => t.classList.contains('tm-selected'));
    return sel.length ? sel : turns.slice(-Math.max(1, parseInt(st.keepLastN,10)||1)); // fallback: last N
  }

  // Heuristics to extract useful content out of a turn node
  function extractTurn(turn, idx){
    // Attempt to read role
    let role = turn.getAttribute('data-message-author-role') || '';
    if (!role) {
      role = turn.querySelector('[data-message-author-role]')?.getAttribute?.('data-message-author-role') || '';
    }
    if (!role) {
      // crude fallback: user turns often contain textarea mirror/quoted prompt, assistant turns contain code/pre
      role = turn.querySelector('pre, code, .markdown, [data-message-author-role="assistant"]') ? 'assistant' : 'user';
    }
    // Title-ish header if present
    const heading = turn.querySelector('h1,h2,h3')?.innerText?.trim();

    // Text content (markdown-ish)
    const mdParts = [];
    // paragraphs / list items
    $$('.markdown p, .markdown li', turn).forEach(el => {
      const t = (el.innerText || '').trim();
      if (t) mdParts.push(t);
    });
    // tables
    $$('.markdown table', turn).forEach(table => {
      const rows = $$('tr', table).map(tr => $$('th,td', tr).map(td => (td.innerText||'').replace(/\|/g,'\\|').trim()));
      if (rows.length) {
        const header = rows.shift();
        mdParts.push(`| ${header.join(' | ')} |`);
        mdParts.push(`| ${header.map(()=> '---').join(' | ')} |`);
        rows.forEach(r => mdParts.push(`| ${r.join(' | ')} |`));
      }
    });
    // code blocks
    const codeBlocks = [];
    $$('pre', turn).forEach(pre => {
      const code = pre.querySelector('code') || pre;
      const text = code.innerText || '';
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
      text: turn.innerText || '',
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

    // markdown default
    const md = [
      `# ${document.title || 'ChatGPT Conversation'}`,
      `_Exported ${new Date().toLocaleString()}_`,
      '',
      ...data.map(t => t.markdown)
    ].join('\n');
    return download(`${title}__selection__${stamp}.md`, md);
  }

  function snapshotVisible(){
    // not “selected”, just everything currently in DOM (expanded or not)
    expandAll(); // ensure all content is visible for snapshot
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
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
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
  // UI
  // ------------------------------------------------------------
  function ensureStyles(){
    if ($('#tm-style')) return;
    const css = document.createElement('style');
    css.id = 'tm-style';
    css.textContent = `
      .tm-panel{position:fixed;top:12px;right:12px;z-index:2147483647;background:rgba(28,28,28,.95);color:#fff;padding:10px 12px;border-radius:14px;font:12px/1.4 system-ui,Segoe UI,Roboto,Arial;backdrop-filter:blur(4px);box-shadow:0 6px 24px rgba(0,0,0,.2);max-width:320px}
      .tm-row{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
      .tm-panel label{display:flex;align-items:center;gap:6px}
      .tm-panel input[type=number]{width:72px;padding:4px 6px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#fff;color:#111}
      .tm-btn{font-size:12px;padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.1);color:#fff;cursor:pointer}
      .tm-btn.danger{background:rgba(200,40,40,.9)}
      .tm-select{user-select:none}
      .tm-selected{outline:2px solid #60a5fa;outline-offset:2px;border-radius:12px}
      .tm-ph{margin:8px 0;border:1px dashed #777;border-radius:10px;padding:10px;background:rgba(127,127,127,.08)}
      .tm-ph-inner{display:flex;align-items:center;justify-content:center;min-height:40px;font-size:12px;color:#888}
      .tm-code-wrap .tm-code-bar button{color:#111}
    `;
    document.head.appendChild(css);
  }

  function buildUI(){
    if ($('#tm-panel')) return;
    const p = document.createElement('div');
    p.id = 'tm-panel';
    p.className = 'tm-panel';
    p.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">Chat Optimizer + Archiver</div>

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
    `;
    document.body.appendChild(p);

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
        const cb = t.querySelector(':scope > .tm-select input'); if (cb) { cb.checked = true; t.classList.add('tm-selected'); }
      });
    });
    $('#tm-selectnone').addEventListener('click', () => {
      getTurns().forEach(t => { const cb = t.querySelector(':scope > .tm-select input'); if (cb) { cb.checked = false; t.classList.remove('tm-selected'); } });
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
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  function init(){
    ensureStyles();
    buildUI();
    applyReduceMotion(st.reduceMotion);
    collapseLongCode(document);
    reobserveIfNeeded();
    if (st.autoSlim) slimNow();
    console.log('[ChatGPT Optimizer + Archiver] v0.6.0 ready');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
