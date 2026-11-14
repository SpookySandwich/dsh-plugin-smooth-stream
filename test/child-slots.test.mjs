import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

const reasoningSlot = 'conversation.chat.reasoning.body';
const imagesSlot = 'conversation.chat.message.images';

function mountPlugin(t, providers = {}) {
  const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>', { url: 'https://qa.test/' });
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  const cleanups = [], ticks = new Set(), calls = [];
  const declared = new Set([reasoningSlot, imagesSlot]);
  t.after(async () => {
    await React.act(() => root.unmount());
    for (const cleanup of cleanups.reverse()) if (typeof cleanup === 'function') cleanup();
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
  });
  let plugin, View, meta, disposeRegistration;
  let active = true;
  dom.window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => name === 'react' ? React : {}); } };
  runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document, console, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  plugin.apply({
    get: name => name === 'slots' ? {
      inject(name, register) {
        const dispose = register();
        cleanups.push(dispose);
        if (name === 'conversation.chat.node') disposeRegistration = dispose;
      },
      spec(name) { return declared.has(name) ? { kind: 'single', scope: 'session' } : undefined; },
      register(options, component) {
        // SlotCore rejects duplicate declarations, including shadowed entries.
        for (const name of Object.keys(options.children ?? {})) {
          assert.equal(declared.has(name), false, `slot "${name}" is already declared`);
        }
        if (options.key === 'assistant-step') { meta = options; View = component; }
        return () => { if (options.key === 'assistant-step') active = false; };
      },
    } : undefined,
    effect(fn) { cleanups.push(fn()); },
    interval(fn) { ticks.add(fn); return () => ticks.delete(fn); },
  });
  // Like DSH, bind renderSlot only for entries declaring children. The outlet
  // renders its elected provider, or opts.fallback when the slot has no entries.
  function Outlet({ name, owner, options }) {
    const Component = providers[name];
    return Component ? React.createElement(Component, owner) : options?.fallback ?? null;
  }
  const renderSlot = meta.children === undefined ? undefined : (name, owner, options) => {
    assert.equal(meta.children[name]?.kind, 'single');
    assert.equal(meta.children[name]?.scope, 'session');
    calls.push({ name, owner });
    assert.equal(active, true, 'renderSlot cannot be called from a disposed registration');
    return React.createElement(Outlet, { name, owner, options });
  };
  return {
    document: dom.window.document, meta, calls, declared,
    async render(blocks, status = 'settled', extra = {}, parts = [undefined]) {
      await React.act(() => root.render(React.createElement(React.Fragment, null, ...parts.map(part =>
        React.createElement('section', { key: part ?? 'all', 'data-part': part }, React.createElement(View, {
          renderSlot, groupPart: part, node: { data: { blocks, status, step: 1, finalNode: { messageId: 'saved' } } },
          t: key => key, ...extra,
        }))))));
    },
    async retire() { await React.act(() => disposeRegistration()); },
    async tick() { await React.act(() => { for (const tick of ticks) tick(); }); },
    async expand() { await React.act(() => dom.window.document.querySelector('.dss-dr-row').click()); },
  };
}

test('expanded reasoning mounts child contributions with raw text, live display text and tail status', async t => {
  let mode = 'translation';
  const owners = [];
  function ReasoningBody(props) {
    const [original, setOriginal] = React.useState(false);
    owners.push(props);
    if (mode === 'empty') return null;
    if (mode === 'default') return React.createElement('p', { 'data-default-reasoning': true }, props.text);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => setOriginal(value => !value) }, original ? '查看译文' : '查看原文'),
      React.createElement('p', null, original ? props.text : '翻译后的思考'));
  }
  const view = mountPlugin(t, { [reasoningSlot]: ReasoningBody });
  const envelope = '<signature>metadata.payload</signature>\r\n\n';
  let thought = '**A short thought without a newline.**';
  const blocks = () => Object.freeze([Object.freeze({ kind: 'reasoning', text: envelope + thought })]);
  const initial = blocks();
  await view.render(initial, 'running');
  assert.ok(view.document.querySelector('.dss-dr-row'), 'A child body must be reachable before the first summary/body batch');
  assert.equal(owners.length, 0, 'Collapsed rows do not mount the body contribution');
  await view.expand();
  assert.equal(view.document.querySelector('.dss-nr-body button')?.textContent, '查看原文');
  assert.equal(view.document.querySelector('.dss-nr-body p')?.textContent, '翻译后的思考');
  assert.equal(owners.at(-1).rawText, envelope + thought);
  assert.equal(owners.at(-1).text, thought);
  assert.equal(owners.at(-1).running, true);
  assert.equal(initial[0].text, envelope + thought, 'Display preparation must not mutate host blocks');
  assert.doesNotMatch(view.document.body.textContent, /signature|metadata\.payload/);
  await React.act(() => view.document.querySelector('.dss-nr-body button').click());
  assert.equal(view.document.querySelector('.dss-nr-body p').textContent, thought);
  thought += ' More streaming text.';
  await view.render(blocks(), 'running');
  assert.equal(owners.at(-1).text, thought, 'Slots receive each update without Smooth Stream batching');
  assert.equal(owners.at(-1).rawText, envelope + thought);
  await view.render([...blocks(), { kind: 'text', text: 'Answer.\n\n' }], 'running');
  assert.equal(owners.at(-1).running, false, 'Only the final block is a running reasoning body');
  await view.render(blocks(), 'settled');
  assert.equal(owners.at(-1).running, false);
  assert.ok(view.document.querySelector('.dss-nr-body[data-text-interaction-source]'), 'Preserve native Quote eligibility');
  assert.ok(view.document.querySelector('.dss-nr-root[data-settling]'), 'Preserve the closing underline');
  mode = 'default';
  await view.render(blocks());
  assert.equal(view.document.querySelector('[data-default-reasoning]').textContent, thought, 'The default provider can replace translation');
  mode = 'empty';
  await view.render(blocks());
  assert.equal(view.document.querySelector('.dss-nr-body').textContent, '', 'A provider returning null must not trigger local fallback');
  mode = 'default';
  await view.render(blocks(), 'interrupted');
  assert.equal(owners.at(-1).running, false);
  assert.equal(view.document.querySelector('.dss-nr-body[data-text-interaction-source]'), null);
  await view.render(blocks(), 'settled', { turnProcess: { foldable: true, spec: { answerStep: 1, inlineReasoning: true }, open: false } });
  assert.equal(view.document.querySelector('.dss-dr-row'), null, 'Honor the host process fold');
  for (const text of ['<', '<signature>metadata.payload', envelope, envelope + ' \t']) {
    await view.render([{ kind: 'reasoning', text }], 'running');
    assert.equal(view.document.querySelector('.dss-dr-row'), null, 'Signature-only content must not mount a body');
  }
  assert.equal(Object.keys(view.meta.children).length, 0, 'References must not redeclare or release the host-owned children');
  assert.deepEqual(JSON.parse(JSON.stringify(Object.fromEntries([reasoningSlot, imagesSlot].map(name => [name, view.meta.children[name]])))), {
    [reasoningSlot]: { kind: 'single', scope: 'session' },
    [imagesSlot]: { kind: 'single', scope: 'session' },
  });
});

test('a streaming reasoning row shows its separator only after a summary is available', async t => {
  const view = mountPlugin(t);
  let thought = 'A streaming first line';
  const blocks = () => [{ kind: 'reasoning', text: thought }];
  await view.render(blocks(), 'running');
  await view.tick();
  assert.ok(view.document.querySelector('.dss-dr-title'), 'The early row remains expandable');
  assert.equal(view.document.querySelectorAll('.dss-nr-separator').length, 0);
  assert.equal(view.document.querySelectorAll('.dss-nr-summary').length, 0);
  thought += '\nAn unfinished second line';
  await view.render(blocks(), 'running');
  await view.tick();
  assert.equal(view.document.querySelector('.dss-nr-summary').textContent, 'A streaming first line');
  assert.equal(view.document.querySelectorAll('.dss-nr-separator').length, 1);
  await view.expand();
  assert.equal(view.document.querySelectorAll('.dss-nr-separator').length, 0);
  assert.equal(view.document.querySelectorAll('.dss-nr-summary').length, 0);
});

test('image child slots receive grouped attachments and the loader without remounting on append', async t => {
  let mounts = 0;
  const owners = [];
  function Gallery(props) {
    const [id] = React.useState(() => ++mounts);
    owners.push(props);
    return React.createElement('button', { 'data-gallery': id }, props.images.map(image => image.attachment.id).join(','));
  }
  const view = mountPlugin(t, { [imagesSlot]: Gallery });
  const attachments = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  const image = index => ({ kind: 'image', attachment: attachments[index] });
  const loadImage = () => { throw new Error('The slot owns image loading'); };
  const extra = { loadImage, renderMessageImages() { throw new Error('Do not invoke the legacy gallery when a child provider exists'); } };
  const prefix = [{ kind: 'reasoning', text: 'Thought.\n' }, { kind: 'text', text: 'Answer.\n\n' }];
  await view.render([...prefix, image(0)], 'running', extra, ['reasoning', 'response']);
  assert.equal(view.document.querySelectorAll('[data-gallery]').length, 1);
  const first = view.document.querySelector('[data-gallery]');
  assert.equal(owners.at(-1).loadImage, loadImage);
  assert.equal(owners.at(-1).align, 'start');
  assert.equal(owners.at(-1).images[0].attachment, attachments[0]);
  await view.render([...prefix, image(0), image(1)], 'running', extra, ['reasoning', 'response']);
  assert.equal(view.document.querySelector('[data-gallery]'), first, 'Appending an image must preserve gallery state');
  assert.equal(first.textContent, 'one,two');
  assert.equal(mounts, 1);
  assert.deepEqual(Array.from(owners.at(-1).images, image => image.attachment), attachments.slice(0, 2));
  await view.render([...prefix, image(0), image(1), { kind: 'text', text: 'Between.\n\n' }, image(2)], 'settled', extra, ['reasoning', 'response']);
  assert.equal(view.document.querySelectorAll('[data-gallery]').length, 2, 'Separate consecutive image groups');
  assert.equal(view.document.querySelector('[data-part="reasoning"] [data-gallery]'), null);
  assert.equal(view.document.querySelector('[data-part="response"] .dss-dr-row'), null);
  assert.equal(view.document.querySelector('[data-gallery]'), first);
  const callsBefore = view.calls.length;
  await view.retire();
  await view.render([...prefix, image(0)], 'settled', extra, ['reasoning', 'response']);
  assert.equal(view.calls.length, callsBefore, 'A retained component must not invoke its disposed slot binding');
  assert.equal(view.document.querySelector('[data-gallery]'), null);
});

test('hosts without child providers retain paced reasoning, legacy galleries and plain image fallback', async t => {
  const view = mountPlugin(t);
  const attachment = { id: 'old-host' };
  const thought = 'A short local thought.\n';
  const reasoning = { kind: 'reasoning', text: '<signature>metadata.payload</signature>\n' + thought };
  await view.render([reasoning], 'running');
  await view.tick();
  await view.expand();
  assert.equal(view.document.querySelector('.dss-nr-body').textContent, '', 'Fallback body keeps its existing pacing');
  await view.render([reasoning], 'settled');
  assert.equal(view.document.querySelector('.dss-nr-body').textContent, thought);
  assert.ok(view.calls.some(call => call.name === reasoningSlot), 'Exercise an injected slot with no providers');
  view.declared.clear();
  const callsBefore = view.calls.length;
  const galleries = [];
  const blocks = [reasoning, { kind: 'image', attachment }];
  await view.render(blocks, 'settled', { renderMessageImages(props) {
    galleries.push(props);
    return React.createElement('button', { 'data-legacy-gallery': true }, 'Legacy gallery');
  } });
  assert.ok(view.document.querySelector('[data-legacy-gallery]'));
  assert.equal(galleries.at(-1).images[0].attachment, attachment);
  assert.equal(galleries.at(-1).align, 'start');
  const loaded = [];
  await view.render(blocks, 'settled', { loadImage: async image => {
    loaded.push(image);
    return 'data:image/png;base64,AA==';
  } });
  assert.deepEqual(loaded, [attachment]);
  assert.equal(view.document.querySelectorAll('.dss-image').length, 1);
  assert.equal(view.document.querySelector('.dss-nr-body').textContent, thought);
  assert.equal(view.calls.length, callsBefore, 'Undeclared slots must also use the legacy fallback');
  assert.doesNotMatch(view.document.body.textContent, /signature|metadata\.payload/);
});
