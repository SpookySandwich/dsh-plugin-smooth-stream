window.__ModuleLoader__.load({
  id: 'dsh-plugin-smooth-stream',
  factory: (require) => {
    const React = require('react');
    const styles = {
      insert(css) {
        if (typeof document === 'undefined') return function () {};
        const prev = document.querySelector('style[data-plugin="dsh-plugin-smooth-stream"]');
        if (prev) {
          prev.textContent = css;
          return function () { prev.remove(); };
        }
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-plugin-smooth-stream';
        tag.textContent = css;
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }
    };
    return (function () {
// dsh-plugin-smooth-stream v1.1
// Smooth assistant output for DeepSeek Harness.

const SUMMARY_TICK_MS = 1000;
const BODY_POLL_MS = 200;
const THINK_MIN_CHARS = 1000;
// Per-paragraph offset when one batch reveals several at once, and the cap on
// how many steps that cascade may span.
const STAGGER_MS = 70;
const STAGGER_MAX = 4;
// How long the closing underline takes to retract once a turn stops running.
const SETTLE_MS = 560;
const SPEC_PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives';

/* ------------------------------------------------------------- settings -- */

// User-tunable behavior, persisted per browser. Everything here has a safe
// default equal to the plugin's historical behavior, so an absent or corrupt
// stored value can never change what existing users see.
const SETTINGS_KEY = 'dsh-plugin-smooth-stream:settings';
const SETTINGS_DEFAULTS = {
  // Master switch: off restores the host's own renderer live.
  enabled: true,
  // Paragraph entrance style; see REVEAL_OPTIONS.
  reveal: 'fade',
  // Ease the conversation toward the bottom while streaming.
  smoothFollow: true,
};
// Curated per-effect tuning. Each entrance reads best at its own tempo and
// batch rhythm (a soak wants long strokes over large batches, a wipe wants
// quicker passes over smaller ones), so defaults are per effect and the
// sliders edit, and remember, the active effect's values.
const VARIANT_DEFAULTS = {
  fade: { fadeMs: 520, textMinChars: 500 },
  rise: { fadeMs: 480, textMinChars: 320 },
  dissolve: { fadeMs: 680, textMinChars: 440 },
  wipe: { fadeMs: 600, textMinChars: 260 },
  focus: { fadeMs: 700, textMinChars: 360 },
  glow: { fadeMs: 720, textMinChars: 300 },
  iris: { fadeMs: 740, textMinChars: 380 },
  soak: { fadeMs: 860, textMinChars: 480 },
};
const REVEAL_OPTIONS = ['fade', 'rise', 'dissolve', 'wipe', 'focus', 'glow', 'iris', 'soak'];

function readStoredSettings() {
  const g = realGlobal();
  try {
    const raw = g && g.localStorage && g.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function sanitizeSettings(raw) {
  const out = {};
  out.enabled = typeof raw.enabled === 'boolean' ? raw.enabled : SETTINGS_DEFAULTS.enabled;
  // 'none' used to be a reveal choice; it migrates to the master switch.
  if (raw.reveal === 'none') out.enabled = false;
  out.reveal = REVEAL_OPTIONS.indexOf(raw.reveal) !== -1 ? raw.reveal : SETTINGS_DEFAULTS.reveal;
  out.smoothFollow = typeof raw.smoothFollow === 'boolean' ? raw.smoothFollow : SETTINGS_DEFAULTS.smoothFollow;
  const rawTuning = raw.tuning && typeof raw.tuning === 'object' ? raw.tuning : {};
  out.tuning = {};
  for (let i = 0; i < REVEAL_OPTIONS.length; i++) {
    const key = REVEAL_OPTIONS[i];
    const def = VARIANT_DEFAULTS[key];
    const t = rawTuning[key] && typeof rawTuning[key] === 'object' ? rawTuning[key] : {};
    const ms = Number(t.fadeMs);
    const chars = Number(t.textMinChars);
    out.tuning[key] = {
      fadeMs: isFinite(ms) ? Math.min(1400, Math.max(120, Math.round(ms))) : def.fadeMs,
      textMinChars: isFinite(chars) ? Math.min(2000, Math.max(80, Math.round(chars))) : def.textMinChars,
    };
  }
  // Pre-tuning versions stored one global fadeMs/textMinChars. Carry those
  // into the user's selected effect, so an update never changes what they
  // were already seeing.
  if (!raw.tuning) {
    const legacyMs = Number(raw.fadeMs);
    const legacyChars = Number(raw.textMinChars);
    if (isFinite(legacyMs)) out.tuning[out.reveal].fadeMs = Math.min(1400, Math.max(120, Math.round(legacyMs)));
    if (isFinite(legacyChars)) out.tuning[out.reveal].textMinChars = Math.min(2000, Math.max(80, Math.round(legacyChars)));
  }
  return out;
}

/** Tuning of the currently selected effect. */
function activeTuning(settings) {
  return settings.tuning[settings.reveal] || VARIANT_DEFAULTS.fade;
}

const settingsStore = {
  value: null,
  listeners: [],
  get() {
    if (this.value === null) this.value = sanitizeSettings(readStoredSettings());
    return this.value;
  },
  set(patch) {
    const next = sanitizeSettings(Object.assign({}, this.get(), patch));
    this.value = next;
    const g = realGlobal();
    try { if (g && g.localStorage) g.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) {}
    for (let i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](); } catch (e) {}
    }
  },
  subscribe(fn) {
    const listeners = this.listeners;
    listeners.push(fn);
    return function () {
      const at = listeners.indexOf(fn);
      if (at !== -1) listeners.splice(at, 1);
    };
  },
};

/** React subscription to the settings store (safe against older React). */
function useSettings() {
  const [, force] = React.useReducer(function (x) { return x + 1; }, 0);
  React.useEffect(function () { return settingsStore.subscribe(force); }, []);
  return settingsStore.get();
}

function firstLine(text) {
  const n = text.indexOf('\n');
  return n === -1 ? text : text.slice(0, n);
}
function latestLine(text) {
  const t = (text || '').trimEnd();
  const n = t.lastIndexOf('\n');
  return n === -1 ? t : t.slice(n + 1);
}
function realGlobal() {
  try { if (typeof window !== 'undefined' && window) return window; } catch (e) {}
  try { if (typeof globalThis !== 'undefined' && globalThis) return globalThis; } catch (e) {}
  try { return (0, eval)('globalThis'); } catch (e) {}
  return null;
}
// A renderable export is a plain function component OR a React wrapper object:
// memo() and forwardRef() produce objects carrying `$$typeof`, not functions.
// Testing only for `function` silently misses every memoized host component —
// which is what MarkdownText became, sending this plugin to its own fallback.
function isComponent(value) {
  if (typeof value === 'function') return true;
  return !!value && typeof value === 'object' && value.$$typeof !== undefined;
}
function pickNamed(mod, key) {
  if (!mod) return null;
  if (isComponent(mod[key])) return mod;
  if (mod.default && isComponent(mod.default[key])) return mod.default;
  return null;
}
function fromSystem(ms, spec, key) {
  if (!ms) return null;
  const tries = [];
  try { if (ms.seed && typeof ms.seed.get === 'function') tries.push(ms.seed.get(spec)); } catch (e) {}
  try { if (ms.statics && typeof ms.statics.get === 'function') tries.push(ms.statics.get(spec)); } catch (e) {}
  try {
    if (ms.loadCache && typeof ms.loadCache.get === 'function') {
      const rec = ms.loadCache.get(spec);
      if (rec) tries.push(rec.exports || rec);
    }
  } catch (e) {}
  for (let i = 0; i < tries.length; i++) {
    const hit = pickNamed(tries[i], key);
    if (hit) return hit;
  }
  return null;
}
function resolveModule(spec, key) {
  const g = realGlobal();
  return fromSystem(g && g.__DSH_MODULES__, spec, key);
}
function lineTarget(text, shown, flush) {
  if (typeof text !== 'string') return 0;
  if (flush) return text.length;
  const nl = text.lastIndexOf('\n');
  const target = nl >= 0 ? nl + 1 : 0;
  return target > shown ? target : shown;
}
function isFenceLine(line) {
  return /^\s*```/.test(line);
}
function isTableLine(line) {
  return /^\s*\|/.test(line);
}
function walkLines(text, fn) {
  let start = 0;
  while (start <= text.length) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    fn(start, end, text.slice(start, end));
    if (nl === -1) break;
    start = nl + 1;
  }
}
function extendToSafeMarkdown(text, pos, flush) {
  if (pos >= text.length) return text.length;
  let fenceFrom = -1;
  let tableFrom = -1;
  let inFence = false;
  let inTable = false;
  walkLines(text, function (start, end, line) {
    if (isFenceLine(line)) {
      if (!inFence) {
        inFence = true;
        fenceFrom = start;
      } else {
        inFence = false;
        fenceFrom = -1;
      }
      inTable = false;
      tableFrom = -1;
      return;
    }
    if (!inFence && isTableLine(line)) {
      if (!inTable) {
        inTable = true;
        tableFrom = start;
      }
    } else if (inTable && line.trim() === '') {
      inTable = false;
      tableFrom = -1;
    } else if (inTable && !isTableLine(line)) {
      inTable = false;
      tableFrom = -1;
    }
  });
  if (inFence) return flush ? text.length : (fenceFrom > 0 ? fenceFrom : pos);
  if (inTable) {
    if (flush) return text.length;
    return tableFrom > 0 ? tableFrom : pos;
  }
  return pos;
}
function paragraphTarget(text, shown, flush, minChars) {
  if (typeof text !== 'string') return 0;
  if (flush) return text.length;
  const need = shown + minChars;
  if (text.length < need) return shown;
  let pos = -1;
  const para = text.indexOf('\n\n', need);
  if (para !== -1) pos = para + 2;
  else {
    const nl = text.indexOf('\n', need);
    if (nl !== -1) pos = nl + 1;
  }
  if (pos === -1) return shown;
  pos = extendToSafeMarkdown(text, pos, false);
  return pos > shown ? pos : shown;
}
function laterBlockStarted(blocks, index) {
  for (let i = index + 1; i < blocks.length; i++) {
    if (blocks[i]) return true;
  }
  return false;
}
function ensureRevealSlots(s, n) {
  while (s.shown.length < n) {
    s.shown.push(0);
    s.prev.push(0);
    s.sum.push(0);
    s.batch.push(0);
    s.sumBatch.push(0);
  }
}
/**
 * Re-arm the entrance animation on a node. `order` is its position within the
 * batch that just landed: a batch revealing several paragraphs at once fires
 * them as a cascade rather than a single pop. The delay is capped so a large
 * batch still finishes promptly instead of trickling.
 */
function restartFade(node, order) {
  if (!node || !node.classList) return;
  node.classList.remove('dss-fresh');
  void node.offsetWidth;
  if (node.style) {
    node.style.animationDelay = order > 0
      ? Math.min(order, STAGGER_MAX) * STAGGER_MS + 'ms'
      : '';
  }
  node.classList.add('dss-fresh');
}
function findScrollport(from) {
  if (from && from.closest) {
    const hit = from.closest('[data-conversation-scroll]');
    if (hit) return hit;
  }
  const g = realGlobal();
  const doc = g && g.document;
  return doc ? doc.querySelector('[data-conversation-scroll]') : null;
}
function classFromCss(css, suffix) {
  if (!css) return '';
  const m = css.match(new RegExp('\\.([A-Za-z0-9_-]+_' + suffix + ')\\b'));
  return m ? m[1] : '';
}
function thinkClasses() {
  const fallback = {
    root: 'dss-nr-root',
    row: 'dss-nr-row',
    leading: 'dss-nr-leading',
    chevron: 'dss-nr-chevron',
    title: 'dss-nr-title',
    separator: 'dss-nr-separator',
    summary: 'dss-nr-summary',
    thinkBody: 'dss-nr-body',
    hidden: 'dss-nr-hidden'
  };
  const g = realGlobal();
  const doc = g && g.document;
  if (!doc) return fallback;
  const tag = doc.querySelector('style[data-plugin-css*="ReasoningRow.module.css"]');
  const a11y = doc.querySelector('style[data-plugin-css*="accessibility.module.css"]');
  const css = tag && tag.textContent;
  const hidden = classFromCss(a11y && a11y.textContent, 'visuallyHidden') || fallback.hidden;
  return {
    root: classFromCss(css, 'root') || fallback.root,
    row: classFromCss(css, 'row') || fallback.row,
    leading: classFromCss(css, 'leading') || fallback.leading,
    chevron: classFromCss(css, 'chevron') || fallback.chevron,
    title: classFromCss(css, 'title') || fallback.title,
    separator: classFromCss(css, 'separator') || fallback.separator,
    summary: classFromCss(css, 'summary') || fallback.summary,
    thinkBody: classFromCss(css, 'thinkBody') || fallback.thinkBody,
    hidden: hidden
  };
}

const CSS = [
  '.dss-root{color:var(--dsw-alias-label-primary);flex-direction:column;font-size:16px;line-height:28px;display:flex}',
  '.dss-body{flex-direction:column;gap:16px;display:flex}',
  '.dss-stopped{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);border-radius:6px;align-self:flex-start;padding:0 6px;font-size:11px;line-height:18px}',
  '.dss-dr-root{display:flex;flex-direction:column;width:100%;min-width:0}',
  '.dss-dr-row{position:relative;overflow:hidden;display:flex;align-items:center;height:24px;min-width:0}',
  '.dss-dr-row[data-expandable]{cursor:pointer}',
  '.dss-dr-leading{position:relative;flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;margin-right:6px;padding:0;border:none;background:none;color:var(--dsw-alias-label-tertiary)}',
  '.dss-dr-iconIdle{display:inline-flex;opacity:1;transition:opacity 100ms ease}',
  '.dss-dr-chevronHover{position:absolute;inset:0;margin:auto;opacity:0;transition:opacity 100ms ease;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}',
  '.dss-dr-row:hover .dss-dr-iconIdle{opacity:0}',
  '.dss-dr-row:hover .dss-dr-chevronHover{opacity:1}',
  '.dss-dr-title{flex:none;font-size:14px;line-height:24px;font-weight:400;color:var(--dsw-alias-label-secondary)}',
  '.dss-nr-chevron{color:var(--dsw-alias-label-secondary);display:inline-flex}',
  '.dss-nr-root{display:flex;flex-direction:column}',
  '.dss-nr-row{position:relative;overflow:hidden}',
  '.dss-nr-root[data-state=running] .dss-nr-row:after{content:"";position:absolute;inset-block:0;left:0;width:300px;background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 60%,transparent) 55%,transparent 100%);animation:2.6s ease-out infinite dss-nr-sweep;pointer-events:none}',
  '@keyframes dss-nr-sweep{0%{left:-300px}90%,to{left:100%}}',
  '.dss-nr-separator{flex:none;width:2px;height:2px;margin:0 8px;border-radius:1px;background:var(--dsw-alias-label-caption)}',
  // Settled rows read from the start, so their overflow sits on the right: a
  // fade there replaces the ellipsis, which is the state a reader sees most.
  '.dss-nr-summary{min-width:0;overflow:hidden;flex:1 1 auto;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:24px;text-overflow:clip;white-space:nowrap;-webkit-mask-image:linear-gradient(to left,transparent 0,#000 28px);mask-image:linear-gradient(to left,transparent 0,#000 28px)}',
  // Running rows are scrolled to their right edge, so the overflow is on the
  // left. A mask fades the clipped glyphs out over any background; settled rows
  // read from the start and want no mask at all.
  '.dss-nr-summary[data-follow-end]{text-overflow:clip;-webkit-mask-image:linear-gradient(to right,transparent 0,#000 24px);mask-image:linear-gradient(to right,transparent 0,#000 24px)}',
  '.dss-nr-body{padding:4px 0 4px 22px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:24px;white-space:pre-wrap;word-break:break-word}',
  '.dss-nr-hidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}',
  '.dss-sum-fade{display:inline;animation:dss-fade var(--dss-fade-ms,520ms) ease-out both}',
  '.dss-line{display:block}',
  '.dss-plain{white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dss-codeblock{background:var(--dsw-alias-markdown-code-block);border-radius:8px;padding:10px 12px;overflow:auto}',
  '.dss-code{font-family:var(--dsw-font-markdown-code,monospace);background:var(--dsw-alias-interactive-bg-hover);border-radius:4px;padding:0 4px}',
  '.dss-strong{font-weight:600}',
  '.dss-em{font-style:italic}',
  '.dss-image{max-width:100%;border-radius:8px}',
  '.dss-mdwrap table{border-collapse:collapse;width:100%;margin:8px 0 16px}',
  '.dss-mdwrap th,.dss-mdwrap td{border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12));padding:10px 16px 10px 0;text-align:left;vertical-align:top}',
  '.dss-mdwrap th{font-weight:600}',
  '@keyframes dss-fade{from{opacity:0;filter:blur(2px);transform:translateY(3px)}to{opacity:1;filter:none;transform:none}}',
  // Entrance variants. The base fade carries timing from the settings-driven
  // custom property; each variant owns its curve, rhythm and gesture. Rise and
  // dissolve are deliberately plain; the rest layer several properties on
  // offset schedules so each is identifiable at a glance.
  '.dss-fresh{animation:dss-fade var(--dss-fade-ms,520ms) ease-out both}',

  // rise — one clear upward glide on an expressive ease-out.
  '.dss-root[data-reveal=rise] .dss-fresh{animation-name:dss-rise;animation-timing-function:cubic-bezier(.16,1,.3,1)}',
  '@keyframes dss-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',

  // dissolve — nothing but opacity on a long soft curve; the quiet option.
  '.dss-root[data-reveal=dissolve] .dss-fresh{animation-name:dss-dissolve;animation-duration:var(--dss-fade-ms,520ms);animation-timing-function:cubic-bezier(.25,.46,.45,.94)}',
  '@keyframes dss-dissolve{from{opacity:0}to{opacity:1}}',

  // wipe — a hard reveal edge crossed by a luminous beam. The pseudo-element
  // shares the clip animation's duration and curve, so it rides exactly on
  // the boundary the whole way.
  '.dss-root[data-reveal=wipe] .dss-fresh{position:relative;animation-name:dss-wipe;animation-duration:var(--dss-fade-ms,520ms);animation-timing-function:cubic-bezier(.65,0,.35,1)}',
  '.dss-root[data-reveal=wipe] .dss-fresh:after{content:"";position:absolute;top:0;bottom:0;left:0;width:5px;border-radius:3px;background:linear-gradient(180deg,transparent,var(--dsw-alias-accent-primary,#4b8dff) 18%,#cfe1ff 50%,var(--dsw-alias-accent-primary,#4b8dff) 82%,transparent);filter:blur(.5px);box-shadow:0 0 12px 2px rgba(96,156,255,.55);animation:dss-wipe-beam var(--dss-fade-ms,520ms) cubic-bezier(.65,0,.35,1) both;pointer-events:none}',
  '@keyframes dss-wipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 -2% 0 0)}}',
  '@keyframes dss-wipe-beam{0%{left:0;opacity:1}80%{opacity:.9}100%{left:calc(100% - 5px);opacity:0}}',

  // focus — rack focus: oversharp blur and washed color resolving in two
  // stages, no travel at all.
  '.dss-root[data-reveal=focus] .dss-fresh{animation-name:dss-focus;animation-duration:var(--dss-fade-ms,520ms);transform-origin:14% 20%}',
  '@keyframes dss-focus{0%{opacity:0;filter:blur(10px) saturate(.6);transform:scale(1.015)}40%{opacity:1;filter:blur(4px) saturate(.85);transform:scale(1.007)}100%{opacity:1;filter:none;transform:none}}',

  // glow — text materializes inside an accent bloom that collapses, then the
  // color cools to normal.
  '.dss-root[data-reveal=glow] .dss-fresh{animation-name:dss-glow;animation-duration:var(--dss-fade-ms,520ms)}',
  '@keyframes dss-glow{0%{opacity:0;filter:brightness(1.9);text-shadow:0 0 22px rgba(96,156,255,.95),0 0 4px rgba(96,156,255,.9)}45%{opacity:1;filter:brightness(1.45);text-shadow:0 0 14px rgba(96,156,255,.75),0 0 3px rgba(96,156,255,.6)}100%{opacity:1;filter:brightness(1);text-shadow:0 0 22px rgba(96,156,255,0),0 0 4px rgba(96,156,255,0)}}',

  // iris — a soft-edged radial bloom opening from the reading corner; masked
  // rather than clipped, so the frontier is a gradient, not a line.
  '.dss-root[data-reveal=iris] .dss-fresh{animation-name:dss-iris;animation-duration:var(--dss-fade-ms,520ms);-webkit-mask-image:radial-gradient(circle at 10% 8%,#000 55%,transparent 98%);mask-image:radial-gradient(circle at 10% 8%,#000 55%,transparent 98%);-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}',
  '@keyframes dss-iris{from{opacity:.15;-webkit-mask-size:12% 12%;mask-size:12% 12%}to{opacity:1;-webkit-mask-size:480% 480%;mask-size:480% 480%}}',

  // soak — an ink front with a defined edge sweeping downward; the slowest
  // rhythm in the set.
  '.dss-root[data-reveal=soak] .dss-fresh{animation-name:dss-soak;animation-duration:var(--dss-fade-ms,520ms);animation-timing-function:cubic-bezier(.4,0,.2,1);-webkit-mask-image:linear-gradient(180deg,#000 62%,rgba(0,0,0,.35) 74%,transparent 86%);mask-image:linear-gradient(180deg,#000 62%,rgba(0,0,0,.35) 74%,transparent 86%);-webkit-mask-size:100% 300%;mask-size:100% 300%}',
  '@keyframes dss-soak{from{opacity:.25;-webkit-mask-position:0 100%;mask-position:0 100%}to{opacity:1;-webkit-mask-position:0 0;mask-position:0 0}}',

  // The streaming-time follow: the class lives only while a reply streams, so
  // opening history, paging prepends and position restores stay instant.
  '[data-conversation-scroll].dss-smooth-follow{scroll-behavior:smooth}',

  // Closing gesture: a hairline under the row retracts toward its end and
  // fades, so a turn reads as finished rather than merely stopped.
  '.dss-nr-root[data-settling] .dss-nr-row:after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--dsw-alias-accent-primary,#4b8dff);transform-origin:right center;animation:dss-settle ' + SETTLE_MS + 'ms cubic-bezier(.4,0,.2,1) both;pointer-events:none}',
  '@keyframes dss-settle{from{transform:scaleX(1);opacity:.5}to{transform:scaleX(0);opacity:0}}',

  // Settings section (mounted in the host settings panel, root scope).
  '.dss-set{display:flex;flex-direction:column;gap:18px;max-width:520px;font-size:14px;color:var(--dsw-alias-label-primary)}',
  '.dss-set-row{display:flex;flex-direction:column;gap:8px}',
  '.dss-set-label{font-size:13px;color:var(--dsw-alias-label-secondary)}',
  '.dss-set-value{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:12px;margin-left:8px}',
  '.dss-set-seg{display:flex;gap:6px;flex-wrap:wrap}',
  '.dss-set-opt{padding:5px 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));background:transparent;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background 120ms ease,color 120ms ease}',
  '.dss-set-opt:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.dss-set-opt[data-on]{border-color:var(--dsw-alias-accent-primary,#4b8dff);color:var(--dsw-alias-label-primary)}',
  '.dss-set-range{width:100%;accent-color:var(--dsw-alias-accent-primary,#4b8dff)}',
  '.dss-set-check{display:flex;align-items:center;gap:10px;cursor:pointer}',
  '.dss-set-check input{accent-color:var(--dsw-alias-accent-primary,#4b8dff)}',
  '.dss-set-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
  '.dss-set-preview{border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.24));border-radius:10px;padding:14px 16px;font-size:14px;line-height:24px;color:var(--dsw-alias-label-secondary);height:190px;overflow-y:auto}',
  '.dss-set-preview[data-follow]{scroll-behavior:smooth}',
  '.dss-set-piece{margin:0 0 10px}',
  '.dss-set-piece:last-child{margin-bottom:0}',
  '.dss-set-actions{display:flex;gap:10px;align-items:center}',
  '.dss-set-link{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary);text-decoration:none}',
  '.dss-set-link:hover{color:var(--dsw-alias-label-primary)}',
  '.dss-set-btn{padding:5px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-secondary,rgba(128,128,128,.3));background:transparent;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);cursor:pointer}',
  '.dss-set-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',

  '@media (prefers-reduced-motion:reduce){.dss-smooth-follow,.dss-set-preview[data-follow]{scroll-behavior:auto}.dss-fresh,.dss-sum-fade{animation:none;filter:none;transform:none;animation-delay:0s!important;-webkit-mask-image:none!important;mask-image:none!important;clip-path:none!important;text-shadow:none!important}.dss-fresh:after{animation:none;opacity:0}.dss-nr-root[data-state=running] .dss-nr-row:after{animation:none}.dss-nr-root[data-settling] .dss-nr-row:after{animation:none;opacity:0}}'
].join('');

/* -------------------------------------------------------- scroll follow -- */
// While a reply streams, the host's instant bottom-follow writes become eased
// glides via scroll-behavior. The host's follow-ownership ledger reads stale
// during an animated write and briefly releases follow, but the glide lands
// on the floor where ownership re-arms — the system self-heals, and the
// browser's native curve is the smoothest follow available. (An rAF follower
// was tried here; the host's layout-effect snap runs before rAF every frame,
// so a script-side follower never gets to move first.)

function inlineMarkdown(text) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(React.createElement('strong', { className: 'dss-strong', key: out.length }, m[2]));
    else if (m[3] !== undefined) out.push(React.createElement('em', { className: 'dss-em', key: out.length }, m[3]));
    else out.push(React.createElement('code', { className: 'dss-code', key: out.length }, m[4]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function FallbackMarkdown(props) {
  const text = props.text || '';
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i += 1; continue; }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      const body = rows.filter(function (row) { return !/^\s*\|?\s*:?-{3,}/.test(row); });
      out.push(React.createElement('table', { key: out.length },
        React.createElement('tbody', null, body.map(function (row, ri) {
          const cells = row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
          return React.createElement('tr', { key: ri }, cells.map(function (cell, ci) {
            return React.createElement(ri === 0 ? 'th' : 'td', { key: ci }, inlineMarkdown(cell.trim()));
          }));
        }))
      ));
      continue;
    }
    if (/^\s*```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      out.push(React.createElement('pre', { className: 'dss-codeblock', key: out.length }, React.createElement('code', null, buf.join('\n'))));
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(React.createElement('h' + Math.min(h[1].length, 6), { key: out.length }, inlineMarkdown(h[2])));
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      out.push(React.createElement('blockquote', { key: out.length }, inlineMarkdown(buf.join(' '))));
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i += 1; }
      out.push(React.createElement('ul', { key: out.length }, items.map(function (it, k) {
        return React.createElement('li', { key: k }, inlineMarkdown(it));
      })));
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i += 1; }
      out.push(React.createElement('ol', { key: out.length }, items.map(function (it, k) {
        return React.createElement('li', { key: k }, inlineMarkdown(it));
      })));
      continue;
    }
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*(```|#{1,6}\s|>\s?|[-*+]\s+|\d+[.)]\s+)/.test(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(React.createElement('p', { key: out.length }, inlineMarkdown(buf.join(' '))));
  }
  return React.createElement('div', null, out);
}

function SvgIcon(size, viewBox, paths) {
  return React.createElement('svg', {
    width: size,
    height: size,
    viewBox: viewBox,
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true
  }, paths.map(function (p, i) {
    return React.createElement('path', {
      key: i,
      d: p.d,
      fill: 'currentColor',
      fillRule: p.fillRule,
      clipRule: p.clipRule
    });
  }));
}
function IconThink14() {
  return SvgIcon(14, '0 0 14 14', [
    { d: 'M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z' },
    {
      fillRule: 'evenodd',
      clipRule: 'evenodd',
      d: 'M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.44785 11.6656 5.11052 11.7821 4.78694C12.2618 3.45416 12.1297 2.57502 11.7147 2.15998ZM4.91197 2.2176C3.57922 1.73788 2.70004 1.86995 2.28501 2.28498C1.87001 2.70003 1.73791 3.5792 2.21763 4.91194C2.31709 5.18822 2.44112 5.47427 2.58677 5.7674C3.01931 5.1887 3.51474 4.6158 4.06529 4.06526C4.61584 3.5147 5.18872 3.01928 5.76743 2.58674C5.47431 2.4411 5.18824 2.31706 4.91197 2.2176Z'
    }
  ]);
}
function IconChevron14(className) {
  return React.createElement('span', { className: className },
    SvgIcon(14, '0 0 14 14', [{
      d: 'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'
    }])
  );
}

return {
  inject: ['timer', 'slots', 'locale', 'modules'],
  apply(ctx) {
    const slots = ctx.get('slots');
    if (slots === undefined) throw new Error('[dsh-plugin-smooth-stream] Missing DSH slots service; check client dependencies.');
    ctx.effect(function () { return styles.insert(CSS); });

    const I18N_NS = 'dsh-plugin-smooth-stream';
    const I18N = {
      en: {
        nav: 'Smooth Stream',
        reveal: 'Reveal animation',
        duration: 'Animation duration',
        batch: 'Batch size',
        batchUnit: 'chars',
        batchHint: 'How much text accumulates before a paragraph batch reveals. Smaller feels more live; larger reads calmer.',
        follow: 'Smooth scroll-follow while streaming',
        replay: 'Replay preview',
        reset: 'Reset to defaults',
        'opt.fade': 'Fade', 'opt.rise': 'Rise', 'opt.dissolve': 'Dissolve',
        'opt.wipe': 'Wipe', 'opt.focus': 'Focus', 'opt.glow': 'Glow',
        'opt.iris': 'Iris', 'opt.soak': 'Soak',
        enabled: 'Enable Smooth Stream', enabledHint: 'Off hands rendering back to the built-in view — handy for comparing.',
        perStyleHint: 'Duration and batch size are remembered per animation style; defaults are tuned per style.'
      },
      zh: {
        nav: 'Smooth Stream',
        reveal: '入场动画',
        duration: '动画时长',
        batch: '分批大小',
        batchUnit: '字符',
        batchHint: '攒多少文字呈现一批：越小越"实时"，越大越安静。',
        follow: '流式期间平滑滚动跟随',
        replay: '重播预览',
        reset: '恢复默认',
        'opt.fade': '淡入', 'opt.rise': '上升', 'opt.dissolve': '浮现',
        'opt.wipe': '拂过', 'opt.focus': '聚焦', 'opt.glow': '映亮',
        'opt.iris': '晕开', 'opt.soak': '洇染',
        enabled: '启用 Smooth Stream', enabledHint: '关闭后恢复内置渲染，方便对比效果。',
        perStyleHint: '时长与分批大小按动画风格分别记忆，默认值已按各风格调校。'
      }
    };
    let t = function (key) { return I18N.en[key] || key; };
    try {
      const locale = ctx.get('locale');
      if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
        ctx.effect(function () { return locale.register(I18N_NS, I18N); });
        t = locale.bind(I18N_NS);
      }
    } catch (e) {}

    const nr = thinkClasses();
    let prims;
    // Prefer the module loader's public require over internal export caches.
    try { prims = pickNamed(require(SPEC_PRIMITIVES), 'MarkdownText'); } catch (e) {}
    if (!prims) prims = resolveModule(SPEC_PRIMITIVES, 'MarkdownText');
    try {
      const svc = ctx.get('modules');
      if (!prims) prims = fromSystem(svc, SPEC_PRIMITIVES, 'MarkdownText');
    } catch (e) {}

    function MarkdownView(props) {
      const wrapRef = React.useRef(null);
      const seenRef = React.useRef(0);
      React.useEffect(function () {
        const host = wrapRef.current;
        if (!host) return;
        const root = host.firstElementChild;
        const n = root ? root.children.length : 0;
        if (!props.animate || props.fromEmpty) {
          seenRef.current = n;
          return;
        }
        if (n > seenRef.current) {
          for (let i = seenRef.current; i < n; i++) restartFade(root.children[i], i - seenRef.current);
          seenRef.current = n;
          return;
        }
        if (n > 0) restartFade(root.children[n - 1]);
        else restartFade(host);
      }, [props.text, props.animate, props.fromEmpty, props.batchId]);

      const node = (prims && isComponent(prims.MarkdownText))
        ? React.createElement(prims.MarkdownText, {
          text: props.text,
          streaming: props.streaming === true,
          labels: props.labels,
          codeLabels: props.codeLabels,
          fileMentions: props.fileMentions
        })
        : React.createElement(FallbackMarkdown, { text: props.text });
      const cls = props.animate && props.fromEmpty ? 'dss-mdwrap dss-fresh' : 'dss-mdwrap';
      return React.createElement('div', { ref: wrapRef, className: cls, 'data-dss-prose': '1' }, node);
    }

    function ReasoningView(props) {
      const [expanded, setExpanded] = React.useState(false);
      const summaryRef = React.useRef(null);
      const summarySrc = props.summaryText !== undefined ? props.summaryText : props.text;
      const summary = props.running ? latestLine(summarySrc) : firstLine(summarySrc);
      React.useEffect(function () {
        const el = summaryRef.current;
        if (!el) return;
        el.scrollLeft = props.running ? el.scrollWidth - el.clientWidth : 0;
      }, [props.running, summary]);

      // Closing gesture, keyed off the TURN finishing — not off this row's
      // own `running` flag. Row-level running flips false the moment any
      // later block starts mid-stream, which made the underline flash while
      // the turn was still thinking. Transition-keyed so loading history
      // never flashes settled rows.
      const [settling, setSettling] = React.useState(false);
      const wasStreamingRef = React.useRef(props.turnStreaming);
      React.useEffect(function () {
        const was = wasStreamingRef.current;
        wasStreamingRef.current = props.turnStreaming;
        if (!was || props.turnStreaming || !props.settleEligible) return undefined;
        setSettling(true);
        const g = realGlobal();
        if (!g || typeof g.setTimeout !== 'function') return undefined;
        const timer = g.setTimeout(function () { setSettling(false); }, SETTLE_MS + 60);
        return function () { g.clearTimeout(timer); };
      }, [props.turnStreaming, props.settleEligible]);

      const stable = props.bodyStable || '';
      const fresh = props.bodyFresh || '';
      const body = React.createElement('div', { className: 'dss-nr-body' },
        stable ? React.createElement('div', { className: 'dss-line', style: { whiteSpace: 'pre-wrap' } }, stable) : null,
        fresh ? React.createElement('div', {
          key: 'f' + (props.batchId || 0),
          className: 'dss-line dss-fresh',
          style: { whiteSpace: 'pre-wrap' }
        }, fresh) : null
      );
      const summaryNode = React.createElement(React.Fragment, null,
        React.createElement('span', { className: 'dss-nr-separator', 'aria-hidden': true }),
        React.createElement('span', {
          ref: summaryRef,
          className: 'dss-nr-summary',
          'data-follow-end': props.running || undefined
        },
          React.createElement('span', {
            key: String(props.summaryBatch || props.batchId) + ':' + summary,
            className: 'dss-sum-fade'
          }, summary)
        )
      );
      const toggle = function () { setExpanded(function (v) { return !v; }); };
      const chevron = IconChevron14('dss-nr-chevron');
      const leading = expanded
        ? chevron
        : React.createElement(React.Fragment, null,
          React.createElement('span', { className: 'dss-dr-iconIdle' }, IconThink14()),
          IconChevron14('dss-dr-chevronHover')
        );

      return React.createElement('div', {
        className: 'dss-dr-root dss-nr-root',
        'data-variant': 'think',
        'data-state': props.running ? 'running' : 'ok',
        'data-settling': settling ? '' : undefined,
        'data-open': expanded || undefined
      },
        props.running ? React.createElement('span', { className: 'dss-nr-hidden' }, 'Running') : null,
        React.createElement('div', {
          className: 'dss-dr-row dss-nr-row',
          'data-disclosure-row': true,
          'data-expandable': true,
          role: 'button',
          tabIndex: 0,
          'aria-expanded': expanded,
          onClick: toggle,
          onKeyDown: function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
          }
        },
          React.createElement('span', { className: 'dss-dr-leading' }, leading),
          React.createElement('span', { className: 'dss-dr-title' }, 'Think'),
          expanded ? null : summaryNode
        ),
        expanded ? body : null
      );
    }

    function ImageNode(props) {
      const [src, setSrc] = React.useState(null);
      React.useEffect(function () {
        let alive = true;
        if (typeof props.loadImage === 'function' && props.attachment) {
          Promise.resolve(props.loadImage(props.attachment)).then(function (url) {
            if (alive && typeof url === 'string') setSrc(url);
          }).catch(function () {});
        }
        return function () { alive = false; };
      }, [props.attachment, props.loadImage]);
      if (src === null) return null;
      return React.createElement('img', { className: 'dss-image', src: src, alt: '' });
    }

    function OtherView(props) {
      if (prims && isComponent(prims.JsonBlock)) {
        return React.createElement(prims.JsonBlock, { label: 'Data', payload: props.payload });
      }
      return React.createElement('div', { className: 'dss-plain' }, '[data]');
    }

    function SmoothAssistantNode(props) {
      const node = props.node;
      const data = (node && node.data) || {};
      const blocks = Array.isArray(data.blocks) ? data.blocks : [];
      const status = data.status === 'running' ? 'running' : (data.status === 'interrupted' ? 'interrupted' : 'settled');
      const streaming = status === 'running';
      const settings = useSettings();
      const t = typeof props.t === 'function' ? props.t : function (k) { return k; };

      const copyLabel = t('copy') || 'Copy';
      const copiedLabel = t('copied') || 'Copied';
      const footnotesLabel = t('markdown.footnotes') || 'Footnotes';
      const markdownLabels = React.useMemo(function () {
        return { code: { copyLabel: copyLabel, copiedLabel: copiedLabel }, footnotes: footnotesLabel };
      }, [copyLabel, copiedLabel, footnotesLabel]);

      const loc = node && node.location;
      const turn = loc && (loc.kind === 'turn' || loc.kind === 'step') ? loc.turn : undefined;
      const tail = typeof props.useTurnData === 'function' ? props.useTurnData('turn-tail') : undefined;
      const mentions = React.useMemo(function () {
        if (typeof props.fileMentions !== 'function') return undefined;
        if (!turn || turn.status !== 'closed' || data.finalNode === undefined) return undefined;
        if (!tail || !tail.closing || !tail.closing.finalNode || tail.closing.finalNode.seq !== data.finalNode.seq) return undefined;
        return props.fileMentions({ turn: turn, seq: data.finalNode.seq, openFile: props.openFile });
      }, [data.finalNode, props.fileMentions, props.openFile, tail, turn]);

      const stateRef = React.useRef({ shown: [], prev: [], sum: [], batch: [], sumBatch: [] });
      const blocksRef = React.useRef(blocks);
      const streamingRef = React.useRef(streaming);
      blocksRef.current = blocks;
      streamingRef.current = streaming;
      const rootRef = React.useRef(null);
      const seenStreamRef = React.useRef(false);
      const [, force] = React.useReducer(function (x) { return x + 1; }, 0);
      if (streaming) seenStreamRef.current = true;
      const liveReveal = seenStreamRef.current;
      const s0 = stateRef.current;
      ensureRevealSlots(s0, blocks.length);
      if (!streaming) {
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (!b || (b.kind !== 'text' && b.kind !== 'reasoning') || typeof b.text !== 'string') continue;
          if (!liveReveal) {
            s0.shown[i] = b.text.length;
            s0.prev[i] = b.text.length;
            if (b.kind === 'reasoning') s0.sum[i] = b.text.length;
            continue;
          }
          if (s0.shown[i] < b.text.length) {
            s0.prev[i] = s0.shown[i];
            s0.shown[i] = b.text.length;
            s0.batch[i] += 1;
          }
          if (b.kind === 'reasoning' && s0.sum[i] < b.text.length) {
            s0.sum[i] = b.text.length;
            s0.sumBatch[i] += 1;
          }
        }
      }

      React.useEffect(function () {
        const port = findScrollport(rootRef.current);
        if (!port) return undefined;
        if (streaming && settings.smoothFollow) port.classList.add('dss-smooth-follow');
        else port.classList.remove('dss-smooth-follow');
        return function () { port.classList.remove('dss-smooth-follow'); };
      }, [streaming, settings.smoothFollow]);

      React.useEffect(function () {
        function grow(kind) {
          const list = blocksRef.current;
          const live = streamingRef.current;
          const s = stateRef.current;
          ensureRevealSlots(s, list.length);
          let dirty = false;
          for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (!b || (b.kind !== 'text' && b.kind !== 'reasoning') || typeof b.text !== 'string') continue;
            const flush = !live || laterBlockStarted(list, i);
            if (kind === 'body' || b.kind === 'text') {
              const min = b.kind === 'reasoning' ? THINK_MIN_CHARS : activeTuning(settingsStore.get()).textMinChars;
              const target = paragraphTarget(b.text, s.shown[i], flush, min);
              if (target > s.shown[i]) {
                s.prev[i] = s.shown[i];
                s.shown[i] = target;
                s.batch[i] += 1;
                dirty = true;
              }
            }
            if ((kind === 'sum' || flush) && b.kind === 'reasoning') {
              const target = lineTarget(b.text, s.sum[i], flush);
              if (target > s.sum[i]) {
                s.sum[i] = target;
                s.sumBatch[i] += 1;
                dirty = true;
              }
            }
          }
          if (dirty) force();
        }
        grow('body');
        grow('sum');
        if (!streaming) return undefined;
        const stopBody = ctx.interval(function () { grow('body'); }, BODY_POLL_MS);
        const stopSum = ctx.interval(function () { grow('sum'); }, SUMMARY_TICK_MS);
        return function () {
          if (typeof stopBody === 'function') stopBody();
          if (typeof stopSum === 'function') stopSum();
        };
      }, [streaming, blocks.length]);

      const rendered = [];
      const lastIdx = blocks.length - 1;
      // The closing underline belongs to the turn's final reasoning row only:
      // one gesture per turn, not one per think segment.
      let lastReasoningIdx = -1;
      for (let i = 0; i < blocks.length; i++) {
        if (blocks[i] && blocks[i].kind === 'reasoning') lastReasoningIdx = i;
      }
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (!b) continue;
        if (b.kind === 'tool-call') continue;
        if (b.kind === 'text' && typeof b.text === 'string') {
          const shown = Math.min(stateRef.current.shown[i] || 0, b.text.length);
          const prevShown = Math.min(stateRef.current.prev[i] || 0, shown);
          const batchId = stateRef.current.batch[i] || 0;
          if (shown === 0) continue;
          rendered.push(React.createElement(MarkdownView, {
            key: 't' + i,
            text: b.text.slice(0, shown),
            animate: liveReveal,
            fromEmpty: prevShown === 0,
            batchId: batchId,
            streaming: streaming,
            labels: markdownLabels,
            codeLabels: markdownLabels.code,
            fileMentions: mentions
          }));
        } else if (b.kind === 'reasoning' && typeof b.text === 'string') {
          const bodyShown = Math.min(stateRef.current.shown[i] || 0, b.text.length);
          const sumShown = Math.min(stateRef.current.sum[i] || 0, b.text.length);
          const batchId = stateRef.current.batch[i] || 0;
          const summaryBatch = stateRef.current.sumBatch[i] || 0;
          if (bodyShown === 0 && sumShown === 0) continue;
          const prevShown = Math.min(stateRef.current.prev[i] || 0, bodyShown);
          rendered.push(React.createElement(ReasoningView, {
            key: 'r' + i,
            summaryText: b.text.slice(0, sumShown),
            bodyStable: b.text.slice(0, prevShown),
            bodyFresh: bodyShown > prevShown ? b.text.slice(prevShown, bodyShown) : '',
            batchId: batchId,
            summaryBatch: summaryBatch,
            running: streaming && i === lastIdx,
            turnStreaming: streaming,
            settleEligible: i === lastReasoningIdx
          }));
        } else if (b.kind === 'image') {
          if (typeof props.renderMessageImages === 'function') {
            const group = [b];
            while (i + 1 < blocks.length && blocks[i + 1] && blocks[i + 1].kind === 'image') {
              i += 1;
              group.push(blocks[i]);
            }
            rendered.push(React.createElement(React.Fragment, { key: 'img' + i },
              props.renderMessageImages({
                images: group.map(function (image) { return { attachment: image.attachment }; }),
                align: 'start'
              })
            ));
          } else {
            rendered.push(React.createElement(ImageNode, {
              key: 'img' + i,
              attachment: b.attachment,
              loadImage: props.loadImage
            }));
          }
        } else if (b.kind === 'other') {
          rendered.push(React.createElement(OtherView, { key: 'o' + i, payload: b.block }));
        }
      }

      return React.createElement('div', {
        className: 'dss-root',
        ref: rootRef,
        'data-reveal': settings.reveal,
        style: { '--dss-fade-ms': activeTuning(settings).fadeMs + 'ms' }
      },
        React.createElement('div', { className: 'dss-body' },
          rendered,
          status === 'interrupted' ? React.createElement('span', { className: 'dss-stopped' }, t('message.stopped') || 'Stopped') : null
        )
      );
    }

    /**
     * Last-resort renderer: the node's text blocks as plain paragraphs. Built
     * from string operations only, so it cannot itself throw on any input the
     * boundary hands it.
     */
    function PlainFallback(props) {
      let out = '';
      try {
        const blocks = (props.node && props.node.data && props.node.data.blocks) || [];
        for (let i = 0; i < blocks.length; i++) {
          const b = blocks[i];
          if (b && b.kind === 'text' && typeof b.text === 'string') out += (out ? '\n\n' : '') + b.text;
        }
      } catch (e) {}
      return React.createElement('div', { className: 'dss-root' },
        React.createElement('div', { style: { whiteSpace: 'pre-wrap' } }, out)
      );
    }

    // A render failure inside this plugin must degrade to readable text, not
    // take the conversation row down with it. Error boundaries require a class
    // component; this is the minimal ES5 form of one.
    function Boundary(props) {
      React.Component.call(this, props);
      this.state = { failed: false };
    }
    Boundary.prototype = Object.create(React.Component.prototype);
    Boundary.prototype.constructor = Boundary;
    Boundary.getDerivedStateFromError = function () { return { failed: true }; };
    Boundary.prototype.render = function () {
      if (this.state.failed) return React.createElement(PlainFallback, { node: this.props.ownerProps.node });
      return React.createElement(SmoothAssistantNode, this.props.ownerProps);
    };

    function GuardedAssistantNode(props) {
      return React.createElement(Boundary, { ownerProps: props });
    }

    /* ------------------------------------------------------ settings UI -- */

    // Enough sample text that the batch-size slider visibly changes how the
    // preview chunks; the simulated stream runs through the SAME batching
    // logic (paragraphTarget) the real renderer uses.
    const PREVIEW_TEXT = [
      '流式输出不必逐字抖动：攒够一批文字，再以你选择的动画整段呈现，阅读的节奏就安静下来了。',
      'Streaming does not have to twitch in token by token — batches land as calm, designed motion instead.',
      '试着把「分批大小」调小，这里会出现更频繁的小段；调大则更接近一次成文。动画风格与时长的改动也会立刻反映在这里。',
      '分批的切割点会避开没写完的代码块和表格，所以不会看到渲染到一半的 Markdown；思考块则在折叠行里滚动显示最新一句，两端用渐隐过渡。',
      'Each style has its own tuned tempo: a soak takes long strokes over large batches, a wipe prefers quicker passes. Everything you change here is remembered per style.',
      '八种入场动画各有性格：淡入最克制，上升带一点位移，浮现只有透明度的变化，拂过让一道光沿着揭示的边缘扫过。',
      '聚焦像镜头对焦——先是一片模糊与褪色，再分两段回到清晰；映亮则让文字在一层强调色的光晕里浮现，随后冷却成正常颜色。',
      'Iris opens a soft radial bloom from the reading corner, and soak sweeps an ink front downward at the slowest rhythm of the set. Neither uses a hard clipping edge.',
      '这一段之后的内容需要滚动才能看到——预览面板固定高度，会像真实对话一样自动跟随到底部，你可以在这里直接看到滚动跟随的效果。',
      'The preview pane below is fixed height on purpose. As batches arrive it follows its own bottom, exactly the way the conversation column does while a reply streams in.',
      '关闭「流式期间平滑滚动跟随」，这里的滚动会立刻变成生硬的跳变；重新打开，它又会平滑地滑到底部。',
      'Turn the scroll-follow checkbox off and this pane snaps instead of gliding. Turn it back on and the motion returns — the same switch governs real conversations.',
      '正文渲染走的是 DSH 自带的 Markdown 渲染器，所以代码高亮、复制按钮、表格和 KaTeX 数学公式都与原生完全一致，插件不会替换它们。',
      'Body text goes through the host renderer, so code highlighting, copy buttons, tables and math all look exactly like native output. The plugin changes when text appears, never how it is formatted.',
      '如果系统开启了「减少动态效果」，所有入场动画与平滑滚动都会自动关闭，只保留即时呈现的文字。',
      'With reduced motion enabled at the system level, every animation here switches off automatically and text simply appears.',
      '设置面板顶部的开关可以随时关闭整个插件，对话会立刻恢复 DSH 的内置渲染，方便你直接对比两者的差别。',
      'The master switch at the top hands rendering back to the built-in view instantly, with no reload — the quickest way to compare.',
      'The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过懒狗。',
    ].join('\n\n');

    function PreviewBox(props) {
      const s = props.settings;
      const tune = activeTuning(s);
      const [segments, setSegments] = React.useState([]);
      // Simulated arrival at a steady rate; every settings change or replay
      // restarts the little stream from the top.
      React.useEffect(function () {
        setSegments([]);
        // The first batch is pre-arrived so the preview answers immediately
        // instead of sitting empty while the simulated stream accumulates.
        let arrived = Math.min(PREVIEW_TEXT.length, tune.textMinChars + 120);
        let shown = 0;
        const g = realGlobal();
        if (!g || typeof g.setInterval !== 'function') return undefined;
        const timer = g.setInterval(function () {
          arrived = Math.min(PREVIEW_TEXT.length, arrived + 26);
          const done = arrived >= PREVIEW_TEXT.length;
          const target = paragraphTarget(PREVIEW_TEXT.slice(0, arrived), shown, done, tune.textMinChars);
          if (target > shown) {
            const piece = PREVIEW_TEXT.slice(shown, target);
            shown = target;
            setSegments(function (prev) { return prev.concat([piece]); });
          }
          if (done && shown >= PREVIEW_TEXT.length) g.clearInterval(timer);
        }, 110);
        return function () { g.clearInterval(timer); };
      }, [props.replay, s.reveal, tune.fadeMs, tune.textMinChars]);

      // The pane is fixed-height with its own scrollbar, and follows its
      // bottom the same way the conversation does — so the preview also
      // demonstrates the scroll-follow.
      const paneRef = React.useRef(null);
      React.useEffect(function () {
        const el = paneRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }, [segments]);

      return React.createElement('div', {
        className: 'dss-root dss-set-preview',
        ref: paneRef,
        'data-reveal': s.reveal,
        'data-follow': s.smoothFollow || undefined,
        style: { '--dss-fade-ms': tune.fadeMs + 'ms' }
      }, segments.map(function (piece, i) {
        return React.createElement('div', {
          key: i,
          className: 'dss-fresh dss-set-piece',
          style: { whiteSpace: 'pre-wrap' }
        }, piece.replace(/^\n+|\n+$/g, ''));
      }));
    }

    function SettingsSection() {
      const s = useSettings();
      const tune = activeTuning(s);
      const [replay, setReplay] = React.useState(0);
      function setTune(patch) {
        const next = {};
        next[s.reveal] = Object.assign({}, tune, patch);
        settingsStore.set({ tuning: Object.assign({}, s.tuning, next) });
      }
      function seg(value) {
        return React.createElement('button', {
          key: value,
          type: 'button',
          className: 'dss-set-opt',
          'data-on': s.reveal === value || undefined,
          onClick: function () { settingsStore.set({ reveal: value }); setReplay(function (n) { return n + 1; }); },
        }, t('opt.' + value));
      }
      return React.createElement('div', { className: 'dss-set' },
        React.createElement('label', { className: 'dss-set-check' },
          React.createElement('input', {
            type: 'checkbox', checked: s.enabled,
            onChange: function (e) { settingsStore.set({ enabled: e.target.checked }); },
          }),
          React.createElement('span', null, t('enabled')),
          React.createElement('span', { className: 'dss-set-hint' }, t('enabledHint'))
        ),
        React.createElement('div', { className: 'dss-set-row' },
          React.createElement('span', { className: 'dss-set-label' }, t('reveal')),
          React.createElement('div', { className: 'dss-set-seg' },
            REVEAL_OPTIONS.map(seg)
          )
        ),
        React.createElement('div', { className: 'dss-set-row' },
          React.createElement('span', { className: 'dss-set-label' }, t('duration'),
            React.createElement('span', { className: 'dss-set-value' }, tune.fadeMs + ' ms')),
          React.createElement('input', {
            type: 'range', min: 120, max: 1400, step: 20, value: tune.fadeMs,
            className: 'dss-set-range',
            onChange: function (e) { setTune({ fadeMs: Number(e.target.value) }); },
            onMouseUp: function () { setReplay(function (n) { return n + 1; }); },
          }),
          React.createElement('span', { className: 'dss-set-hint' }, t('perStyleHint'))
        ),
        React.createElement('div', { className: 'dss-set-row' },
          React.createElement('span', { className: 'dss-set-label' }, t('batch'),
            React.createElement('span', { className: 'dss-set-value' }, tune.textMinChars + ' ' + t('batchUnit'))),
          React.createElement('input', {
            type: 'range', min: 80, max: 2000, step: 20, value: tune.textMinChars,
            className: 'dss-set-range',
            onChange: function (e) { setTune({ textMinChars: Number(e.target.value) }); },
          }),
          React.createElement('span', { className: 'dss-set-hint' }, t('batchHint'))
        ),
        React.createElement('label', { className: 'dss-set-check' },
          React.createElement('input', {
            type: 'checkbox', checked: s.smoothFollow,
            onChange: function (e) { settingsStore.set({ smoothFollow: e.target.checked }); },
          }),
          React.createElement('span', null, t('follow'))
        ),
        React.createElement(PreviewBox, { settings: s, replay: replay }),
        React.createElement('div', { className: 'dss-set-actions' },
          React.createElement('button', {
            type: 'button', className: 'dss-set-btn',
            onClick: function () { setReplay(function (n) { return n + 1; }); },
          }, t('replay')),
          React.createElement('button', {
            type: 'button', className: 'dss-set-btn',
            onClick: function () { settingsStore.set(SETTINGS_DEFAULTS); setReplay(function (n) { return n + 1; }); },
          }, t('reset')),
          React.createElement('a', {
            className: 'dss-set-link',
            href: 'https://github.com/SpookySandwich/dsh-plugin-smooth-stream',
            target: '_blank',
            rel: 'noreferrer',
          }, 'GitHub ↗')
        )
      );
    }

    // Registration follows the master switch live: off disposes the entry and
    // the host's own renderer takes back over, no reload needed. A collision
    // with another renderer plugin degrades to "they win, settings survive"
    // rather than throwing.
    slots.inject('conversation.chat.node', function () {
      let current = null;
      function syncRegistration() {
        const on = settingsStore.get().enabled;
        if (on && current === null) {
          try {
            current = slots.register(
              { name: 'conversation.chat.node', key: 'assistant-step', priority: -1 },
              GuardedAssistantNode
            );
          } catch (e) {
            console.warn('[dsh-plugin-smooth-stream] Unable to register assistant rendering.', e);
            current = null;
          }
        } else if (!on && current !== null) {
          try { current(); } catch (e) {}
          current = null;
        }
      }
      syncRegistration();
      const unsubscribe = settingsStore.subscribe(syncRegistration);
      return function () {
        unsubscribe();
        if (current !== null) {
          try { current(); } catch (e) {}
          current = null;
        }
      };
    });

    // Hosts older than the settings panel simply lack the slot; the guard
    // keeps the conversation renderer working there regardless.
    try {
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'smooth-stream', order: 220, label: function () { return t('nav'); } },
          SettingsSection
        );
      });
    } catch (e) {}
  }
};

    })();
  }
});
