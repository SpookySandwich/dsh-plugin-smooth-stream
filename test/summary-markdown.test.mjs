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
    ['settled', '**See (https://example.com/a_(b))** and “www.example.com/_x_/post”.', 'See (https://example.com/a_(b)) and “www.example.com/_x_/post”.'],
    ['running', '~~See http://example.com/~draft~/*x*/y~~ and *done*\n', 'See http://example.com/~draft~/*x*/y and done'],
    ['settled', '[https://example.com](path_(v2)) or https://example.com/_x_<b>**here**</b>', 'https://example.com or https://example.com/_x_<b>here</b>'],
    ['settled', '[https://example.com/__tests__](guide) and https://example.com/__tests__', 'https://example.com/tests and https://example.com/__tests__'],
    ['running', '**Math** $$a*b $ c*d$$ and `cost $5` then ~~old~~\n', 'Math $$a*b $ c*d$$ and cost $5 then old'],
    ['settled', 'x ~a~ ~~gone~~ ~~~literal~~~ ~~~~also literal~~~~', 'x ~a~ gone ~~~literal~~~ ~~~~also literal~~~~'],
    ['settled', '> ## Working with C# ##\nSecond line', 'Working with C#'],
    ['running', 'First line\n> **Checking unclosed streaming prefix\n', 'Checking unclosed streaming prefix'],
    ['running', 'First line\n- ## ~~Checking a prefix\nStill arriving', 'Checking a prefix'],
    ['running', 'First line\n> **“Checking” again\n', '“Checking” again'],
    ['running', 'First line\nInspect `a ** b\nStill arriving', 'Inspect a ** b'],
    ['settled', 'a***b***c and (_one_) with “**two**”', 'abc and (one) with “two”'],
    ['settled', '*one _two* three_ and _four [five_](/url)', 'one _two three_ and _four five_'],
    ['settled', '**a<https://example.com/?q=**> and __<a title="__">', '**ahttps://example.com/?q=** and __<a title="__">'],
    ['running', 'First line\nRead [docs](https://example.com/a_(b\n', 'Read docs'],
    ['settled', 'Compare `a ** b` and ``x `y` ~~z~~`` with [**docs**](https://example.com/a_(b)).\nLast line', 'Compare a ** b and x `y` ~~z~~ with docs.'],
    ['settled', '**Use `a ** b`** and [the `]` key](guide_(v2) "See (v2)")', 'Use a ** b and the ] key'],
    ['settled', 'Use 2 * 3, foo_bar_baz, and \\*literal stars\\*.', 'Use 2 * 3, foo_bar_baz, and *literal stars*.'],
  ];
  for (const line of [
    'Search for src/**/*.ts files',
    'Glob **/*.test.mjs to find tests',
    'Check self._cache before calling',
    'def f(*args, **kwargs):',
    'Edit README_*.md next',
    'Compute 2**10 = 1024',
    'Check ~~pending before retrying',
    'See https://docs.python.org/3/library/__future__.html for details',
    'Tests live in https://github.com/org/repo/tree/main/src/__tests__ today',
    'Then open www.example.com/_drafts_/post',
    'URL http://a.com/*x*/y end',
    'Math $a*b$ and $c*d$ here',
    'So $(a)_{n}$ and $(b)_{m}$ converge',
    'x ~~~foo~~~',
    'Compare $$a*b + c*d$$ next',
    'Price is $5 * 3 and $6 * 2',
  ]) {
    cases.push(['settled', line + '\nLast line', line], ['running', 'First line\n' + line + '\n', line]);
  }
  for (let i = 0; i < cases.length; i++) {
    const [status, text, expected] = cases[i];
    await React.act(() => root.render(React.createElement(View, {
      key: `case-${i}`, groupPart: 'reasoning', node: { data: { status, blocks: [{ kind: 'reasoning', text }] } }, t: key => key,
    })));
    await React.act(() => { for (const tick of ticks) tick(); });
    assert.equal(dom.window.document.querySelector('.dss-sum-fade').textContent, expected, text);
  }
});

test('reasoning block emits data-expanded alongside data-open when toggled', async t => {
  const { dom, root, View } = setupHarness(t);
  const text = '### **Thought**\n\nRead [docs](https://example.com/a_(b)).';
  await React.act(() => root.render(React.createElement(View, {
    groupPart: 'reasoning', node: { data: { status: 'settled', blocks: [{ kind: 'reasoning', text }] } }, t: key => key,
  })));
  const block = dom.window.document.querySelector('[data-variant="think"]');
  const row = block.querySelector('[role="button"]');
  function checkState(expanded) {
    assert.equal(block.getAttribute('data-open'), expanded ? 'true' : null);
    assert.equal(block.getAttribute('data-expanded'), expanded ? 'true' : null);
    assert.equal(row.getAttribute('aria-expanded'), String(expanded));
    assert.equal(block.querySelector('.dss-nr-body')?.textContent, expanded ? text : undefined);
    assert.equal(row.querySelector('.dss-sum-fade')?.textContent, expanded ? undefined : 'Thought');
  }
  checkState(false);
  await React.act(() => row.click());
  checkState(true);
  for (const [key, expanded] of [['Enter', false], [' ', true]]) {
    await React.act(() => row.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })));
    checkState(expanded);
  }
  await React.act(() => row.click());
  checkState(false);
});
