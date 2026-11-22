// Loaded only by the acceptance runner in its disposable official DSH home.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

assert.match(process.env.DSH_HOME ?? '', /smooth-stream-dsh-qa-/);
const require = createRequire(join(process.env.DSH_QA_MODULES, 'package.json'));
const { LlmAdapter, createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let image, scenario = 'normal', cancelForQA;
class LocalReply extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: 'Offline smooth stream QA', inputModalities: ['text'],
      reasoning: { efforts: [{ id: 'high', name: 'High' }] } };
  }
  async listModels(provider) { return [await this.resolveModel(provider, 'qa-model')]; }
  async *stream(options) {
    if (scenario === 'short') {
      yield { type: 'text-delta', index: 0, text: 'SMOOTH_QA_FOLLOW_READY' };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    if (scenario === 'long') {
      for (let i = 1; i <= 30; i++) {
        yield { type: 'text-delta', index: 0, text: `SMOOTH_QA_LONG_${i}: ` + 'Scroll follow keeps the newest batch in view. '.repeat(8) + '\n\n' };
        await delay(80);
      }
      yield { type: 'text-delta', index: 0, text: 'SMOOTH_QA_LONG_DONE' };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
    if (scenario !== 'normal') {
      yield { type: 'reasoning-delta', index: 0, text: `SMOOTH_QA_${scenario}_THOUGHT\n` };
      yield { type: 'text-delta', index: 1, text: `# SMOOTH_QA_${scenario}_PARTIAL\n\n` + 'Partial streaming output. '.repeat(30) + '\n\n' };
      await delay(1200);
      if (scenario === 'interrupted') {
        cancelForQA();
        options.signal?.throwIfAborted();
        return;
      }
      throw new Error('SMOOTH_QA_EXPECTED_FAILURE');
    }
    const signatures = process.env.DSH_QA_SIGNATURES === '1';
    if (signatures) {
      // Exercise a prefix, an unfinished envelope, CRLF/LF trimming, and a
      // metadata-only second block through the actual official stream pipeline.
      for (const text of ['<sign', 'ature>metadata.payload', '</signature>\r\n\n']) {
        yield { type: 'reasoning-delta', index: 0, text };
        await delay(350);
      }
    }
    const thought = process.env.DSH_QA_THOUGHT || 'SMOOTH_QA_THOUGHT: one local reasoning block.\n';
    const firstLineEnd = thought.indexOf('\n');
    yield { type: 'reasoning-delta', index: 0, text: thought.slice(0, firstLineEnd) };
    await delay(1200); // Keep the first line unfinished long enough to inspect the summary.
    yield { type: 'reasoning-delta', index: 0, text: thought.slice(firstLineEnd) };
    await delay(1200);
    if (signatures) {
      yield { type: 'reasoning-delta', index: 1, text: '<signature>metadata.only</signature>\n\n' };
      await delay(350);
    }
    const answerIndex = signatures ? 2 : 1;
    yield { type: 'text-delta', index: answerIndex, text: '# SMOOTH_QA_ANSWER\n\n' + 'Paragraph batching works with the official renderer. '.repeat(12) + '\n\n' };
    await delay(600);
    yield { type: 'text-delta', index: answerIndex, text: '```js\nconst answer = 42;\n```\n\n| Item | Value |\n| --- | --- |\n| QA | 42 |\n\nSMOOTH_QA_DONE' };
    if (process.env.DSH_QA_FILES === '1') yield { type: 'text-delta', index: answerIndex, text: '\n\nSee `smooth-qa.txt` for the saved fixture.' };
    if (process.env.DSH_QA_PATH_IMAGES === '1') yield { type: 'text-delta', index: answerIndex,
      text: `\n\n![SMOOTH_QA_PATH_IMAGE](${join(process.env.DSH_HOME, 'fixture-workspace', 'smooth-qa.png').replaceAll('\\', '/')})` };
    if (image) yield { type: 'block-end', index: answerIndex + 1, block: { type: 'image', attachment: image } };
    await delay(400);
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const inject = ['llm', 'agents', 'sessions', 'sessionQuery', 'sessionTitle', 'workspaceRegistry', 'webServer', 'attachments'];
export async function apply(ctx) {
  ctx.llm.registerAdapter(['qa-local'], new LocalReply());
  if (process.env.DSH_QA_IMAGES === '1') {
    const sharp = require('sharp');
    const data = await sharp({ create: { width: 160, height: 80, channels: 3, background: '#4b8dff' } }).png().toBuffer();
    image = await ctx.attachments.saveImage({ data, mediaType: 'image/png', name: 'smooth-qa.png' });
  }
  const cwd = join(process.env.DSH_HOME, 'fixture-workspace');
  await mkdir(cwd, { recursive: true });
  if (process.env.DSH_QA_PATH_IMAGES === '1') {
    const data = await require('sharp')({ create: { width: 160, height: 80, channels: 3, background: '#4b8dff' } }).png().toBuffer();
    await writeFile(join(cwd, 'smooth-qa.png'), data);
  }
  if (process.env.DSH_QA_FILES === '1') await writeFile(join(cwd, 'smooth-qa.txt'), 'SMOOTH_QA_FILE_CONTENT\n');
  const id = 'session-smooth-qa';
  const exists = (await ctx.sessionQuery.listSessions()).some(record => record.header.id === id);
  const handle = exists
    ? await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'qa-local', model: 'qa-model' } })
    : await ctx.agents.create({ sessionId: id, meta: { cwd }, agentOptions: { provider: 'qa-local', model: 'qa-model' } });
  ctx.effect(() => () => handle.dispose());
  cancelForQA = () => handle.agent.cancel({ kind: 'user' });
  const reply = async () => {
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Offline smooth stream acceptance' }] }));
    await handle.agent.whenIdle();
    if (process.env.DSH_QA_FILES === '1' && scenario === 'normal') {
      // A deterministic delivery event exercises the official Deliverables
      // projection and file-mention service without invoking a remote model.
      handle.agent.session.append('deliverables/presented', {
        turn: ctx.agents.turnBoundaryOf(handle.agent.session).lastTurn,
        callId: 'smooth-qa-present', files: [{ path: join(cwd, 'smooth-qa.txt') }],
      });
    }
    await ctx.sessions.flush(handle.agent.session);
  };
  let workspace;
  if (!exists) {
    ctx.sessionTitle.rename(handle.agent.session, 'Smooth Stream acceptance');
    workspace = await ctx.workspaceRegistry.create(cwd, 'Smooth Stream QA');
    await workspace.attachSession(id);
    await reply();
  }
  if (process.env.DSH_QA_FOLLOW === '1') {
    const followId = 'session-smooth-follow';
    const known = (await ctx.sessionQuery.listSessions()).some(record => record.header.id === followId);
    const follow = known
      ? await ctx.agents.resume({ resumeSessionId: followId, agentOptions: { provider: 'qa-local', model: 'qa-model' } })
      : await ctx.agents.create({ sessionId: followId, meta: { cwd }, agentOptions: { provider: 'qa-local', model: 'qa-model' } });
    ctx.effect(() => () => follow.dispose());
    const run = async (kind, text) => {
      scenario = kind;
      try {
        follow.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }));
        await follow.agent.whenIdle();
      } finally { scenario = 'normal'; }
      await ctx.sessions.flush(follow.agent.session);
    };
    if (!known) {
      ctx.sessionTitle.rename(follow.agent.session, 'Smooth Stream follow');
      await workspace.attachSession(followId);
      await run('short', 'Short opening turn');
    }
    ctx.webServer.register({ kind: 'exact', path: '/qa/long', handler: async (_req, res) => {
      await run('long', 'Long streamed reply');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    } });
  }
  ctx.webServer.register({ kind: 'exact', path: '/qa/followup', handler: async (_req, res) => {
    await reply();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  } });
  if (process.env.DSH_QA_EDGE_CASES === '1') {
    for (const kind of ['interrupted', 'error']) ctx.webServer.register({ kind: 'exact', path: `/qa/${kind}`, handler: async (_req, res) => {
      scenario = kind;
      try { await reply(); } finally { scenario = 'normal'; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    } });
  }
  console.log('Smooth Stream QA ready');
}
