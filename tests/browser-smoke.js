async (page) => {
  const passed = [];
  const requests = [];
  const errors = [];
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }));
  page.on('pageerror', (error) => errors.push(error.message));
  const baselineURL = new URL(/^https?:/.test(page.url()) ? page.url() : 'http://127.0.0.1:4173/');
  baselineURL.searchParams.set('lang', 'ko');
  const appURL = baselineURL.href;
  const appOrigin = new URL(appURL).origin;
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.goto(appURL, { waitUntil: 'networkidle' });
  const initialRequests = requests.length;
  const source = page.locator('#source');
  const result = page.locator('#result');
  const analyze = page.locator('#analyze-button');
  const reset = page.locator('#reset-button');
  const copy = page.locator('#copy-button');

  ensure(await analyze.isDisabled(), 'empty source must disable analysis');
  await page.locator('#sample-button').focus();
  await page.keyboard.press('Enter');
  const sample = await source.inputValue();
  ensure(await source.evaluate((element) => element.scrollTop === 0), 'sample should start at the top');
  await analyze.click();
  ensure(await result.inputValue() === sample, 'analysis must initially preserve source');
  await page.locator('#apply-recommended-button').click();
  const recommended = await result.inputValue();
  ensure(recommended.includes('narrow column'), 'recommended prose join missing');
  ensure(recommended.includes('re-\nview'), 'bulk action must preserve ambiguous hyphen');
  ensure(recommended.includes('그대로 두고,\n'), 'bulk action must preserve Korean ambiguity');
  await analyze.click();
  ensure(await result.inputValue() === recommended, 'repeated analysis must preserve review choices');
  await page.locator('#undo-button').click();
  ensure(await result.inputValue() === sample, 'bulk undo must restore source');
  ensure(await page.locator('#undo-button').isDisabled(), 'bulk undo must be one step');
  passed.push('keyboard sample, initial preservation, recommended-only bulk, repeated analysis, undo');

  await page.locator('#ambiguous-filter').click();
  await page.locator('input[value="dehyphenate"]').first().check();
  ensure((await result.inputValue()).includes('A careful review'), 'explicit hyphen removal failed');
  await page.locator('#changes-details > summary').click();
  await page.locator('#highlighted-result mark').first().waitFor({ state: 'visible' });
  ensure(await page.locator('#highlighted-result').textContent() === await result.inputValue(), 'highlight reconstruction differs');
  ensure(await page.locator('#highlighted-result mark').count() > 0, 'changed text must be marked');
  await page.locator('#undo-button').click();
  ensure(await result.inputValue() === sample, 'individual undo failed');
  passed.push('explicit hyphen choice and visible change reconstruction');

  await source.fill('프로그\n램');
  ensure(await result.inputValue() === '' && await copy.isDisabled(), 'source edit must invalidate stale result');
  await analyze.click();
  await page.locator('input[value="join-tight"]').check();
  ensure(await result.inputValue() === '프로그램', 'Korean tight join failed');
  await page.locator('#undo-button').click();
  ensure(await result.inputValue() === '프로그\n램', 'Korean undo failed');
  await page.locator('input[value="keep"]').focus();
  await page.keyboard.press('ArrowRight');
  ensure(await result.inputValue() === '프로그 램', 'native radio keyboard selection failed');
  passed.push('source invalidation, Korean spacing choices, native radio keyboard');

  await reset.click();
  const raw = 'A fictional paragraph continues\r\nwith one carefully preserved line.\r\n\r\n끝.\r';
  await source.evaluate((element, text) => {
    element.focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, raw);
  await analyze.click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.qaCopied = text; } } });
  });
  await copy.click();
  ensure(await page.evaluate(() => window.qaCopied) === raw, 'full paste CRLF/CR must survive automatic copy');
  await source.fill('edited\ntext');
  await analyze.click();
  await copy.click();
  ensure(await page.evaluate(() => window.qaCopied) === 'edited\ntext', 'raw paste cache must be invalidated on editing');
  passed.push('explicit full-paste CRLF/CR preservation and raw-cache invalidation');

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException('Test clipboard unavailable', 'NotAllowedError'); };
  });
  await copy.click();
  ensure(await page.locator('#copy-fallback').isVisible(), 'clipboard rejection must show manual fallback');
  ensure(await result.evaluate((element) => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length), 'fallback must focus and select result');
  await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise((resolve) => { window.qaResolveCopy = resolve; }); });
  await copy.click();
  ensure(await copy.isDisabled(), 'pending copy must prevent repeat clicks');
  await reset.click();
  await page.evaluate(() => window.qaResolveCopy());
  ensure(await source.inputValue() === '' && await result.inputValue() === '', 'reset must empty both editors');
  ensure(await page.locator('#review-section').isHidden() && await page.locator('#copy-fallback').isHidden(), 'reset must clear review and fallback');
  ensure(await copy.isDisabled() && !(await copy.textContent()).includes('복사했어요'), 'stale clipboard completion must not restore state');
  passed.push('clipboard failure fallback, repeat-click guard, pending-copy reset race');

  const malicious = '<img src=x onerror="window.qaXss=1">\n<script>window.qaXss=1</script>\n& literal text';
  await source.fill(malicious);
  await analyze.click();
  ensure(await result.inputValue() === malicious, 'markup must remain literal text');
  ensure(await page.evaluate(() => window.qaXss === undefined && !document.querySelector('img[src="x"]')), 'input must not inject DOM');
  passed.push('XSS-shaped text remains inert');

  await source.fill('- 목록 하나\n- 목록 둘\n\n항목 | 상태\n본문 | 유지\n\n```js\nconst sample = 1;\n```');
  const structured = await source.inputValue();
  await analyze.click();
  ensure(await result.inputValue() === structured, 'structures must be preserved');
  ensure(await page.locator('.suggestion-card').count() === 0, 'protected structure must not offer joins');
  await source.fill('a'.repeat(100001));
  ensure((await source.inputValue()).length === 100001, 'over-limit text must not be truncated');
  ensure(await analyze.isDisabled() && await page.locator('#source-error').isVisible(), 'over-limit input must explain unavailable analysis');
  await source.fill('a'.repeat(100000));
  await analyze.click();
  ensure((await result.inputValue()).length === 100000, 'limit-size text must remain intact');
  passed.push('list/table/code protection, 100000-unit limit and no silent truncation');

  const paragraph = 'This fictional paragraph continues across a narrow\ncolumn with enough words to remain ordinary prose.\n\n';
  await source.fill(paragraph.repeat(60));
  await analyze.click();
  ensure(await page.locator('.suggestion-card').count() === 20, 'review must paginate long input');
  await page.locator('#next-page').click();
  ensure((await page.locator('#page-description').textContent()).startsWith('2 / 3'), 'second page unavailable');
  ensure(await page.locator('#review-title').evaluate((element) => document.activeElement === element), 'pagination must restore useful keyboard focus');
  await page.locator('#apply-recommended-button').click();
  ensure((await result.inputValue()).includes('narrow column'), 'bulk must cover paginated proposals');
  await page.locator('#undo-button').click();
  ensure(await result.inputValue() === paragraph.repeat(60), 'long bulk undo failed');
  passed.push('60 proposals paginated by 20 with all-page bulk and undo');

  await reset.click();
  await page.locator('#sample-button').click();
  await analyze.click();
  await page.locator('#apply-recommended-button').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'output/playwright/desktop-reviewed.png', fullPage: true });
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 844 });
    ensure(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'output/playwright/mobile-reviewed.png', fullPage: true });
  passed.push('320/390/768/1366px reflow and desktop/mobile screenshots');

  ensure(requests.length === initialRequests, 'input interaction caused a network request');
  ensure(requests.every(({ url, method }) => new URL(url).origin === appOrigin && method === 'GET'), 'unexpected initial network origin/method');
  ensure(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === ''), 'app persisted client state');
  ensure(errors.length === 0, 'browser runtime errors: ' + errors.join('; '));
  passed.push('no interaction network requests, empty client storage, no runtime errors');
  return { passed, total: passed.length, initialRequests: requests.map(({ url }) => new URL(url).pathname), interactionRequests: requests.length - initialRequests, browserErrors: errors };
}
