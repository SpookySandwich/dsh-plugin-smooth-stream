// Use the published host and an isolated headless browser, never a user profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, symlink, writeFile, copyFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { checkInteractions } from './check-dsh-interactions.mjs';

const root = resolve(import.meta.dirname, '..');
const pluginRoot = process.env.DSH_QA_PLUGIN ? resolve(process.env.DSH_QA_PLUGIN) : root;
assert.ok(process.env.DSH_QA_MODULES, 'Set DSH_QA_MODULES to an official DSH node_modules directory');
const modules = resolve(process.env.DSH_QA_MODULES);
const version = JSON.parse(await readFile(join(modules, '@deepseek-ai/dsh/package.json'))).version;
const signatures = process.env.DSH_QA_SIGNATURES === '1';
const translation = process.env.DSH_QA_TRANSLATION === '1';
const nativeChildSlots = version !== '0.2.0-rc.2';
const thought = 'SMOOTH_QA_THOUGHT: a soft-wrapped paragraph\ncontinued on its second line.\n\n'
  + 'A second paragraph.\n\n- First bullet\n- Second bullet\n\n1. First item\n2. Second item\n\nA closing paragraph.\n';
const translatedThought = 'SMOOTH_QA_TRANSLATED：这是翻译后的思考，\n同一段落的第二行。\n\n'
  + '第二段。\n\n- 第一项\n- 第二项\n\n1. 第一步\n2. 第二步\n\n结束段落。\n';
const translatedBlocks = translatedThought.trim().split('\n\n');
const paragraphTranslations = new Map(thought.trim().split('\n\n').map((text, i) => [text, translatedBlocks[i]]));
const translationRequests = [];
const home = await mkdtemp(join(process.env.DSH_QA_TMP || tmpdir(), 'smooth-stream-dsh-qa-'));
const profile = join(home, 'profiles', 'web');
let server, browser, translationServer;
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
  await symlink(pluginRoot, join(profile, 'node_modules', 'dsh-plugin-smooth-stream'), 'junction');
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'smooth-stream-qa', private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-smooth-stream'] } } }));
  await copyFile(join(root, 'test/fixtures/dsh-acceptance.mjs'), join(profile, 'fixture.mjs'));
  let patch = '- insert:\n    - id: offline-qa\n      name: ./fixture.mjs\n';
  if (translation) {
    // Exercise the official translation UI and Remote against a local Bing
    // protocol fixture, without sending reasoning to an external service.
    translationServer = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      translationRequests.push({ body, target: new URL(req.url, 'http://localhost').searchParams.get('to') });
      res.writeHead(200, { 'content-type': 'application/json' });
      // The official UI translates one completed paragraph at a time.
      res.end(JSON.stringify(JSON.parse(body).map(text => ({
        translations: [{ text: paragraphTranslations.get(text.trim()) ?? text }],
      }))));
    });
    translationServer.listen(0, '127.0.0.1');
    await once(translationServer, 'listening');
    patch += `    - id: translator\n      name: '@deepseek-ai/dsh-experimental-translator'\n      config:\n        bingEndpoint: http://127.0.0.1:${translationServer.address().port}/translate\n`;
    patch += "    - id: cot-translation\n      name: '@deepseek-ai/dsh-experimental-client-ui-cot-translation'\n      config:\n        provider: bing\n        targetLanguage: zh\n";
  }
  await writeFile(join(profile, 'cordis.patch.yml'), patch);
  browser = await chromium.launch({ headless: true,
    ...(process.env.DSH_QA_BROWSER ? { executablePath: process.env.DSH_QA_BROWSER } : { channel: 'msedge' }) });
  console.log(`${version}: browser ${browser.version()}, isolated home ${home}`);
  for (const phase of ['fresh', 'restart']) {
    let output = '';
    server = spawn(process.execPath, ['--expose-internals', join(modules, '@deepseek-ai/dsh/lib/bin.js'),
      '--profile', 'web', '--no-open', '--port', '0'], {
      env: { ...process.env, DSH_HOME: home, DSH_QA_MODULES: modules, DSH_QA_THOUGHT: thought },
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
      for (const button of await page.getByRole('button', { name: /^(Completed|已完成，用时)/ }).all()) await button.click();
      // Count the actual host's split seats, including folded process content.
      const initialCount = phase === 'fresh' ? 1 : 2;
      assert.equal(await page.locator('.dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).count(), initialCount);
      assert.equal(await page.locator('.dss-body .dss-dr-row').count(), initialCount);
      assert.equal(await page.locator('[data-chat-group-part="reasoning"] [data-dss-prose]').count(), 0);
      assert.equal(await page.locator('[data-chat-group-part="response"] .dss-dr-row').count(), 0);
      assert.equal(await page.locator('.dss-body pre').count(), initialCount);
      assert.equal(await page.locator('.dss-body table').count(), initialCount);
      if (process.env.DSH_QA_IMAGES === '1') {
        const selector = '.dss-body button[data-variant] img';
        await page.waitForFunction(({ selector, count }) => [...document.querySelectorAll(selector)].filter(img => img.complete && img.naturalWidth === 160).length === count, { selector, count: initialCount });
        assert.equal(await page.locator('[data-chat-group-part="reasoning"] .dss-body img').count(), 0);
        assert.equal(await page.locator('.dss-image').count(), 0);
        await page.locator(selector).first().click();
        await page.getByRole('dialog').waitFor();
        await page.getByRole('dialog').press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        console.log(`${version} ${phase}: durable image loaded once in response seat, native gallery and lightbox passed`);
      }
      if (process.env.DSH_QA_FILES === '1') {
        const file = page.locator('.dss-body').getByRole('button', { name: /smooth-qa\.txt/ }).first();
        await file.waitFor();
        assert.match(await file.getAttribute('title'), /smooth-qa\.txt$/);
        console.log(`${version} ${phase}: official closing-turn file mention rendered as an actionable link`);
      }
      console.log(`${version} ${phase}: official grouped history, Markdown code/table, single reasoning and answer passed`);
      const expandReasoning = async () => {
        // Expand both host process levels, including after a settings reload.
        for (const selector of ['button[data-turn-process][aria-expanded="false"]', 'button[data-process-activity="thinking"][aria-expanded="false"]', '.dss-dr-row[aria-expanded="false"]']) {
          const closed = page.locator(selector + ':visible');
          while (await closed.count()) await closed.first().click();
        }
      };
      const checkMarkdown = async (body, text) => {
        await body.locator('p').first().waitFor();
        const markdown = await body.evaluate(el => ({
          paragraphs: [...el.querySelectorAll('p')].map(p => {
            const style = getComputedStyle(p);
            return { text: p.textContent, whiteSpace: style.whiteSpace, wordBreak: style.wordBreak,
              fontSize: style.fontSize, lineHeight: style.lineHeight };
          }),
          bullets: el.querySelectorAll('ul > li').length,
          items: el.querySelectorAll('ol > li').length,
        }));
        const blocks = text.trim().split('\n\n');
        assert.deepEqual(markdown.paragraphs.map(p => p.text), [blocks[0], blocks[1], blocks.at(-1)]);
        assert.equal(markdown.bullets, 2);
        assert.equal(markdown.items, 2);
        for (const p of markdown.paragraphs) assert.equal(p.whiteSpace, 'normal', 'Delegated Markdown must collapse soft line breaks');
        return markdown;
      };
      const checkBody = async body => {
        if (translation) {
          const translated = body.locator('[data-cot-translation="true"][data-translation-state="ready"]');
          await translated.getByRole('button', { name: 'View original', exact: true }).waitFor();
          const translatedMarkdown = await checkMarkdown(translated, translatedThought);
          await translated.getByRole('button', { name: 'View original', exact: true }).click();
          const originalMarkdown = await checkMarkdown(translated, thought);
          await translated.getByRole('button', { name: 'View translation', exact: true }).click();
          assert.deepEqual(await checkMarkdown(translated, translatedThought), translatedMarkdown);
          return { translated: translatedMarkdown, original: originalMarkdown };
        }
        if (nativeChildSlots) return checkMarkdown(body, thought);
        assert.equal(await body.textContent(), thought, 'Legacy fallback keeps its literal newlines');
        for (const line of await body.locator('.dss-line').all()) {
          assert.deepEqual(await line.evaluate(el => {
            const style = getComputedStyle(el);
            return [style.whiteSpace, style.wordBreak, style.fontSize, style.lineHeight];
          }), ['pre-wrap', 'break-word', '14px', '24px']);
        }
      };
      const checkReasoning = async () => {
        await expandReasoning();
        assert.equal(await page.locator('.dss-nr-body').count(), initialCount);
        for (const body of await page.locator('.dss-nr-body').all()) await checkBody(body);
        assert.doesNotMatch(await page.locator('body').textContent(), /metadata\.(payload|only)|<signature/);
      };
      await checkReasoning();
      if (process.env.DSH_QA_INTERACTIONS === '1') {
        await checkInteractions(page, process.env.DSH_QA_ARTIFACTS, `${version}-${phase}`,
          (translation ? translatedThought : thought).split('\n\n')[0]);
        await page.getByRole('button', { name: /^(Close|关闭)$/ }).click();
        await page.reload();
        await page.locator('.dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).first().waitFor();
        for (const button of await page.getByRole('button', { name: /^(Completed|已完成，用时)/ }).all()) {
          if (await button.getAttribute('aria-expanded') === 'false') await button.click();
        }
        if (signatures) await checkReasoning();
      }
      if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `acceptance-${version}-${phase}.png`), fullPage: true });
      if (process.env.DSH_QA_LAYOUT === '1' && phase === 'fresh') {
        for (const viewport of [{ width: 1400, height: 1000 }, { width: 800, height: 900 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          const answer = page.locator('[data-chat-group-part="response"] .dss-root').last();
          await answer.waitFor({ state: 'visible' });
          await answer.scrollIntoViewIfNeeded();
          const layout = await answer.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: innerWidth, contentWidth: rect.width, overflow: el.scrollWidth - el.clientWidth };
          });
          assert.ok(layout.contentWidth > 0 && layout.left >= -1 && layout.right <= layout.width + 1 && layout.overflow <= 1, JSON.stringify(layout));
          if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `chat-${version}-${viewport.width}.png`), fullPage: true });
        }
        await page.setViewportSize({ width: 1400, height: 1000 });
      }
      // Observe actual live chat, including short-lived prefix states and reveal
      // nodes. The settings preview is deliberately excluded from this sample.
      await page.evaluate(checkWholePage => {
        const stats = window.__smoothQA = { leaks: [], fresh: 0, motionErrors: [], emptySummaries: 0, summaryErrors: [] };
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
          for (const row of document.querySelectorAll('.dss-nr-root[data-state="running"] .dss-dr-row[aria-expanded="false"]')) {
            const summary = row.querySelector('.dss-nr-summary');
            if (!summary?.textContent) {
              stats.emptySummaries++;
              if (summary || row.querySelector('.dss-nr-separator')) stats.summaryErrors.push('empty summary or dangling separator');
            }
          }
          if (document.querySelector('[data-dss-gliding]')) stats.motionErrors.push('live follow still glides');
        };
        window.__smoothQATimer = setInterval(sample, 25);
      }, !['0.2.0-rc.2', '0.2.1-rc.2'].includes(version));
      const response = page.request.get(`${origin}/qa/followup`);
      await page.waitForFunction(count => document.querySelectorAll('.dss-body .dss-dr-row').length === count, initialCount + 1);
      assert.equal((await response).status(), 200);
      await page.waitForFunction(count => [...document.querySelectorAll('.dss-body')].filter(el => el.textContent.includes('SMOOTH_QA_DONE')).length === count, initialCount + 1);
      assert.equal(await page.locator('.dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).count(), initialCount + 1);
      assert.equal(await page.locator('[data-chat-group-part="reasoning"] [data-dss-prose]').count(), 0);
      assert.equal(await page.locator('[data-chat-group-part="response"] .dss-dr-row').count(), 0);
      const live = await page.evaluate(() => { clearInterval(window.__smoothQATimer); return window.__smoothQA; });
      assert.ok(live.fresh > 0, 'Sample actual live reveal states');
      assert.deepEqual(live.motionErrors, []);
      assert.deepEqual(live.summaryErrors, []);
      if (nativeChildSlots) assert.ok(live.emptySummaries > 0, 'Observe the early reasoning row before its first newline');
      if (signatures) {
        assert.deepEqual(live.leaks, []);
        assert.doesNotMatch(await page.locator('body').textContent(), /metadata\.(payload|only)|<signature/);
        // Opening the host process exposes every block, including signature-only
        // blocks that must not create an extra Smooth Stream reasoning row.
        for (const button of await page.getByRole('button', { name: /^(Completed|已完成，用时)/ }).all()) {
          if (await button.getAttribute('aria-expanded') === 'false') await button.click();
        }
        assert.equal(await page.locator('.dss-dr-row').count(), initialCount + 1);
        await expandReasoning();
        for (const body of await page.locator('.dss-nr-body').all()) await checkBody(body);
        console.log(`${version} ${phase}: signature prefixes/envelopes hidden, signature-only row omitted, prepared history/live body passed`);
      }
      console.log(`${version} ${phase}: live reduced-motion samples: ${live.fresh} reveal nodes without animation or glide passed`);
      assert.deepEqual(errors, []);
      console.log(`${version} ${phase}: offline live stream completed without duplicate blocks or browser errors`);
      if (process.env.DSH_QA_FOLLOW === '1' && phase === 'fresh') {
        await page.getByText('Smooth Stream follow', { exact: true }).first().click();
        await page.getByText('SMOOTH_QA_FOLLOW_READY', { exact: true }).waitFor();
        const scroller = page.locator('[data-conversation-scroll]');
        const longStream = async (motion, scrollUp = false) => {
          await page.emulateMedia({ reducedMotion: motion });
          const before = await scroller.evaluate(el => ({ gap: el.scrollHeight - el.clientHeight - el.scrollTop, overflows: el.scrollHeight > el.clientHeight }));
          await page.evaluate(() => {
            const el = document.querySelector('[data-conversation-scroll]');
            const stats = window.__follow = { maxGap: 0, glides: 0 };
            const tick = () => {
              stats.maxGap = Math.max(stats.maxGap, el.scrollHeight - el.clientHeight - el.scrollTop);
              if (el.querySelector('[data-dss-gliding]')) stats.glides++;
              stats.frame = requestAnimationFrame(tick);
            };
            stats.frame = requestAnimationFrame(tick);
          });
          const done = page.getByText('SMOOTH_QA_LONG_DONE', { exact: true });
          const finished = await done.count();
          const response = page.request.get(`${origin}/qa/long`);
          let readerTop;
          if (scrollUp) {
            await page.getByText(/^SMOOTH_QA_LONG_10:/).last().waitFor();
            const box = await scroller.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.wheel(0, -600);
            await page.waitForTimeout(500);
            readerTop = await scroller.evaluate(el => el.scrollTop);
          }
          assert.equal((await response).status(), 200);
          await page.waitForFunction(count => [...document.querySelectorAll('.dss-body')].filter(el => el.textContent.includes('SMOOTH_QA_LONG_DONE')).length > count, finished);
          await page.waitForFunction(() => !document.querySelector('[data-dss-gliding]'));
          await page.waitForTimeout(500);
          const after = await page.evaluate(() => {
            const el = document.querySelector('[data-conversation-scroll]');
            cancelAnimationFrame(window.__follow.frame);
            return { ...window.__follow, gap: el.scrollHeight - el.clientHeight - el.scrollTop, top: el.scrollTop, height: el.clientHeight,
              heights: [...document.querySelectorAll('.dss-root')].filter(root => root.style.height).length };
          });
          assert.equal(after.heights, 0, 'Glides release their inline heights');
          return { before, after, readerTop };
        };
        const fits = await longStream('no-preference');
        assert.equal(fits.before.overflows, false, 'The first long stream starts with content that fits');
        const bottom = await longStream('no-preference');
        assert.ok(bottom.before.overflows && bottom.before.gap <= 2, `The second long stream starts at the bottom: ${JSON.stringify(bottom.before)}`);
        if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `follow-${version}.png`) });
        for (const [label, run] of [['fits', fits], ['bottom', bottom]]) {
          assert.ok(run.after.glides > 0, `${label}: smooth follow glides with motion allowed`);
          assert.ok(run.after.gap <= 2 && run.after.maxGap < run.after.height / 2, `${label}: the reply stays at the bottom: ${JSON.stringify(run.after)}`);
        }
        const released = await longStream('no-preference', true);
        assert.ok(Math.abs(released.after.top - released.readerTop) <= 2 && released.after.gap > released.after.height / 2,
          `Scrolling up releases follow: ${JSON.stringify({ readerTop: released.readerTop, ...released.after })}`);
        await scroller.evaluate(el => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
        await page.waitForTimeout(500);
        const reduced = await longStream('reduce');
        assert.ok(reduced.before.gap <= 2 && reduced.after.glides === 0 && reduced.after.gap <= 2,
          `Reduced motion follows without gliding: ${JSON.stringify(reduced)}`);
        assert.deepEqual(errors, []);
        console.log(`${version}: long-stream follow stays at the bottom with motion allowed (from fitting content and from the bottom) and with reduced motion; scrolling up releases it`);
        await page.getByText('Smooth Stream acceptance', { exact: true }).first().click();
        await page.locator('[data-chat-group-part="response"] .dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).first().waitFor();
        for (const button of await page.getByRole('button', { name: /^(Completed|已完成，用时)/ }).all()) {
          if (await button.getAttribute('aria-expanded') === 'false') await button.click();
        }
        await expandReasoning();
      }
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
        const delegatedBody = nativeChildSlots ? await checkBody(page.locator('.dss-nr-body').first()) : undefined;
        await openSettings();
        assert.equal(await page.locator('.dss-set-opt').count(), 8);
        for (const name of ['Fade', 'Rise', 'Dissolve', 'Wipe', 'Focus', 'Glow', 'Iris', 'Soak']) {
          await page.getByRole('button', { name, exact: true }).click();
          const piece = page.locator('.dss-set-preview .dss-set-piece').first();
          await piece.waitFor();
          // Preview batches remount on their timer. Sample a connected current
          // node atomically, rather than querying styles on a detached old node.
          await page.waitForFunction(() => {
            const el = document.querySelector('.dss-set-preview .dss-set-piece');
            return el?.isConnected && getComputedStyle(el).animationName === 'none'
              && getComputedStyle(el, '::after').animationName === 'none';
          });
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await page.waitForFunction(expected => {
            const el = document.querySelector('.dss-set-preview .dss-set-piece');
            return el?.isConnected && getComputedStyle(el).animationName === expected;
          }, `dss-${name.toLowerCase()}`);
          if (name === 'Rise') await page.waitForFunction(() => document.querySelector('.dss-set-preview [data-dss-gliding]'));
          await page.emulateMedia({ reducedMotion: 'reduce' });
        }
        await page.getByRole('button', { name: 'Rise', exact: true }).click();
        await page.locator('.dss-set-preview .dss-set-piece').first().waitFor();
        assert.equal(await page.locator('.dss-set-preview').getAttribute('data-reveal'), 'rise');
        assert.equal(await page.evaluate(() => new Promise(resolve => {
          let glided = false;
          const timer = setInterval(() => { glided ||= document.querySelector('.dss-set-preview [data-dss-gliding]') !== null; }, 25);
          setTimeout(() => { clearInterval(timer); resolve(glided); }, 1000);
        })), false, 'Reduced motion keeps the preview from gliding');
        assert.equal(await page.locator('.dss-set-piece').first().evaluate(el => getComputedStyle(el).animationName), 'none');
        if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `settings-${version}.png`), fullPage: true });
        await page.getByRole('checkbox', { name: /Enable Smooth Stream/ }).uncheck();
        await page.waitForFunction(() => !document.querySelector('.dss-body'));
        if (nativeChildSlots) {
          await page.getByRole('button', { name: 'Close', exact: true }).click();
          const nativeReasoning = page.locator('[data-variant="think"]').first();
          const collapsed = nativeReasoning.locator('[data-disclosure-row][aria-expanded="false"]');
          if (await collapsed.count()) await collapsed.click();
          assert.deepEqual(await checkBody(nativeReasoning.locator('[data-text-interaction-source]')), delegatedBody,
            'Delegated and native reasoning must have the same Markdown styles');
          console.log(`${version}: multiline reasoning matches the native paragraph styles and list structure`);
          await openSettings();
        }
        await page.reload();
        await openSettings();
        assert.equal(await page.getByRole('checkbox', { name: /Enable Smooth Stream/ }).isChecked(), false);
        assert.equal(await page.getByRole('button', { name: 'Rise', exact: true }).getAttribute('data-on'), 'true');
        await page.getByRole('checkbox', { name: /Enable Smooth Stream/ }).check();
        await page.locator('[data-chat-group-part="response"] .dss-body').getByText('SMOOTH_QA_ANSWER', { exact: true }).first().waitFor({ state: 'attached' });
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await expandReasoning();
        assert.equal(await page.locator('.dss-nr-body').count(), initialCount + 1);
        for (const body of await page.locator('.dss-nr-body').all()) await checkBody(body);
        await openSettings();
        assert.deepEqual(errors, []);
        console.log(`${version}: all eight settings choices, preview, reduced motion, disable/reload persistence and re-enable passed`);
        if (process.env.DSH_QA_LAYOUT === '1') {
          const layouts = async locale => {
            for (const viewport of [{ width: 1400, height: 1000 }, { width: 800, height: 900 }, { width: 390, height: 844 }]) {
              await page.setViewportSize(viewport);
              await page.locator('.dss-set').waitFor();
              const layout = await page.locator('.dss-set').evaluate(el => {
                const rect = el.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: innerWidth, overflow: el.scrollWidth - el.clientWidth };
              });
              // Native range inputs can add their 2px border to a 100% width.
              assert.ok(layout.left >= -1 && layout.right <= layout.width + 1 && layout.overflow <= 4, JSON.stringify(layout));
              if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `settings-${version}-${locale}-${viewport.width}.png`), fullPage: true });
            }
            await page.setViewportSize({ width: 1400, height: 1000 });
          };
          await layouts('en');
          await page.getByText('General', { exact: true }).click();
          await page.getByRole('button', { name: 'English', exact: true }).click();
          await page.getByRole('menuitem', { name: /中文/ }).click();
          await page.getByText('Smooth Stream', { exact: true }).click();
          await page.getByRole('checkbox', { name: /启用 Smooth Stream/ }).waitFor();
          assert.equal(await page.getByRole('button', { name: '上升', exact: true }).getAttribute('data-on'), 'true');
          await layouts('zh');
          console.log(`${version}: English/Chinese settings fit 1400, 800 and 390px viewports`);
        }
      }
      if (process.env.DSH_QA_EDGE_CASES === '1' && phase === 'restart') {
        for (const kind of ['interrupted', 'error']) {
          const response = page.request.get(`${origin}/qa/${kind}`);
          await page.locator('.dss-body').getByText(`SMOOTH_QA_${kind}_PARTIAL`, { exact: true }).waitFor();
          assert.equal(await page.locator('.dss-body').getByText(`SMOOTH_QA_${kind}_PARTIAL`, { exact: true }).count(), 1);
          assert.equal(await page.locator('[data-chat-group-part="reasoning"] .dss-body').getByText(`SMOOTH_QA_${kind}_PARTIAL`, { exact: true }).count(), 0);
          assert.equal(await page.locator('[data-chat-group-part="response"] .dss-dr-row').count(), 0);
          assert.equal((await response).status(), 200);
        }
        assert.ok(await page.locator('.dss-stopped').count() >= 1);
        await page.getByText(/SMOOTH_QA_EXPECTED_FAILURE/).first().waitFor();
        await page.reload();
        await page.locator('.dss-body').getByText('SMOOTH_QA_interrupted_PARTIAL', { exact: true }).waitFor();
        // The host retains cancelled partial messages, but discards an
        // uncommitted failed attempt and renders its own failure card.
        await page.getByText(/SMOOTH_QA_EXPECTED_FAILURE/).first().waitFor();
        assert.equal(await page.locator('.dss-body').getByText('SMOOTH_QA_error_PARTIAL', { exact: true }).count(), 0);
        if (process.env.DSH_QA_ARTIFACTS) await page.screenshot({ path: join(process.env.DSH_QA_ARTIFACTS, `edge-cases-${version}.png`), fullPage: true });
        assert.deepEqual(errors, []);
        console.log(`${version}: live interruption/error seat filtering passed; reload retains cancelled output and the host failure card`);
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
  if (translation) {
    assert.ok(translationRequests.length > 0, 'The official translation provider must reach the loopback endpoint');
    const translatedSources = new Set();
    for (const request of translationRequests) {
      const texts = JSON.parse(request.body);
      assert.equal(texts.length, 1);
      assert.ok(paragraphTranslations.has(texts[0].trim()), 'Translate display paragraphs without signature envelopes');
      translatedSources.add(texts[0].trim());
      assert.equal(request.target, 'zh-Hans');
    }
    assert.deepEqual([...translatedSources].sort(), [...paragraphTranslations.keys()].sort());
    console.log(`${version}: official translation controls, original/translation switching and signature-free Bing requests passed`);
  }
} finally {
  await browser?.close();
  await stop();
  if (translationServer) await new Promise(resolve => translationServer.close(resolve));
  await rm(home, { recursive: true, force: true });
  console.log(`${version}: browser closed and isolated home removed`);
}
