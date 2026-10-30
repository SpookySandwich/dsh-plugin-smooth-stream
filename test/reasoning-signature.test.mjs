import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

test('reasoning display hides streamed signatures and paces only displayable text', async t => {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://qa.test/' });
  const saved = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  const cleanups = [], ticks = new Set();
  t.after(async () => {
    await React.act(() => root.unmount());
    for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') cleanup();
    dom.window.close();
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = saved.act;
  });
  let plugin, View;
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => {
    if (name === 'react') return React;
    return {};
  }); } };
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
  const render = async (text, status = 'running', key = 'stream') => {
    await React.act(() => root.render(React.createElement(View, {
      key, groupPart: 'reasoning', node: { data: { status, blocks: [{ kind: 'reasoning', text }] } }, t: key => key,
    })));
    await React.act(() => { for (const tick of ticks) tick(); });
    assert.equal(dom.window.document.body.textContent.includes('metadata.payload'), false);
  };
  // A large envelope must never contribute to the 1,000-character reasoning batch.
  const envelope = '<signature>' + 'metadata.payload'.repeat(100) + '</signature>\r\n\n';
  for (const text of ['<', '<sign', '<signature', '<signature>', '<signature>metadata.payload', envelope, envelope + ' \t']) {
    await render(text);
    assert.equal(dom.window.document.querySelector('.dss-dr-row'), null, `No row for ${text.slice(0, 30)}`);
  }
  const thought = 'Displayable thought.\n';
  await render(envelope + thought);
  assert.equal(dom.window.document.querySelector('.dss-sum-fade').textContent, thought.trim());
  await React.act(() => dom.window.document.querySelector('.dss-dr-row').click());
  assert.equal(dom.window.document.querySelector('.dss-nr-body').textContent, '', 'Metadata must not advance body pacing');
  await render(envelope + thought + 'More thought.\n', 'settled');
  assert.equal(dom.window.document.querySelector('.dss-nr-body').textContent, thought + 'More thought.\n', 'Finish flushes the entire prepared body');
  await render(envelope + thought, 'settled', 'history');
  await React.act(() => dom.window.document.querySelector('.dss-dr-row').click());
  assert.equal(dom.window.document.querySelector('.dss-nr-body').textContent, thought, 'History uses prepared offsets');
  await render(envelope, 'settled', 'signature-only');
  assert.equal(dom.window.document.querySelector('.dss-dr-row'), null);
  for (const text of ['Ordinary reasoning.\n', '<signed>ordinary markup</signed>\n', 'Leading text <signature>literal</signature>\n']) {
    await render(text, 'settled', text);
    assert.equal(dom.window.document.querySelector('.dss-sum-fade').textContent, text.trim());
  }
});
