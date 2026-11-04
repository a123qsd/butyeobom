import { analyzeText, applyChoices } from './transform.js';
import { initialLanguage, translate } from './i18n.js';
import { suggestionReason, optionLabel, warningMessage } from './transform-text.js';

const MAX_SOURCE_LENGTH = 100_000;
const PAGE_SIZE = 20;
const $ = (id) => document.getElementById(id);
const elements = Object.fromEntries([
  'source', 'result', 'source-count', 'source-error', 'result-count', 'result-hint',
  'result-badge', 'analyze-button', 'sample-button', 'reset-button', 'copy-button',
  'copy-fallback', 'copy-instruction', 'select-result-button', 'changes-details',
  'change-count', 'highlighted-result', 'review-section', 'review-title',
  'review-description', 'warnings', 'warning-list', 'undo-button',
  'apply-recommended-button', 'recommended-filter', 'ambiguous-filter',
  'recommended-count', 'ambiguous-count', 'applied-count', 'filter-description',
  'suggestion-list', 'review-empty', 'empty-title', 'empty-description',
  'pagination', 'previous-page', 'next-page', 'page-description', 'status',
  'language-select', 'copy-label', 'analyze-label',
].map((id) => [id, $(id)]));

const SAMPLE = `문장은 그대로 두고,
끊긴 줄만 이어 봅니다.

이 도구는 짧은 메모나 보고서에서
복사한 문장을 정리할 때 쓸 수 있어요.

This paragraph was copied from a narrow
column and needs a little breathing room.

A careful re-
view can keep meaning intact.
A well-
known phrase needs a different choice.

확인할 항목
- 문단 사이의 빈 줄
- 목록과 표의 모양

항목 | 상태
원문 | 유지
결과 | 직접 확인`;

let analysis = null;
let choices = Object.create(null);
let history = [];
let activeFilter = 'recommended';
let page = 0;
let clipboardVersion = 0;
let output = null;
let language = initialLanguage(location.search);
let copyPhase = 'idle';
let fallbackVisible = false;
let analysisFailed = false;
// Textareas normalize CRLF/CR. Preserve the raw text from an explicit full paste
// until the user edits it; the display remains the browser's normalized view.
let rawPastedSource = null;

function currentSource() {
  return rawPastedSource ?? elements.source.value;
}

function announce(message) {
  elements.status.textContent = message;
}

function number(value) {
  return value.toLocaleString(language === 'en' ? 'en-US' : 'ko-KR');
}

function t(key, values) {
  return translate(language, key, values);
}

function copyInstruction() {
  const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  return t('copyFallback', { shortcut: isApple ? '⌘ Command+C' : 'Ctrl+C' });
}

function renderCopyState() {
  elements['copy-button'].disabled = !output?.text || copyPhase === 'pending';
  elements['copy-label'].textContent = t(copyPhase === 'pending' ? 'copying' : copyPhase === 'copied' ? 'copied' : 'copy');
  elements['copy-fallback'].hidden = !fallbackVisible;
  elements['copy-instruction'].textContent = fallbackVisible ? copyInstruction() : '';
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function invalidateOutput() {
  clipboardVersion += 1;
  analysis = null;
  output = null;
  copyPhase = 'idle';
  fallbackVisible = false;
  analysisFailed = false;
  choices = Object.create(null);
  history = [];
  page = 0;
  elements.result.value = '';
  elements['result-count'].textContent = t('characterCount', { count: number(0) });
  elements['result-hint'].textContent = t('resultEmptyHint');
  elements['result-badge'].hidden = true;
  elements['review-section'].hidden = true;
  elements['changes-details'].hidden = true;
  elements['changes-details'].open = false;
  elements['highlighted-result'].replaceChildren();
  elements['suggestion-list'].replaceChildren();
  elements['warning-list'].replaceChildren();
  renderCopyState();
  elements['undo-button'].disabled = true;
  elements['analyze-label'].textContent = t('analyze');
}

function updateSourceState() {
  const source = currentSource();
  const lineCount = source.length ? source.split(/\r\n|\r|\n/).length : 0;
  const overLimit = source.length > MAX_SOURCE_LENGTH;
  elements['source-count'].textContent = t('sourceCount', { characters: number(source.length), lines: number(lineCount) });
  elements['source-error'].hidden = !overLimit && !analysisFailed;
  elements['source-error'].textContent = overLimit
    ? t('limitError', { count: number(source.length), limit: number(MAX_SOURCE_LENGTH) })
    : analysisFailed ? t('analysisError') : '';
  if (overLimit) elements.source.setAttribute('aria-invalid', 'true');
  else elements.source.removeAttribute('aria-invalid');
  elements['analyze-button'].disabled = !source.trim() || overLimit;
  elements['reset-button'].disabled = !source.length && !analysis;
  elements['sample-button'].disabled = Boolean(source.length);
  elements['sample-button'].title = source.length ? t('sampleDisabled') : '';
  elements['analyze-label'].textContent = t(analysis ? 'revisit' : 'analyze');
}

function groupSuggestions(filter = activeFilter) {
  if (!analysis) return [];
  return analysis.suggestions.filter((suggestion) => filter === 'recommended' ? suggestion.recommended : !suggestion.recommended);
}

function pendingRecommended() {
  if (!analysis) return [];
  return analysis.suggestions.filter((suggestion) => suggestion.recommended &&
    suggestion.options.some((option) => option.value === 'join') && choices[suggestion.id] !== 'join');
}

function updateReviewState() {
  if (!analysis || !output) return;
  const pending = pendingRecommended().length;
  elements['undo-button'].disabled = !history.length;
  elements['apply-recommended-button'].disabled = !pending;
  elements['apply-recommended-button'].textContent = pending ? t('applyCount', { count: number(pending) }) : t('allRecommendedApplied');
  if (!groupSuggestions('recommended').length) elements['apply-recommended-button'].textContent = t('noRecommended');
  elements['applied-count'].textContent = output.appliedCount ? t('applied', { count: number(output.appliedCount) }) : t('noApplied');
  for (const card of elements['suggestion-list'].querySelectorAll('.suggestion-card')) {
    const selected = choices[card.dataset.suggestion] || 'keep';
    const suggestion = analysis.suggestions.find((item) => item.id === card.dataset.suggestion);
    const option = suggestion?.options.find((item) => item.value === selected);
    card.classList.toggle('is-applied', selected !== 'keep');
    card.querySelector('.suggestion-state').textContent = selected === 'keep' ? t('keepState') : t('optionApplied', { option: optionLabel(suggestion, option, language) });
    for (const input of card.querySelectorAll('input[type="radio"]')) input.checked = input.value === selected;
  }
}

function renderOutput() {
  if (!analysis) return;
  clipboardVersion += 1;
  output = applyChoices(analysis, choices);
  elements.result.value = output.text;
  copyPhase = 'idle';
  fallbackVisible = false;
  renderOutputPresentation();
}

// Presentation only: language changes never recompute output or assign textarea values.
function renderOutputPresentation() {
  const appliedCount = output?.appliedCount || 0;
  elements['result-count'].textContent = t('characterCount', { count: number(output?.text.length || 0) });
  elements['result-hint'].textContent = !output ? t('resultEmptyHint') : appliedCount ? t('resultChangedHint', { count: number(appliedCount) }) : t('resultUnchangedHint');
  elements['result-badge'].hidden = !output;
  elements['result-badge'].textContent = appliedCount ? t('changedBadge', { count: number(appliedCount) }) : t('originalBadge');
  renderCopyState();
  elements['changes-details'].hidden = !appliedCount;
  elements['change-count'].textContent = t('changeCount', { count: number(appliedCount) });
  if (elements['changes-details'].open) renderHighlights();
  else elements['highlighted-result'].replaceChildren();
  renderReviewDescription();
  updateReviewState();
}

function renderReviewDescription() {
  if (!analysis) return;
  const recommended = groupSuggestions('recommended').length;
  const ambiguous = groupSuggestions('ambiguous').length;
  const protectedCount = analysis.stats.protectedLineCount;
  elements['recommended-count'].textContent = number(recommended);
  elements['ambiguous-count'].textContent = number(ambiguous);
  elements['review-description'].textContent = t('reviewCounts', { recommended: number(recommended), ambiguous: number(ambiguous) })
    + (protectedCount ? t('protectedLines', { count: number(protectedCount) }) : '')
    + t(output?.appliedCount ? 'reviewChanged' : 'reviewUnchanged');
}

function renderWarnings() {
  if (!analysis) return;
  const warnings = document.createDocumentFragment();
  for (const warning of analysis.warnings) warnings.append(makeElement('li', '', warningMessage(warning, language)));
  elements['warning-list'].replaceChildren(warnings);
  elements.warnings.hidden = !analysis.warnings.length;
}

function renderHighlights() {
  if (!output) return;
  const fragment = document.createDocumentFragment();
  for (const segment of output.segments) {
    if (!segment.changed) {
      fragment.append(document.createTextNode(segment.text));
      continue;
    }
    const mark = makeElement('mark', segment.text ? '' : 'empty-change', segment.text);
    mark.title = t(segment.text ? 'changedContext' : 'removedPosition');
    if (!segment.text) mark.setAttribute('aria-label', t('removedPosition'));
    fragment.append(mark);
  }
  elements['highlighted-result'].replaceChildren(fragment);
}

function renderSuggestions() {
  if (!analysis) return;
  const suggestions = groupSuggestions();
  const pageCount = Math.ceil(suggestions.length / PAGE_SIZE);
  page = Math.max(0, Math.min(page, pageCount - 1));
  elements['recommended-filter'].setAttribute('aria-pressed', String(activeFilter === 'recommended'));
  elements['ambiguous-filter'].setAttribute('aria-pressed', String(activeFilter === 'ambiguous'));
  elements['filter-description'].textContent = t(activeFilter === 'recommended' ? 'recommendedDescription' : 'ambiguousDescription');
  const fragment = document.createDocumentFragment();
  const current = suggestions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const originalLines = analysis.source.split(/\r\n|\r|\n/);
  for (const [index, suggestion] of current.entries()) {
    const item = makeElement('li');
    const card = makeElement('article', 'suggestion-card');
    card.dataset.suggestion = suggestion.id;
    const header = makeElement('div', 'suggestion-header');
    header.append(makeElement('span', 'line-label', t('lineRange', { first: number(suggestion.line), last: number(suggestion.line + 1) })), makeElement('span', 'suggestion-state', t('keepState')));
    const context = makeElement('div', 'context-lines');
    const boundaryLines = [originalLines[suggestion.line - 1] || '', originalLines[suggestion.line] || ''];
    for (const [offset, text] of boundaryLines.entries()) {
      const line = makeElement('div', 'context-line');
      const lineNumber = makeElement('span', 'context-line-number', String(suggestion.line + offset));
      lineNumber.setAttribute('aria-hidden', 'true');
      const characters = Array.from(text);
      const excerpt = characters.length <= 80 ? text : offset === 0
        ? `…${characters.slice(-80).join('')}`
        : `${characters.slice(0, 80).join('')}…`;
      line.append(lineNumber, makeElement('span', 'context-text', excerpt));
      context.append(line);
    }
    const bottom = makeElement('div', 'suggestion-bottom');
    const reasonId = `reason-${activeFilter}-${page}-${index}`;
    const reason = makeElement('p', 'suggestion-reason', suggestionReason(suggestion, language));
    reason.id = reasonId;
    const fieldset = makeElement('fieldset', 'choice-options');
    fieldset.setAttribute('aria-describedby', reasonId);
    fieldset.append(makeElement('legend', 'sr-only', t('boundaryLegend', { first: number(suggestion.line), last: number(suggestion.line + 1) })));
    for (const option of suggestion.options) {
      const label = makeElement('label', 'choice-label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `choice-${activeFilter}-${page}-${index}`;
      input.value = option.value;
      input.dataset.suggestion = suggestion.id;
      input.checked = (choices[suggestion.id] || 'keep') === option.value;
      label.append(input, makeElement('span', '', optionLabel(suggestion, option, language)));
      fieldset.append(label);
    }
    bottom.append(reason, fieldset);
    card.append(header, context, bottom);
    item.append(card);
    fragment.append(item);
  }
  elements['suggestion-list'].replaceChildren(fragment);
  elements['suggestion-list'].start = page * PAGE_SIZE + 1;
  elements['review-empty'].hidden = suggestions.length > 0;
  if (!suggestions.length) {
    const noSuggestions = !analysis.suggestions.length;
    elements['empty-title'].textContent = t(noSuggestions ? 'emptyAllTitle' : activeFilter === 'recommended' ? 'emptyRecommendedTitle' : 'emptyAmbiguousTitle');
    elements['empty-description'].textContent = t(noSuggestions ? 'emptyAllDescription' : activeFilter === 'recommended' ? 'emptyRecommendedDescription' : 'emptyAmbiguousDescription');
  }
  elements.pagination.hidden = pageCount <= 1;
  elements['previous-page'].disabled = page <= 0;
  elements['next-page'].disabled = page >= pageCount - 1;
  elements['page-description'].textContent = t('pageDescription', { page: number(page + 1), pages: number(pageCount), size: number(PAGE_SIZE) });
  updateReviewState();
}

function recordChanges(changes, message) {
  if (!changes.length || !analysis) return;
  history.push(changes);
  for (const change of changes) {
    if (change.after === 'keep') delete choices[change.id];
    else choices[change.id] = change.after;
  }
  renderOutput();
  announce(message);
}

function analyze() {
  const source = currentSource();
  if (!source.trim() || source.length > MAX_SOURCE_LENGTH) return;
  if (analysis && analysis.source === source) {
    elements['review-title'].focus({ preventScroll: true });
    elements['review-title'].scrollIntoView({ block: 'start', behavior: 'auto' });
    announce(t('revisitAnnouncement'));
    return;
  }
  invalidateOutput();
  try {
    analysis = analyzeText(source);
    const recommended = groupSuggestions('recommended').length;
    const ambiguous = groupSuggestions('ambiguous').length;
    activeFilter = recommended || !ambiguous ? 'recommended' : 'ambiguous';
    renderWarnings();
    elements['review-section'].hidden = false;
    renderOutput();
    renderSuggestions();
    elements.source.scrollTop = 0;
    elements.result.scrollTop = 0;
    elements['analyze-label'].textContent = t('revisit');
    announce(t('analyzedAnnouncement', { recommended: number(recommended), ambiguous: number(ambiguous) }));
  } catch (error) {
    invalidateOutput();
    analysisFailed = true;
    updateSourceState();
    announce(t('analysisFailedAnnouncement'));
  }
}

function selectResult() {
  elements.result.focus();
  elements.result.select();
  elements.result.setSelectionRange(0, elements.result.value.length);
}

function showCopyFallback() {
  fallbackVisible = true;
  renderCopyState();
  selectResult();
  announce(elements['copy-instruction'].textContent);
}

elements.source.addEventListener('input', () => {
  const hadAnalysis = Boolean(analysis);
  rawPastedSource = null;
  invalidateOutput();
  updateSourceState();
  if (hadAnalysis) announce(t('editedAnnouncement'));
});

elements.source.addEventListener('paste', (event) => {
  const fullReplacement = elements.source.selectionStart === 0 &&
    elements.source.selectionEnd === elements.source.value.length;
  if (!fullReplacement || !event.clipboardData) return;
  const pasted = event.clipboardData.getData('text/plain');
  if (!pasted) return;
  event.preventDefault();
  const hadAnalysis = Boolean(analysis);
  invalidateOutput();
  rawPastedSource = pasted;
  elements.source.value = pasted;
  elements.source.setSelectionRange(elements.source.value.length, elements.source.value.length);
  updateSourceState();
  if (hadAnalysis) announce(t('pastedAnnouncement'));
});

elements['sample-button'].addEventListener('click', () => {
  if (elements.source.value) return;
  invalidateOutput();
  rawPastedSource = null;
  elements.source.value = SAMPLE;
  updateSourceState();
  elements.source.focus();
  elements.source.setSelectionRange(0, 0);
  elements.source.scrollTop = 0;
  announce(t('sampleAnnouncement'));
});

elements['reset-button'].addEventListener('click', () => {
  invalidateOutput();
  rawPastedSource = null;
  elements.source.value = '';
  updateSourceState();
  elements.source.focus();
  announce(t('resetAnnouncement'));
});

elements['analyze-button'].addEventListener('click', analyze);

elements['apply-recommended-button'].addEventListener('click', () => {
  const changes = pendingRecommended().map((suggestion) => ({ id: suggestion.id, before: choices[suggestion.id] || 'keep', after: 'join' }));
  recordChanges(changes, t('appliedAnnouncement', { count: number(changes.length) }));
});

elements['suggestion-list'].addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !analysis) return;
  const suggestion = analysis.suggestions.find((item) => item.id === input.dataset.suggestion);
  if (!suggestion || !suggestion.options.some((option) => option.value === input.value)) return;
  const before = choices[suggestion.id] || 'keep';
  if (before === input.value) return;
  const option = suggestion.options.find((item) => item.value === input.value);
  recordChanges([{ id: suggestion.id, before, after: input.value }], t('choiceAnnouncement', { first: number(suggestion.line), last: number(suggestion.line + 1), option: optionLabel(suggestion, option, language) }));
});

elements['undo-button'].addEventListener('click', () => {
  const changes = history.pop();
  if (!changes || !analysis) return;
  for (const change of changes) {
    if (change.before === 'keep') delete choices[change.id];
    else choices[change.id] = change.before;
  }
  renderOutput();
  announce(t('undoAnnouncement', { count: number(changes.length) }));
});

for (const filter of ['recommended', 'ambiguous']) {
  elements[`${filter}-filter`].addEventListener('click', () => {
    activeFilter = filter;
    page = 0;
    renderSuggestions();
    announce(t('filterAnnouncement', { filter: t(filter), count: number(groupSuggestions().length) }));
  });
}

for (const [id, direction] of [['previous-page', -1], ['next-page', 1]]) {
  elements[id].addEventListener('click', () => {
    page += direction;
    renderSuggestions();
    elements['review-title'].focus({ preventScroll: true });
    elements['review-title'].scrollIntoView({ block: 'start', behavior: 'auto' });
    announce(elements['page-description'].textContent);
  });
}

elements['copy-button'].addEventListener('click', async () => {
  if (!output?.text || copyPhase === 'pending') return;
  const version = ++clipboardVersion;
  const text = output.text;
  copyPhase = 'pending';
  renderCopyState();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    if (version !== clipboardVersion) return;
    copyPhase = 'copied';
    fallbackVisible = false;
    renderCopyState();
    announce(t('copiedAnnouncement'));
  } catch {
    if (version !== clipboardVersion) return;
    copyPhase = 'idle';
    showCopyFallback();
  } finally {
    if (version === clipboardVersion) renderCopyState();
  }
});

elements['select-result-button'].addEventListener('click', () => {
  selectResult();
  announce(t('selectedAnnouncement'));
});

elements['changes-details'].addEventListener('toggle', () => {
  if (elements['changes-details'].open) renderHighlights();
});

function renderLanguage() {
  const focused = document.activeElement;
  const focusedChoice = focused instanceof HTMLInputElement && focused.dataset.suggestion
    ? { id: focused.dataset.suggestion, value: focused.value } : null;
  const editorViews = [elements.source, elements.result].map((element) => ({
    element, start: element.selectionStart, end: element.selectionEnd,
    direction: element.selectionDirection, top: element.scrollTop, left: element.scrollLeft,
  }));
  const highlightView = { top: elements['highlighted-result'].scrollTop, left: elements['highlighted-result'].scrollLeft };
  const windowView = { left: window.scrollX, top: window.scrollY };

  document.documentElement.lang = language;
  elements.status.lang = language;
  document.title = t('title');
  document.querySelector('meta[name="description"]').content = t('description');
  elements['language-select'].value = language;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const [attribute, key] of [['placeholder', 'i18nPlaceholder'], ['aria-label', 'i18nAriaLabel']]) {
    for (const node of document.querySelectorAll(`[data-i18n-${attribute}]`)) node.setAttribute(attribute, t(node.dataset[key]));
  }
  updateSourceState();
  renderOutputPresentation();
  renderWarnings();
  renderSuggestions();

  if (focusedChoice) {
    const replacement = [...elements['suggestion-list'].querySelectorAll('input')]
      .find((input) => input.dataset.suggestion === focusedChoice.id && input.value === focusedChoice.value);
    replacement?.focus({ preventScroll: true });
  } else if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  }
  for (const view of editorViews) {
    view.element.setSelectionRange(view.start, view.end, view.direction);
    view.element.scrollTop = view.top;
    view.element.scrollLeft = view.left;
  }
  elements['highlighted-result'].scrollTop = highlightView.top;
  elements['highlighted-result'].scrollLeft = highlightView.left;
  window.scrollTo(windowView.left, windowView.top);
}

elements['language-select'].addEventListener('change', () => {
  language = elements['language-select'].value === 'en' ? 'en' : 'ko';
  // Only a nonpersonal language code is written to the URL. No text or choices persist.
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('lang', language);
  try { window.history.replaceState(null, '', url); } catch { /* Memory-only selection still works. */ }
  renderLanguage();
  announce(t('languageAnnouncement'));
});

renderLanguage();
