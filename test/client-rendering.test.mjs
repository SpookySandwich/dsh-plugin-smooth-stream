import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import { createRoot } from 'react-dom/client';

test('native Markdown receives labels, streaming and file links; optional host image gallery is preserved', async t => {
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
  const fileOwners = [];
  const mentions = { resolve: () => undefined };
  let fileServiceAvailable = true;
  let sessionsAvailable = true;
  let liveCwd = 'C:\\workspace\\initial';
  const sessions = {
    list: { getSnapshot: () => ({ byId: { 'qa-session': { cwd: 'C:\\workspace' } } }) },
    binding: () => ({ session: { projections: { faceOf: () => ({ getSnapshot: () => liveCwd }) } } }),
  };
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
  let View, injected;
  const slots = {
    inject(_name, register) { cleanups.push(register()); },
    register(meta, component) {
      if (meta.key === 'assistant-step') {
        assert.equal(meta.locale, 'chat', 'The slot must bind the host chat translations');
        View = component;
        injected = meta.inject?.('qa-session');
      }
      return () => {};
    },
  };
  plugin.apply({
    get: name => name === 'slots' ? slots : name === 'chatFileMentions' && fileServiceAvailable ? {
      forClosing(owner, sessionId, getFileTriggerProps) { fileOwners.push({ owner, sessionId, getFileTriggerProps }); return mentions; },
    } : name === 'sessions' && sessionsAvailable ? sessions : undefined,
    effect(fn) { cleanups.push(fn()); },
    interval() { return () => {}; },
  });
  const attachments = [{ id: 'red' }, { id: 'blue' }];
  const blocks = [{ kind: 'reasoning', text: 'A complete local thought.' }, { kind: 'text', text: 'A completed paragraph.\n\n' }, ...attachments.map(attachment => ({ kind: 'image', attachment }))];
  const tLabel = key => ({ copy: '复制', copied: '已复制', 'markdown.footnotes': '脚注' })[key] ?? key;
  const render = (status, turnProcess) => root.render(React.createElement(View, {
    node: { data: { status, blocks, step: 1 } }, t: tLabel, turnProcess,
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
  const process = { foldable: true, spec: { answerStep: 1, inlineReasoning: true }, open: false };
  await React.act(() => render('settled', process));
  assert.equal(dom.window.document.querySelector('.dss-dr-row'), null, 'Respect the host process fold');
  await React.act(() => render('settled', { ...process, open: true }));
  assert.ok(dom.window.document.querySelector('.dss-dr-row'), 'Opening the host process reveals reasoning');
  assert.equal(warnings.length, 0);
  // rc.1 no longer supplies fileMentions in ChatNodeOwnerProps. The replacement
  // renderer must bind the host's session-scoped resolver itself.
  const turn = { status: 'closed' };
  const finalNode = { seq: 42 };
  const openFile = () => {};
  const renderClosing = (tailSeq, ownerResolver) => root.render(React.createElement(View, {
    ...injected, node: { data: { status: 'settled', blocks, finalNode }, location: { kind: 'turn', turn } },
    useTurnData: () => ({ closing: { finalNode: { seq: tailSeq } } }), openFile,
    fileMentions: ownerResolver,
  }));
  await React.act(() => renderClosing(42));
  assert.equal(markdown.at(-1).fileMentions, mentions, 'Current host closing file links reach native Markdown');
  assert.equal(fileOwners.at(-1).sessionId, 'qa-session');
  assert.equal(fileOwners.at(-1).owner.turn, turn);
  assert.equal(fileOwners.at(-1).owner.seq, 42);
  assert.equal(fileOwners.at(-1).owner.openFile, openFile);
  await React.act(() => renderClosing(41));
  assert.equal(markdown.at(-1).fileMentions, undefined, 'Nonclosing messages do not acquire file links');
  const legacyMentions = { resolve: () => 'legacy' };
  await React.act(() => renderClosing(42, () => legacyMentions));
  assert.equal(markdown.at(-1).fileMentions, legacyMentions, 'Retained hosts keep their owner resolver');
  fileServiceAvailable = false;
  await React.act(() => renderClosing(42));
  assert.equal(markdown.at(-1).fileMentions, undefined, 'An unavailable optional file service leaves Markdown readable');
  fileServiceAvailable = true;
  const getTriggerProps = target => ({ onContextMenu: () => target() });
  const useContextMenu = () => ({ getTriggerProps });
  const renderInteractive = (status, messageId, menuHook = useContextMenu) => root.render(React.createElement(View, {
    ...injected, sessionId: 'qa-session', useContextMenu: menuHook,
    node: { data: { status, blocks, finalNode: { seq: 42, messageId } }, location: { kind: 'turn', turn } },
    useTurnData: () => ({ closing: { finalNode: { seq: 42 } } }), openFile,
  }));
  await React.act(() => renderInteractive('settled', 'message-42'));
  assert.equal(markdown.at(-1).textInteractionSource, true, 'Settled durable reply supports native Quote');
  await React.act(() => dom.window.document.querySelector('.dss-dr-row').click());
  assert.ok(dom.window.document.querySelector('.dss-nr-body[data-text-interaction-source]'), 'Expanded settled reasoning supports native Quote');
  const trigger = fileOwners.at(-1).getFileTriggerProps('./report.txt');
  liveCwd = 'C:\\workspace\\changed';
  const target = trigger.onContextMenu();
  assert.equal(target.kind, 'file');
  assert.equal(target.value.sessionId, 'qa-session');
  assert.equal(target.value.path, 'C:\\workspace\\changed\\report.txt', 'Resolve current session directory when the gesture fires');
  for (const path of ['C:\\elsewhere\\report.txt', '/tmp/report.txt', '\\\\server\\share\\report.txt']) {
    assert.equal(fileOwners.at(-1).getFileTriggerProps(path).onContextMenu().value.path, path);
  }
  liveCwd = undefined;
  assert.equal(trigger.onContextMenu().value.path, 'C:\\workspace\\report.txt', 'Workspace fallback');
  liveCwd = '/work/current';
  assert.equal(trigger.onContextMenu().value.path, '/work/current/report.txt', 'POSIX directory');
  sessionsAvailable = false;
  assert.equal(trigger.onContextMenu().value.path, './report.txt', 'Optional session service may be unavailable');
  for (const [status, messageId] of [['running', 'message-42'], ['interrupted', 'message-42'], ['settled', undefined]]) {
    await React.act(() => renderInteractive(status, messageId));
    assert.equal(markdown.at(-1).textInteractionSource, false, `${status}/${messageId}: native Quote eligibility`);
    assert.equal(dom.window.document.querySelector('.dss-nr-body[data-text-interaction-source]'), null);
  }
  await React.act(() => renderInteractive('settled', 'message-42', null));
  assert.equal(fileOwners.at(-1).getFileTriggerProps, undefined, 'Older hosts without context menus retain ordinary links');
});
