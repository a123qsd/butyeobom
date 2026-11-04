async (page) => {
  const passed = [];
  const requests = [];
  const errors = [];
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const captureRequest = request => requests.push({ method: request.method(), url: request.url() });
  const captureError = error => errors.push(error.message);
  page.on('request', captureRequest);
  page.on('pageerror', captureError);
  const base = new URL(/^https?:/.test(page.url()) ? page.url() : 'http://127.0.0.1:4174/');
  base.search = '';
  base.hash = '';
  const source = page.locator('#source');
  const result = page.locator('#result');
  const language = page.locator('#language-select');
  const analyze = page.locator('#analyze-button');
  const reset = page.locator('#reset-button');
  const copy = page.locator('#copy-button');
  const undo = page.locator('#undo-button');
  let interactionStart = 0;

  async function navigate(value) {
    const url = new URL(base);
    url.searchParams.set('lang', value);
    await page.goto(url.href, { waitUntil: 'networkidle' });
    interactionStart = requests.length;
  }

  function noInteractionRequests() {
    ensure(requests.length === interactionStart, 'language or text interaction caused a network request: ' + JSON.stringify(requests.slice(interactionStart).map(({ method, url }) => ({ method, path: new URL(url).pathname }))));
  }

  async function switchTo(value) {
    await language.focus();
    await language.selectOption(value);
    await page.waitForFunction(expected => document.documentElement.lang === expected, value);
    ensure(await page.locator('#status').getAttribute('lang') === value, 'live status language was not updated');
    ensure(await language.inputValue() === value, 'language control disagrees with document language');
    ensure(await language.evaluate(element => document.activeElement === element), 'switching language lost keyboard focus');
    const current = new URL(page.url());
    ensure(current.origin === base.origin && current.pathname === base.pathname, 'language switch changed application location');
    ensure(current.searchParams.get('lang') === value, 'language preference missing from URL');
    ensure([...current.searchParams.keys()].every(key => key === 'lang') && current.searchParams.getAll('lang').length === 1, 'URL contains more than the language preference');
    ensure(current.hash === '', 'language switch wrote data into the URL fragment');
  }

  async function auditEnglish() {
    const untranslated = await page.evaluate(() => {
      const hangul = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
      const issues = [];
      function excluded(element) {
        if (!element || element.closest('script, style, noscript, #source, #result, .context-text, #highlighted-result, [hidden]')) return true;
        if (element.closest('option[value="ko"]')) return true;
        for (let node = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return true;
        }
        return false;
      }
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!excluded(node.parentElement) && hangul.test(node.textContent)) {
          issues.push({ element: node.parentElement.id || node.parentElement.tagName, text: node.textContent.trim().slice(0, 100) });
        }
      }
      for (const element of document.querySelectorAll('[placeholder], [aria-label], [title]')) {
        if (element.closest('[hidden]')) continue;
        for (const attribute of ['placeholder', 'aria-label', 'title']) {
          const value = element.getAttribute(attribute) || '';
          if (hangul.test(value)) issues.push({ element: element.id || element.tagName, attribute, text: value.slice(0, 100) });
        }
      }
      if (hangul.test(document.title)) issues.push({ element: 'title', text: document.title });
      const description = document.querySelector('meta[name="description"]')?.content || '';
      if (hangul.test(description)) issues.push({ element: 'meta description', text: description });
      return issues;
    });
    ensure(untranslated.length === 0, 'English UI contains untranslated text: ' + JSON.stringify(untranslated));
  }

  async function installClipboard(mode) {
    await page.evaluate(mode => {
      if (!Object.prototype.hasOwnProperty.call(window, 'i18nQaClipboardDescriptor')) {
        window.i18nQaClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      }
      window.i18nQaCopied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: text => {
            window.i18nQaCopied.push(text);
            if (mode === 'success') return Promise.resolve();
            if (mode === 'failure') return Promise.reject(new DOMException('Synthetic clipboard rejection', 'NotAllowedError'));
            return new Promise((resolve, reject) => {
              window.i18nQaResolveCopy = resolve;
              window.i18nQaRejectCopy = reject;
            });
          },
        },
      });
    }, mode);
  }

  try {
    await page.setViewportSize({ width: 1366, height: 1000 });
    await navigate('en');
    ensure(await page.locator('html').getAttribute('lang') === 'en', 'English query parameter was ignored');
    ensure(await language.inputValue() === 'en', 'English language control value missing');
    ensure(await analyze.isDisabled(), 'empty source must disable analysis');
    ensure(await language.evaluate(element => Boolean(element.labels?.length || element.getAttribute('aria-label'))), 'language control has no accessible label');
    ensure(await page.locator('#status').getAttribute('role') === 'status', 'live status role is missing');
    ensure(await page.locator('#status').getAttribute('aria-live') === 'polite', 'polite live status is missing');
    await page.locator('.about-detail summary').click();
    await auditEnglish();
    await switchTo('ko');
    ensure(/[가-힣]/u.test(await analyze.textContent()), 'Korean control translation missing');
    ensure(await page.locator('.about-detail').evaluate(element => element.open), 'language switch closed the open help section');
    await language.focus();
    // Native type-ahead plus Tab commits the choice in macOS Chrome as well.
    await page.keyboard.press('e');
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    ensure(await page.locator('#sample-button').evaluate(element => document.activeElement === element), 'native language keyboard choice broke the Tab order');
    await auditEnglish();
    passed.push('English query, Korean selection, native keyboard switch, labels, document language and live region');

    const original = 'This fictional paragraph continues across a narrow\ncolumn with enough words to remain ordinary prose.\n\nA careful re-\nview keeps this fictional sample readable.\n\n프로그\n램';
    await source.fill(original);
    await analyze.click();
    ensure(await result.inputValue() === original, 'English analysis changed original before review');
    await auditEnglish();
    await page.locator('#apply-recommended-button').click();
    const recommended = await result.inputValue();
    ensure(recommended.includes('narrow column') && recommended.includes('re-\nview') && recommended.includes('프로그\n램'), 'recommended-only choice changed an ambiguous boundary');
    await page.locator('#ambiguous-filter').click();
    await page.locator('input[value="dehyphenate"]').first().check();
    await page.locator('input[value="join-tight"]').last().check();
    const chosen = await result.inputValue();
    ensure(chosen.includes('A careful review') && chosen.includes('프로그램'), 'explicit English or Korean choice failed');
    await page.locator('#changes-details summary').click();
    await page.locator('#highlighted-result mark').first().waitFor({ state: 'visible' });
    const highlights = await page.locator('#highlighted-result').textContent();
    const checked = await page.locator('#suggestion-list input:checked').evaluateAll(inputs => inputs.map(input => [input.dataset.suggestion, input.value]));
    for (const value of ['ko', 'en', 'ko', 'en']) {
      await switchTo(value);
      ensure(await source.inputValue() === original && await result.inputValue() === chosen, 'language switch changed source or result');
      ensure(await page.locator('#ambiguous-filter').getAttribute('aria-pressed') === 'true' && await page.locator('#recommended-filter').getAttribute('aria-pressed') === 'false', 'language switch changed the selected review filter');
      ensure(await page.locator('#changes-details').evaluate(element => element.open), 'language switch collapsed the expanded changes');
      ensure(await page.locator('#highlighted-result').textContent() === highlights, 'language switch changed the highlighted source text');
      ensure(JSON.stringify(await page.locator('#suggestion-list input:checked').evaluateAll(inputs => inputs.map(input => [input.dataset.suggestion, input.value]))) === JSON.stringify(checked), 'language switch changed review choices or filter');
    }
    ensure(await page.locator('#highlighted-result mark').evaluateAll(marks => marks.length > 0 && marks.every(mark => Boolean(mark.title) && !/[가-힣]/u.test(mark.title) && (!mark.hasAttribute('aria-label') || !/[가-힣]/u.test(mark.getAttribute('aria-label'))))), 'highlight attributes were not translated into English');
    await auditEnglish();
    await analyze.click();
    ensure(await result.inputValue() === chosen, 'reanalysis after language switches reset choices');
    for (let step = 0; step < 3; step += 1) await undo.click();
    ensure(await result.inputValue() === original && await undo.isDisabled(), 'language switches changed undo history');
    passed.push('translated recommendations, ambiguity, hyphens and highlight labels; repeated switches preserve source, choices, filter, expanded changes and undo');

    await switchTo('ko');
    await source.fill('텍스트를 자동으로 정\n리하면 단어가 갈라질 수 있습니다.');
    await analyze.click();
    await page.locator('input[value="join-tight"]').check();
    ensure((await result.inputValue()).includes('정리하면'), 'Korean flow cannot join a split Korean word');
    await undo.click();
    ensure((await result.inputValue()).includes('정\n리하면'), 'Korean flow undo failed');
    ensure(/[가-힣]/u.test(await page.locator('#status').textContent()), 'Korean live message missing');
    await switchTo('en');
    await auditEnglish();
    await reset.click();
    passed.push('complete Korean choice and undo flow followed by English dynamic translation');

    const raw = 'A fictional paragraph continues\r\nwith one carefully preserved line.\r\n\r\nFinal fictional line.\r';
    await source.evaluate((element, text) => {
      element.focus();
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, raw);
    await switchTo('ko');
    await switchTo('en');
    await analyze.click();
    await switchTo('ko');
    await switchTo('en');
    await installClipboard('success');
    await copy.click();
    ensure(await page.evaluate(() => window.i18nQaCopied.at(-1)) === raw, 'language switch normalized raw CRLF or lone CR');
    ensure(/Copied/u.test(await copy.textContent()), 'successful copy status is missing in English');
    await switchTo('ko');
    ensure(/복사했어요/u.test(await copy.textContent()) && !await copy.isDisabled(), 'language switch lost the completed copy state');
    await switchTo('en');
    ensure(/Copied/u.test(await copy.textContent()) && !await copy.isDisabled(), 'completed copy state did not return to English');
    await auditEnglish();
    await source.fill('edited fictional\ntext');
    await analyze.click();
    await switchTo('ko');
    await switchTo('en');
    await copy.click();
    ensure(await page.evaluate(() => window.i18nQaCopied.at(-1)) === 'edited fictional\ntext', 'edited source retained stale raw paste cache');
    passed.push('full-paste raw CRLF/CR survives language switches and automatic copy; editing clears cache');

    await installClipboard('failure');
    await copy.click();
    ensure(await page.locator('#copy-fallback').isVisible(), 'English copy rejection has no fallback');
    ensure(await result.evaluate(element => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length), 'copy fallback did not focus and select the result');
    await auditEnglish();
    await switchTo('ko');
    ensure(await page.locator('#copy-fallback').isVisible() && /[가-힣]/u.test(await page.locator('#copy-instruction').textContent()), 'copy fallback was lost or not translated');
    await switchTo('en');
    await auditEnglish();
    await installClipboard('pending');
    await copy.click();
    ensure(await copy.isDisabled(), 'pending copy does not block duplicate writes');
    ensure(/Copying/u.test(await copy.textContent()), 'pending copy label is missing in English');
    await switchTo('ko');
    ensure(/복사 중/u.test(await copy.textContent()) && await copy.isDisabled(), 'pending copy state was lost in Korean');
    await switchTo('en');
    ensure(await copy.isDisabled() && /Copying/u.test(await copy.textContent()), 'language switch lost pending clipboard state');
    ensure(await page.evaluate(() => window.i18nQaCopied.length) === 1, 'language switch started another clipboard write');
    await page.evaluate(() => window.i18nQaResolveCopy());
    await page.waitForFunction(() => !document.getElementById('copy-button').disabled);
    ensure(/Copied/u.test(await copy.textContent()), 'delayed clipboard success used a stale language or state');
    await auditEnglish();
    await installClipboard('pending');
    await copy.click();
    await switchTo('ko');
    await switchTo('en');
    await page.evaluate(() => window.i18nQaRejectCopy(new DOMException('Synthetic delayed rejection', 'NotAllowedError')));
    await page.locator('#copy-fallback').waitFor({ state: 'visible' });
    await auditEnglish();
    await installClipboard('pending');
    await copy.click();
    await switchTo('ko');
    await switchTo('en');
    await reset.click();
    await page.evaluate(() => window.i18nQaResolveCopy());
    ensure(await source.inputValue() === '' && await result.inputValue() === '' && await copy.isDisabled(), 'stale clipboard completion resurrected reset state');
    ensure(await page.locator('#copy-fallback').isHidden(), 'stale clipboard completion restored fallback');
    await auditEnglish();
    passed.push('translated copy failure, pending-switch success/rejection and pending-switch-reset races');

    await source.fill('a'.repeat(100001));
    ensure((await source.inputValue()).length === 100001 && await analyze.isDisabled(), 'over-limit input was truncated or accepted');
    ensure(await page.locator('#source-error').isVisible() && await source.getAttribute('aria-invalid') === 'true', 'over-limit error is not exposed');
    await auditEnglish();
    await switchTo('ko');
    ensure(/[가-힣]/u.test(await page.locator('#source-error').textContent()), 'Korean over-limit translation missing');
    await switchTo('en');
    ensure((await source.inputValue()).length === 100001, 'switching language truncated over-limit source');
    await auditEnglish();
    const structured = '- Fictional item one\n- Fictional item two\n\nColumn | Value\nExample | Preserved\n\n```js\nconst sample = 1;\n```';
    await source.fill(structured);
    await analyze.click();
    ensure(await result.inputValue() === structured && await page.locator('.suggestion-card').count() === 0, 'protected structures changed');
    ensure(await page.locator('#warnings').isVisible(), 'protected structure warning missing');
    await auditEnglish();
    passed.push('English/Korean over-limit errors, unchanged input, empty review and structure warnings');

    const paragraph = 'This fictional paragraph continues across a narrow\ncolumn with enough words to remain ordinary prose.\n\n';
    await source.fill('This fictional sentence has ended.\nAnother fictional sentence begins here.');
    await analyze.click();
    await page.locator('#recommended-filter').click();
    ensure(await page.locator('#review-empty').isVisible() && await page.locator('.suggestion-card').count() === 0, 'no-recommendation empty state is missing');
    await auditEnglish();
    await switchTo('ko');
    await switchTo('en');
    ensure(await page.locator('#recommended-filter').getAttribute('aria-pressed') === 'true', 'empty review filter changed during language switch');
    await auditEnglish();
    await source.fill(paragraph);
    await analyze.click();
    await page.locator('#ambiguous-filter').click();
    ensure(await page.locator('#review-empty').isVisible() && await page.locator('.suggestion-card').count() === 0, 'no-ambiguity empty state is missing');
    await auditEnglish();
    passed.push('both empty review categories translate without changing the chosen filter');

    await source.fill(paragraph.repeat(45));
    await analyze.click();
    ensure(await page.locator('.suggestion-card').count() === 20, 'long English review did not paginate');
    await page.locator('#next-page').click();
    ensure(await page.locator('#review-title').evaluate(element => document.activeElement === element), 'pagination did not move focus to the review heading');
    const firstLine = await page.locator('.line-label').first().textContent();
    await switchTo('ko');
    await switchTo('en');
    ensure(await page.locator('.line-label').first().textContent() === firstLine, 'language switch reset the current review page');
    await page.locator('#apply-recommended-button').click();
    const allApplied = await result.inputValue();
    const editorViews = await page.locator('#source, #result').evaluateAll(editors => editors.map((element, index) => {
      element.setSelectionRange(12 + index, 48 + index, 'backward');
      element.scrollTop = 80 + index * 20;
      return { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, top: element.scrollTop, left: element.scrollLeft };
    }));
    ensure(editorViews.every(view => view.top > 0), 'editor scroll-preservation fixture did not scroll');
    await switchTo('ko');
    await switchTo('en');
    const afterViews = await page.locator('#source, #result').evaluateAll(editors => editors.map(element => ({ start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection, top: element.scrollTop, left: element.scrollLeft })));
    ensure(JSON.stringify(afterViews) === JSON.stringify(editorViews), 'language switch changed editor selection or scroll');
    ensure(await result.inputValue() === allApplied, 'language switch changed bulk choices');
    await undo.click();
    ensure(await result.inputValue() === paragraph.repeat(45), 'bulk undo failed after switching language');
    await auditEnglish();
    passed.push('English pagination focus, current page, editor selection and scroll survive switches; all-page bulk undo remains one action');

    await reset.click();
    await page.locator('#sample-button').focus();
    await page.keyboard.press('Enter');
    ensure((await source.inputValue()).length > 0, 'English keyboard sample action failed');
    await analyze.click();
    await page.locator('#ambiguous-filter').click();
    await auditEnglish();
    for (const width of [320, 390, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      ensure(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `English UI horizontally overflows at ${width}px`);
      ensure(await language.evaluate(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.left >= 0 && box.right <= innerWidth; }), `language control is clipped at ${width}px`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'output/playwright/i18n-en-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'output/playwright/i18n-en-mobile.png', fullPage: true });
    noInteractionRequests();
    ensure(await page.evaluate(async () => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === '' && (!indexedDB.databases || (await indexedDB.databases()).length === 0) && (!('caches' in window) || (await caches.keys()).length === 0)), 'language preference or text was persisted outside memory/URL');
    passed.push('English sample, translation audit, 320/390/1366px reflow, screenshots, no interaction requests or storage');

    await navigate('unsupported');
    ensure(await page.locator('html').getAttribute('lang') === 'ko', 'unsupported query language did not safely fall back to Korean');
    await switchTo('en');
    await auditEnglish();
    noInteractionRequests();
    await navigate('<script>window.i18nQaInjected=1</script>');
    ensure(await page.locator('html').getAttribute('lang') === 'ko', 'untrusted query language did not safely fall back');
    ensure(await page.evaluate(() => window.i18nQaInjected === undefined), 'query language was interpreted as script');
    await switchTo('en');
    ensure(new URL(page.url()).search === '?lang=en', 'switching language retained untrusted query content');
    noInteractionRequests();
    ensure(requests.every(({ url, method }) => new URL(url).origin === base.origin && method === 'GET'), 'unexpected request origin or method');
    ensure(errors.length === 0, 'browser runtime errors: ' + errors.join('; '));
    passed.push('invalid query fallback, safe URL preference, no injection or runtime errors');
    return { passed, total: passed.length, requestPaths: [...new Set(requests.map(({ url }) => new URL(url).pathname))], interactionRequests: 0, browserErrors: errors };
  } finally {
    await page.evaluate(() => {
      if (Object.prototype.hasOwnProperty.call(window, 'i18nQaClipboardDescriptor')) {
        if (window.i18nQaClipboardDescriptor) Object.defineProperty(navigator, 'clipboard', window.i18nQaClipboardDescriptor);
        else delete navigator.clipboard;
      }
    }).catch(() => {});
    page.off('request', captureRequest);
    page.off('pageerror', captureError);
  }
}
