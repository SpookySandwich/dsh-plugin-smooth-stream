import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

for (const failMarkdown of [false, true]) {
  test(`split host seats render each block once${failMarkdown ? ' after a Markdown failure' : ''}`, async t => {
    const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://qa.test/' });
    const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(dom.window.document.getElementById('root'));
    const cleanups = [];
    const errors = [];
    const originalError = console.error;
    if (failMarkdown) console.error = (...args) => errors.push(args);
    t.after(async () => {
      await React.act(() => root.unmount());
      for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') cleanup();
      dom.window.close();
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
      console.error = originalError;
    });
    let plugin, View;
    dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => {
      if (name === 'react') return React;
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: props => {
        if (failMarkdown) throw new Error('Intentional Markdown failure');
        return React.createElement('p', null, props.text);
      } };
      throw new Error(`Unexpected dependency ${name}`);
    }); } };
    runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
      window: dom.window, document: dom.window.document, console,
      setTimeout, clearTimeout, setInterval, clearInterval,
    });
    plugin.apply({
      get: name => name === 'slots' ? {
        inject(_name, register) { cleanups.push(register()); },
        register(meta, component) {
          if (meta.key === 'assistant-step') View = component;
          return () => {};
        },
      } : undefined,
      effect(fn) { cleanups.push(fn()); },
      interval() { return () => {}; },
    });
    const attachments = [{ id: 'one' }, { id: 'two' }];
    const blocks = [{ kind: 'reasoning', text: 'Unique reasoning.' },
      { kind: 'text', text: 'Unique answer.\n\n' },
      ...attachments.map(attachment => ({ kind: 'image', attachment })),
      { kind: 'other', block: { value: 42 } }];
    const loadImage = async () => 'data:image/png;base64,AA==';
    const render = (status, parts = ['reasoning', 'response'], content = blocks) => root.render(
      React.createElement(React.Fragment, null, ...parts.map(part => React.createElement('section', { key: part, 'data-part': part },
        React.createElement(View, {
          groupPart: part, node: { data: { status, blocks: content } }, loadImage,
          t: key => key,
          renderMessageImages(props) {
            assert.equal(props.align, 'start');
            assert.deepEqual(Array.from(props.images, image => image.attachment), attachments);
            return React.createElement('div', { 'data-gallery': true }, 'Image gallery');
          },
        })))));
    await React.act(() => render('running'));
    await React.act(() => render('interrupted'));
    const reasoning = dom.window.document.querySelector('[data-part="reasoning"]');
    const response = dom.window.document.querySelector('[data-part="response"]');
    assert.equal(reasoning.textContent.includes('Unique answer.'), false, 'Reasoning seat must not duplicate the answer');
    assert.equal(response.textContent.includes('Unique reasoning.'), false, 'Response seat must not duplicate reasoning');
    assert.equal(dom.window.document.body.textContent.split('Unique answer.').length - 1, 1);
    assert.equal(dom.window.document.body.textContent.split('Unique reasoning.').length - 1, 1);
    if (failMarkdown) {
      assert.ok(errors.length > 0, 'Exercise the error boundary');
      return;
    }
    assert.equal(dom.window.document.querySelectorAll('[data-gallery]').length, 1);
    assert.equal(reasoning.textContent.includes('[data]'), false);
    assert.equal(response.textContent.includes('[data]'), true);
    assert.equal(dom.window.document.querySelectorAll('.dss-stopped').length, 1);
    assert.equal(response.querySelectorAll('.dss-stopped').length, 1);
    await React.act(() => render('settled'));
    assert.equal(dom.window.document.querySelectorAll('.dss-stopped').length, 0);
    await React.act(() => render('interrupted', ['reasoning'], [blocks[0]]));
    assert.equal(dom.window.document.querySelectorAll('.dss-stopped').length, 1, 'Reasoning-only interrupted output keeps its stop marker');
    await React.act(() => render('settled', [undefined]));
    assert.equal(dom.window.document.querySelectorAll('.dss-dr-row').length, 1, 'Unsplit hosts still render reasoning');
    assert.equal(dom.window.document.querySelectorAll('[data-gallery]').length, 1);
  });
}
