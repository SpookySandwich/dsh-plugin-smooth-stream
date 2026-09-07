import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

test('native Markdown receives current labels/streaming and assistant images use the host gallery', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'https://qa.test/' });
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  const cleanups = [];
  t.after(async () => {
    await React.act(() => root.unmount());
    for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') cleanup();
    dom.window.close();
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const markdown = [];
  const gallery = [];
  const warnings = [];
  const native = { MarkdownText: React.memo(props => {
    markdown.push(props);
    return React.createElement('p', { 'data-native-markdown': true }, props.text);
  }) };
  let plugin;
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => {
    if (name === 'react') return React;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return native;
    throw new Error(`Unexpected dependency: ${name}`);
  }); } };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document,
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args) },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  let View;
  const slots = {
    inject(_name, register) { cleanups.push(register()); },
    register(meta, component) { if (meta.key === 'assistant-step') View = component; return () => {}; },
  };
  plugin.apply({
    get: name => name === 'slots' ? slots : undefined,
    effect(fn) { cleanups.push(fn()); },
    interval() { return () => {}; },
  });
  const attachments = [{ id: 'red' }, { id: 'blue' }];
  const blocks = [{ kind: 'text', text: 'A completed paragraph.\n\n' }, ...attachments.map(attachment => ({ kind: 'image', attachment }))];
  const tLabel = key => ({ copy: '复制', copied: '已复制', 'markdown.footnotes': '脚注' })[key] ?? key;
  const render = status => root.render(React.createElement(View, {
    node: { data: { status, blocks } }, t: tLabel,
    renderMessageImages(props) { gallery.push(props); return React.createElement('div', { 'data-gallery': true }, 'Images'); },
  }));
  await React.act(() => render('settled'));
  assert.ok(dom.window.document.querySelector('[data-native-markdown]'), 'Memoized native Markdown is resolved through require');
  assert.equal(markdown.at(-1).labels.code.copyLabel, '复制');
  assert.equal(markdown.at(-1).labels.footnotes, '脚注');
  assert.equal(markdown.at(-1).streaming, false);
  const stableLabels = markdown.at(-1).labels;
  assert.equal(gallery.at(-1).align, 'start');
  assert.equal(gallery.at(-1).images.length, 2);
  assert.equal(gallery.at(-1).images[0].attachment, attachments[0]);
  assert.equal(gallery.at(-1).images[1].attachment, attachments[1]);
  await React.act(() => render('running'));
  assert.equal(markdown.at(-1).streaming, true);
  assert.equal(markdown.at(-1).labels, stableLabels, 'Stable locale must preserve the native streaming parser cache');
  await React.act(() => render('settled'));
  assert.equal(markdown.at(-1).streaming, false);
  assert.equal(warnings.length, 0);
});
