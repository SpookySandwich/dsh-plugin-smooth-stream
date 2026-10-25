// Use the published host and an isolated headless browser, never a user profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, symlink, writeFile, copyFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
assert.ok(process.env.DSH_QA_MODULES, 'Set DSH_QA_MODULES to an official DSH node_modules directory');
const modules = resolve(process.env.DSH_QA_MODULES);
const version = JSON.parse(await readFile(join(modules, '@deepseek-ai/dsh/package.json'))).version;
const home = await mkdtemp(join(tmpdir(), 'smooth-stream-dsh-qa-'));
const profile = join(home, 'profiles', 'web');
let server, browser;
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  server.kill();
  await exited;
}
try {
  await mkdir(join(profile, 'node_modules'), { recursive: true });
  await symlink(join(modules, '@deepseek-ai'), join(profile, 'node_modules', '@deepseek-ai'), 'junction');
  await symlink(root, join(profile, 'node_modules', 'dsh-plugin-smooth-stream'), 'junction');
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'smooth-stream-qa', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-smooth-stream'] } } }));
  await copyFile(join(root, 'test/fixtures/dsh-acceptance.mjs'), join(profile, 'fixture.mjs'));
  await writeFile(join(profile, 'cordis.patch.yml'), '- insert:\n    - id: offline-qa\n      name: ./fixture.mjs\n');
  browser = await chromium.launch({ headless: true,
    ...(process.env.DSH_QA_BROWSER ? { executablePath: process.env.DSH_QA_BROWSER } : { channel: 'msedge' }) });
  for (const phase of ['fresh', 'restart']) {
    let output = '';
    server = spawn(process.execPath, ['--expose-internals', join(modules, '@deepseek-ai/dsh/lib/bin.js'),
      '--profile', 'web', '--no-open', '--port', '0'], {
      env: { ...process.env, DSH_HOME: home, DSH_QA_MODULES: modules },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    server.stdout.on('data', chunk => { output += chunk; });
    server.stderr.on('data', chunk => { output += chunk; });
    const deadline = Date.now() + 180000;
    let launchUrl;
    while (!launchUrl || !output.includes('Smooth Stream QA ready')) {
      launchUrl = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/)?.[1];
      if (server.exitCode !== null || Date.now() > deadline) throw new Error(`DSH startup failed:\n${output.replace(/token=\S+/g, 'token=[redacted]')}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
    const origin = new URL(launchUrl).origin;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await page.goto(launchUrl);
      if (phase === 'fresh') await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 60000 });
      await page.getByText('Smooth Stream acceptance', { exact: true }).first().click({ timeout: 60000 });
      await page.locator('[data-chat-group-part="response"] .dss-body').first().waitFor({ timeout: 30000 });
      for (const button of await page.getByRole('button', { name: /^Completed/ }).all()) await button.click();
      // Count the actual host's split seats, including folded process content.
      const initialCount = phase === 'fresh' ? 1 : 2;
      assert.equal(await page.locator('.dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).count(), initialCount);
      assert.equal(await page.locator('.dss-body .dss-dr-row').count(), initialCount);
      assert.equal(await page.locator('[data-chat-group-part="reasoning"] [data-dss-prose]').count(), 0);
      assert.equal(await page.locator('[data-chat-group-part="response"] .dss-dr-row').count(), 0);
      assert.equal(await page.locator('.dss-body pre').count(), initialCount);
      assert.equal(await page.locator('.dss-body table').count(), initialCount);
      console.log(`${version} ${phase}: official grouped history, Markdown code/table, single reasoning and answer passed`);
      if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `acceptance-${version}-${phase}.png`), fullPage: true });
      const response = page.request.get(`${origin}/qa/followup`);
      await page.waitForFunction(count => document.querySelectorAll('.dss-body .dss-dr-row').length === count, initialCount + 1);
      assert.equal((await response).status(), 200);
      await page.waitForFunction(count => [...document.querySelectorAll('.dss-body')].filter(el => el.textContent.includes('SMOOTH_QA_DONE')).length === count, initialCount + 1);
      assert.equal(await page.locator('.dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).count(), initialCount + 1);
      assert.equal(await page.locator('[data-chat-group-part="reasoning"] [data-dss-prose]').count(), 0);
      assert.equal(await page.locator('[data-chat-group-part="response"] .dss-dr-row').count(), 0);
      assert.deepEqual(errors, []);
      console.log(`${version} ${phase}: offline live stream completed without duplicate blocks or browser errors`);
    } catch (error) {
      if (process.env.DSH_QA_ARTIFACTS) {
        await writeFile(join(process.env.DSH_QA_ARTIFACTS, `failure-${version}-${phase}.html`), await page.content());
        await writeFile(join(process.env.DSH_QA_ARTIFACTS, `host-${version}-${phase}.log`), output.replace(/token=\S+/g, 'token=[redacted]') + '\nBrowser errors:\n' + errors.join('\n'));
      }
      throw error;
    } finally { await context.close(); }
    await stop();
  }
} finally {
  await browser?.close();
  await stop();
  await rm(home, { recursive: true, force: true });
}
