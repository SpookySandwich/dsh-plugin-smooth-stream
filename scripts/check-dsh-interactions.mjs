import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Exercise real pointer selections and host-owned actions. No injected DOM
// attributes or replacement menu/Quote implementations are used here.
export async function checkInteractions(page, artifacts, label, reasoningText = 'SMOOTH_QA_THOUGHT: one local reasoning block.') {
  for (const button of await page.getByRole('button', { name: /^(Completed|已完成，用时)/ }).all()) {
    if (await button.getAttribute('aria-expanded') === 'false') await button.click();
  }
  for (const selector of ['button[data-process-activity="thinking"][aria-expanded="false"]', '[data-disclosure-row][aria-expanded="false"]:is(:has-text("Think"), :has-text("思考"))']) {
    const closed = page.locator(selector);
    while (await closed.count()) await closed.first().click();
  }
  const results = {};
  if (process.env.DSH_QA_PATH_IMAGES === '1') {
    await page.waitForFunction(() => [...document.querySelectorAll('img[alt="SMOOTH_QA_PATH_IMAGE"]')].some(img => img.complete && img.naturalWidth === 160));
    results.pathImage = true;
  }
  for (const [kind, text] of [['reasoning', reasoningText], ['reply', 'SMOOTH_QA_ANSWER']]) {
    const seat = kind === 'reasoning'
      ? page.locator('.dss-nr-body, [data-slot="conversation.chat.reasoning.body"]')
      : page.locator('[data-chat-group-part="response"]');
    const source = seat.getByText(text, { exact: kind !== 'reasoning' }).last();
    await source.scrollIntoViewIfNeeded();
    // A multiline body can scroll under the sticky header during disclosure
    // expansion. Center the text without smooth scrolling before measuring it.
    await source.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await source.click({ trial: true });
    const box = await source.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rect = [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(190, box.width - 2), box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    const selected = await page.evaluate(() => String(getSelection()).trim());
    if (artifacts) await page.screenshot({ path: join(artifacts, `${label}-${kind}-selection.png`) });
    console.log(`${label} ${kind}: selected ${JSON.stringify(selected)}, bounds ${JSON.stringify(box)}`);
    assert.ok(selected.length > 5 && text.includes(selected), `${kind}: actual pointer selection contains fixture text (${selected})`);
    const quote = page.getByRole('button', { name: /^(Quote text|引用文本)$/ });
    results[kind] = { selected, quote: await quote.waitFor({ timeout: 2500 }).then(() => true, () => false) };
    if (artifacts) await page.screenshot({ path: join(artifacts, `${label}-${kind}-quote.png`) });
    if (results[kind].quote) {
      await quote.click();
      await page.waitForFunction(value => document.querySelector('[data-composer-seat]')?.textContent.includes(value), selected);
      results[kind].composer = true;
    }
    await page.mouse.click(5, 5);
    await page.keyboard.press('Escape');
  }
  const file = page.locator('[data-chat-group-part="response"]').getByRole('button', { name: /smooth-qa\.txt/ }).last();
  await file.scrollIntoViewIfNeeded();
  const observeMenuOnce = async temperature => {
    await file.click({ button: 'right' });
    const menu = page.getByRole('menu');
    const opened = await menu.waitFor({ timeout: 2500 }).then(() => true, () => false);
    // The native provider can time out while querying OS associations. Observe
    // its optional contribution, but require the host-owned file menu itself.
    const pathActions = opened && await menu.getByText(/^(Copy file path|复制文件路径)$/)
      .waitFor({ timeout: 2500 }).then(() => true, () => false);
    const observation = { opened, pathActions,
      text: opened ? await menu.innerText() : '',
      items: opened ? await menu.getByRole('menuitem').count() : 0 };
    if (artifacts) await page.screenshot({ path: join(artifacts, `${label}-file-menu-${temperature}.png`) });
    await page.keyboard.press('Escape');
    return observation;
  };
  // DSH 0.2.3 gives each menu provider about a second; a cold file lookup can miss it.
  const observeMenu = async temperature => {
    const first = await observeMenuOnce(temperature);
    return /Download|下载/.test(first.text) ? first : observeMenuOnce(temperature);
  };
  results.coldMenu = await observeMenu('cold');
  await file.click();
  results.preview = await page.getByText('SMOOTH_QA_FILE_CONTENT', { exact: true }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  if (artifacts) await page.screenshot({ path: join(artifacts, `${label}-file-preview.png`) });
  results.warmMenu = await observeMenu('warm');
  if (artifacts) {
    await writeFile(join(artifacts, `${label}-interactions.json`), JSON.stringify(results, null, 2));
  }
  assert.ok(results.reply.quote && results.reply.composer, 'Settled reply Quote reaches composer');
  assert.ok(results.reasoning.quote && results.reasoning.composer, 'Expanded settled reasoning Quote reaches composer');
  for (const menu of [results.coldMenu, results.warmMenu]) {
    assert.ok(menu.opened && menu.items > 0, 'Inline file right-click opens an actionable host menu');
    assert.match(menu.text, /Download|下载/, 'Host file download action is present');
    if (menu.pathActions) assert.ok(menu.items >= 5, 'Resolved provider supplies opening and path actions');
  }
  assert.ok(results.preview, 'Inline file left-click opens the host preview');
  console.log(`${label}: reply/reasoning Quote, file context menu and left-click preview passed (cold/warm menu items ${results.coldMenu.items}/${results.warmMenu.items})`);
}
