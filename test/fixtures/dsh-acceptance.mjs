// Loaded only by the acceptance runner in its disposable official DSH home.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

assert.match(process.env.DSH_HOME ?? '', /smooth-stream-dsh-qa-/);
const require = createRequire(join(process.env.DSH_QA_MODULES, 'package.json'));
const { LlmAdapter, createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class LocalReply extends LlmAdapter {
  async resolveModel(provider, model) {
    return { provider, id: model, name: 'Offline smooth stream QA', inputModalities: ['text'],
      reasoning: { efforts: [{ id: 'high', name: 'High' }] } };
  }
  async listModels(provider) { return [await this.resolveModel(provider, 'qa-model')]; }
  async *stream() {
    yield { type: 'reasoning-delta', index: 0, text: 'SMOOTH_QA_THOUGHT: one local reasoning block.\n' };
    await delay(1200);
    yield { type: 'text-delta', index: 1, text: '# SMOOTH_QA_ANSWER\n\n' + 'Paragraph batching works with the official renderer. '.repeat(12) + '\n\n' };
    await delay(600);
    yield { type: 'text-delta', index: 1, text: '```js\nconst answer = 42;\n```\n\n| Item | Value |\n| --- | --- |\n| QA | 42 |\n\nSMOOTH_QA_DONE' };
    await delay(400);
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export const inject = ['llm', 'agents', 'sessions', 'sessionQuery', 'sessionTitle', 'workspaceRegistry', 'webServer'];
export async function apply(ctx) {
  ctx.llm.registerAdapter(['qa-local'], new LocalReply());
  const cwd = join(process.env.DSH_HOME, 'fixture-workspace');
  await mkdir(cwd, { recursive: true });
  const id = 'session-smooth-qa';
  const exists = (await ctx.sessionQuery.listSessions()).some(record => record.header.id === id);
  const handle = exists
    ? await ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'qa-local', model: 'qa-model' } })
    : await ctx.agents.create({ sessionId: id, meta: { cwd }, agentOptions: { provider: 'qa-local', model: 'qa-model' } });
  ctx.effect(() => () => handle.dispose());
  const reply = async () => {
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Offline smooth stream acceptance' }] }));
    await handle.agent.whenIdle();
    await ctx.sessions.flush(handle.agent.session);
  };
  if (!exists) {
    ctx.sessionTitle.rename(handle.agent.session, 'Smooth Stream acceptance');
    const workspace = await ctx.workspaceRegistry.create(cwd, 'Smooth Stream QA');
    await workspace.attachSession(id);
    await reply();
  }
  ctx.webServer.register({ kind: 'exact', path: '/qa/followup', handler: async (_req, res) => {
    await reply();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  } });
  console.log('Smooth Stream QA ready');
}
