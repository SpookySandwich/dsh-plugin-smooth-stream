import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

function setupHarness(t) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://qa.test/' });
  const saved = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  const cleanups = [];
  const ticks = new Set();
  t.after(async () => {
    await React.act(() => root.unmount());
    for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') cleanup();
    dom.window.close();
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
  });
  let plugin, View;
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => name === 'react' ? React : {}); } };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document, console, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  plugin.apply({
    get: name => name === 'slots' ? {
      inject(_name, register) { cleanups.push(register()); },
      register(meta, component) { if (meta.key === 'assistant-step') View = component; return () => {}; },
    } : undefined,
    effect(fn) { cleanups.push(fn()); },
    interval(fn) { ticks.add(fn); return () => ticks.delete(fn); },
  });
  return { dom, root, View, ticks };
}

test('reasoning summary strips markdown syntax across settled and streaming lines', async t => {
  const { dom, root, View, ticks } = setupHarness(t);
  const cases = [
    ['settled', '### Inspect `src/foo_bar_baz.ts` with **bold**, ~~old~~, [docs](https://example.com "ref"), and ``code``\n', 'Inspect src/foo_bar_baz.ts with bold, old, docs, and code'],
    ['settled', '- *italic* and _under_ inside foo_bar_baz\n', 'italic and under inside foo_bar_baz'],
    ['running', 'First line\n> **Checking unclosed streaming prefix\n', 'Checking unclosed streaming prefix'],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [status, text, expected] = cases[i];
    await React.act(() => root.render(React.createElement(View, {
      key: `case-${i}`, groupPart: 'reasoning', node: { data: { status, blocks: [{ kind: 'reasoning', text }] } }, t: key => key,
    })));
    for (let step = 0; step < 12; step++) {
      await React.act(() => { for (const tick of ticks) tick(); });
    }
    assert.equal(dom.window.document.querySelector('.dss-sum-fade').textContent, expected);
  }
});

test('reasoning block emits data-expanded alongside data-open when toggled', async t => {
  const { dom, root, View } = setupHarness(t);
  await React.act(() => root.render(React.createElement(View, {
    groupPart: 'reasoning', node: { data: { status: 'settled', blocks: [{ kind: 'reasoning', text: 'Thought body.\n' }] } }, t: key => key,
  })));
  const thinkRoot = () => dom.window.document.querySelector('[data-variant="think"]');
  assert.equal(thinkRoot().getAttribute('data-open'), null);
  assert.equal(thinkRoot().getAttribute('data-expanded'), null);
  await React.act(() => dom.window.document.querySelector('.dss-dr-row').click());
  assert.equal(thinkRoot().getAttribute('data-open'), 'true');
  assert.equal(thinkRoot().getAttribute('data-expanded'), 'true');
  await React.act(() => dom.window.document.querySelector('.dss-dr-row').click());
  assert.equal(thinkRoot().getAttribute('data-open'), null);
  assert.equal(thinkRoot().getAttribute('data-expanded'), null);
});
