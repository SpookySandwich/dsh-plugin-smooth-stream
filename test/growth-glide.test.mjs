import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

test('streaming growth eases the reply height while the host scrollport stays untouched', async t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div data-conversation-scroll><div id="root"></div></div></body></html>', { url: 'https://qa.test/' });
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
  let content = 100;
  let reduce = false;
  const observers = [];
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = undefined; }
  };
  dom.window.matchMedia = () => ({ matches: reduce });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
    get() { return this.style.height ? parseFloat(this.style.height) : content; },
  });
  let plugin;
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => name === 'react' ? React : {}); } };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document, console, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  let View;
  plugin.apply({
    get: name => name === 'slots' ? {
      inject(_name, register) { cleanups.push(register()); },
      register(meta, component) { if (meta.key === 'assistant-step') View = component; return () => {}; },
    } : undefined,
    effect(fn) { cleanups.push(fn()); },
    interval() { return () => {}; },
  });
  const render = status => React.act(() => root.render(React.createElement(View, {
    node: { data: { status, step: 1, blocks: [{ kind: 'text', text: 'A paragraph that keeps streaming.\n\n' }] } }, t: key => key,
  })));
  const reply = () => dom.window.document.querySelector('.dss-root');
  const resize = height => { content = height; for (const observer of observers) if (observer.target) observer.callback([]); };
  const landed = () => reply().dispatchEvent(Object.assign(new dom.window.Event('transitionend'), { propertyName: 'height' }));
  const scrollport = dom.window.document.querySelector('[data-conversation-scroll]');

  await render('running');
  resize(300);
  assert.equal(reply().hasAttribute('data-dss-gliding'), true, 'A streamed batch glides');
  assert.equal(reply().style.height, '300px');
  resize(500);
  assert.equal(reply().style.height, '500px', 'Growth during a glide retargets it');
  landed();
  assert.equal(reply().hasAttribute('data-dss-gliding'), false, 'Landing releases the glide');
  assert.equal(reply().style.height, '');

  await render('settled');
  resize(700);
  assert.equal(reply().style.height, '700px', 'The batch flushed as streaming ends still glides');
  resize(800);
  assert.equal(reply().style.height, '800px', 'A running glide keeps retargeting after streaming ends');
  landed();
  resize(900);
  assert.equal(reply().hasAttribute('data-dss-gliding'), false, 'Settled growth does not glide');
  assert.equal(reply().style.height, '');

  await render('running');
  resize(1000);
  resize(400);
  assert.equal(reply().style.height, '', 'Shrinking content drops the glide at once');
  content = 650;
  await render('running');
  assert.equal(reply().style.height, '650px', 'A batch committed by a render is clamped in that commit, before the host lays it out');
  assert.equal(reply().hasAttribute('data-dss-gliding'), true);
  landed();
  reduce = true;
  resize(900);
  assert.equal(reply().hasAttribute('data-dss-gliding'), false, 'Reduced motion never glides');

  assert.equal(scrollport.getAttribute('class'), null, 'The host scrollport gets no class');
  assert.equal(scrollport.getAttribute('style'), null, 'The host scrollport gets no style');
});
