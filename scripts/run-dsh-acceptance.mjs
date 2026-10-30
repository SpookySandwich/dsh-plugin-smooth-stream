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
const signatures = process.env.DSH_QA_SIGNATURES === '1';
const home = await mkdtemp(join(process.env.DSH_QA_TMP || tmpdir(), 'smooth-stream-dsh-qa-'));
const profile = join(home, 'profiles', 'web');
let server, browser;
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit');
  server.kill();
  await exited;
  console.log(`${version}: stopped host PID ${server.pid}`);
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
  console.log(`${version}: browser ${browser.version()}, isolated home ${home}`);
  for (const phase of ['fresh', 'restart']) {
    let output = '';
    server = spawn(process.execPath, ['--expose-internals', join(modules, '@deepseek-ai/dsh/lib/bin.js'),
      '--profile', 'web', '--no-open', '--port', '0'], {
      env: { ...process.env, DSH_HOME: home, DSH_QA_MODULES: modules },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    console.log(`${version} ${phase}: host PID ${server.pid}`);
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
    console.log(`${version} ${phase}: ${origin}`);
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
      const expandReasoning = async () => {
        // The host has a second disclosure inside each completed turn.
        for (const selector of ['button[data-process-activity="thinking"][aria-expanded="false"]', '.dss-dr-row[aria-expanded="false"]']) {
          const closed = page.locator(selector);
          while (await closed.count()) await closed.first().click();
        }
      };
      const checkReasoning = async () => {
        await expandReasoning();
        assert.equal(await page.locator('.dss-nr-body').count(), initialCount);
        for (const body of await page.locator('.dss-nr-body').all()) {
          assert.equal(await body.textContent(), 'SMOOTH_QA_THOUGHT: one local reasoning block.\n');
        }
        assert.doesNotMatch(await page.locator('body').textContent(), /metadata\.(payload|only)|<signature/);
      };
      if (signatures) await checkReasoning();
      if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `acceptance-${version}-${phase}.png`), fullPage: true });
      // Observe actual live chat, including short-lived prefix states and reveal
      // nodes. The settings preview is deliberately excluded from this sample.
      await page.evaluate(checkWholePage => {
        const stats = window.__smoothQA = { leaks: [], fresh: 0, motionErrors: [], scroll: 0 };
        const sample = () => {
          // Older official hosts still expose raw reasoning in their own live
          // process preview. Assert the whole page on rc.5 and plugin-owned
          // output on retained hosts, whose native preview is outside our slot.
          const text = checkWholePage ? document.body.textContent
            : [...document.querySelectorAll('.dss-root')].map(el => el.textContent).join('\n');
          if (/metadata\.(payload|only)|<sign/.test(text)) stats.leaks.push('signature reached DOM');
          for (const el of document.querySelectorAll('.dss-body .dss-fresh')) {
            const style = getComputedStyle(el), after = getComputedStyle(el, '::after');
            stats.fresh++;
            if (style.animationName !== 'none' || after.animationName !== 'none' || style.maskImage !== 'none'
              || style.clipPath !== 'none' || style.animationDelay !== '0s') stats.motionErrors.push('live reveal still animated');
          }
          for (const el of document.querySelectorAll('[data-conversation-scroll].dss-smooth-follow')) {
            stats.scroll++;
            if (getComputedStyle(el).scrollBehavior !== 'auto') stats.motionErrors.push('live follow still smooth');
          }
        };
        window.__smoothQATimer = setInterval(sample, 25);
      }, version === '0.2.1-rc.5');
      const response = page.request.get(`${origin}/qa/followup`);
      if (process.env.DSH_QA_SETTINGS) {
        const scrollport = page.locator('[data-conversation-scroll].dss-smooth-follow');
        await scrollport.waitFor();
        assert.equal(await scrollport.evaluate(el => getComputedStyle(el).scrollBehavior), 'auto', 'Reduced motion disables smooth follow');
      }
      await page.waitForFunction(count => document.querySelectorAll('.dss-body .dss-dr-row').length === count, initialCount + 1);
      assert.equal((await response).status(), 200);
      await page.waitForFunction(count => [...document.querySelectorAll('.dss-body')].filter(el => el.textContent.includes('SMOOTH_QA_DONE')).length === count, initialCount + 1);
      assert.equal(await page.locator('.dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).count(), initialCount + 1);
      assert.equal(await page.locator('[data-chat-group-part="reasoning"] [data-dss-prose]').count(), 0);
      assert.equal(await page.locator('[data-chat-group-part="response"] .dss-dr-row').count(), 0);
      const live = await page.evaluate(() => { clearInterval(window.__smoothQATimer); return window.__smoothQA; });
      assert.ok(live.fresh > 0 && live.scroll > 0, 'Sample actual live reveal and scroll-follow states');
      assert.deepEqual(live.motionErrors, []);
      if (signatures) {
        assert.deepEqual(live.leaks, []);
        assert.doesNotMatch(await page.locator('body').textContent(), /metadata\.(payload|only)|<signature/);
        // Opening the host process exposes every block, including signature-only
        // blocks that must not create an extra Smooth Stream reasoning row.
        for (const button of await page.getByRole('button', { name: /^Completed/ }).all()) {
          if (await button.getAttribute('aria-expanded') === 'false') await button.click();
        }
        assert.equal(await page.locator('.dss-dr-row').count(), initialCount + 1);
        await expandReasoning();
        for (const body of await page.locator('.dss-nr-body').all()) assert.equal(await body.textContent(), 'SMOOTH_QA_THOUGHT: one local reasoning block.\n');
        console.log(`${version} ${phase}: signature prefixes/envelopes hidden, signature-only row omitted, prepared history/live body passed`);
      }
      console.log(`${version} ${phase}: live reduced-motion samples: ${live.fresh} reveal nodes, ${live.scroll} scroll states passed`);
      assert.deepEqual(errors, []);
      console.log(`${version} ${phase}: offline live stream completed without duplicate blocks or browser errors`);
      if (process.env.DSH_QA_SETTINGS && phase === 'fresh') {
        const openSettings = async () => {
          const direct = page.getByRole('button', { name: 'Settings', exact: true });
          if (await direct.count()) await direct.click();
          else {
            await page.getByRole('button', { name: 'Account menu', exact: true }).click();
            await page.getByText('Settings', { exact: true }).click();
          }
          await page.getByText('Smooth Stream', { exact: true }).click();
          await page.locator('.dss-set').waitFor();
        };
        await openSettings();
        assert.equal(await page.locator('.dss-set-opt').count(), 8);
        for (const name of ['Fade', 'Rise', 'Dissolve', 'Wipe', 'Focus', 'Glow', 'Iris', 'Soak']) {
          await page.getByRole('button', { name, exact: true }).click();
          const piece = page.locator('.dss-set-preview .dss-set-piece').first();
          await piece.waitFor();
          assert.equal(await piece.evaluate(el => getComputedStyle(el).animationName), 'none', `${name}: reduced motion`);
          assert.equal(await piece.evaluate(el => getComputedStyle(el, '::after').animationName), 'none', `${name}: reduced motion overlay`);
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          assert.equal(await piece.evaluate(el => getComputedStyle(el).animationName), `dss-${name.toLowerCase()}`, `${name}: normal motion`);
          await page.emulateMedia({ reducedMotion: 'reduce' });
        }
        await page.getByRole('button', { name: 'Rise', exact: true }).click();
        await page.locator('.dss-set-preview .dss-set-piece').first().waitFor();
        assert.equal(await page.locator('.dss-set-preview').getAttribute('data-reveal'), 'rise');
        assert.equal(await page.locator('.dss-set-preview').evaluate(el => getComputedStyle(el).scrollBehavior), 'auto');
        assert.equal(await page.locator('.dss-set-piece').first().evaluate(el => getComputedStyle(el).animationName), 'none');
        if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `settings-${version}.png`), fullPage: true });
        await page.getByRole('checkbox', { name: /Enable Smooth Stream/ }).uncheck();
        await page.waitForFunction(() => !document.querySelector('.dss-body'));
        await page.reload();
        await openSettings();
        assert.equal(await page.getByRole('checkbox', { name: /Enable Smooth Stream/ }).isChecked(), false);
        assert.equal(await page.getByRole('button', { name: 'Rise', exact: true }).getAttribute('data-on'), 'true');
        await page.getByRole('checkbox', { name: /Enable Smooth Stream/ }).check();
        await page.locator('[data-chat-group-part="response"] .dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).first().waitFor({ state: 'attached' });
        assert.deepEqual(errors, []);
        console.log(`${version}: all eight settings choices, preview, reduced motion, disable/reload persistence and re-enable passed`);
      }
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
  console.log(`${version}: browser closed and isolated home removed`);
}
