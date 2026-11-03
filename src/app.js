import { analyzeText, applyChoices } from './transform.js';

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
  return value.toLocaleString('ko-KR');
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
  choices = Object.create(null);
  history = [];
  page = 0;
  elements.result.value = '';
  elements['result-count'].textContent = '0자';
  elements['result-hint'].textContent = '제안을 적용하면 여기에 반영돼요';
  elements['result-badge'].hidden = true;
  elements['review-section'].hidden = true;
  elements['changes-details'].hidden = true;
  elements['changes-details'].open = false;
  elements['highlighted-result'].replaceChildren();
  elements['suggestion-list'].replaceChildren();
  elements['warning-list'].replaceChildren();
  elements['copy-fallback'].hidden = true;
  elements['copy-button'].disabled = true;
  elements['copy-button'].lastChild.textContent = '결과 복사';
  elements['undo-button'].disabled = true;
  elements['analyze-button'].firstChild.textContent = '연결 제안 보기 ';
}

function updateSourceState() {
  const source = currentSource();
  const lineCount = source.length ? source.split(/\r\n|\r|\n/).length : 0;
  const overLimit = source.length > MAX_SOURCE_LENGTH;
  elements['source-count'].textContent = `${number(source.length)}자 · ${number(lineCount)}줄`;
  elements['source-error'].hidden = !overLimit;
  elements['source-error'].textContent = overLimit
    ? `현재 ${number(source.length)}자로 처리 한도 ${number(MAX_SOURCE_LENGTH)}자를 넘었어요. 원문은 그대로 보관되어 있습니다. 글을 나눠서 입력해 주세요.`
    : '';
  if (overLimit) elements.source.setAttribute('aria-invalid', 'true');
  else elements.source.removeAttribute('aria-invalid');
  elements['analyze-button'].disabled = !source.trim() || overLimit;
  elements['reset-button'].disabled = !source.length && !analysis;
  elements['sample-button'].disabled = Boolean(source.length);
  elements['sample-button'].title = source.length ? '전체 비우기를 누르면 예시를 넣을 수 있어요.' : '';
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
  elements['apply-recommended-button'].textContent = pending ? `추천 ${number(pending)}곳 적용` : '추천 적용 완료';
  if (!groupSuggestions('recommended').length) elements['apply-recommended-button'].textContent = '적용할 추천 없음';
  elements['applied-count'].textContent = output.appliedCount ? `${number(output.appliedCount)}곳 연결했어요` : '아직 적용한 제안이 없어요';
  for (const card of elements['suggestion-list'].querySelectorAll('.suggestion-card')) {
    const selected = choices[card.dataset.suggestion] || 'keep';
    const suggestion = analysis.suggestions.find((item) => item.id === card.dataset.suggestion);
    const option = suggestion?.options.find((item) => item.value === selected);
    card.classList.toggle('is-applied', selected !== 'keep');
    card.querySelector('.suggestion-state').textContent = selected === 'keep' ? '원문 유지' : `${option?.label || '연결'} 적용`;
    for (const input of card.querySelectorAll('input[type="radio"]')) input.checked = input.value === selected;
  }
}

function renderOutput() {
  if (!analysis) return;
  clipboardVersion += 1;
  output = applyChoices(analysis, choices);
  elements.result.value = output.text;
  elements['result-count'].textContent = `${number(output.text.length)}자`;
  elements['result-hint'].textContent = output.appliedCount ? `${number(output.appliedCount)}곳 연결 · 언제든 되돌릴 수 있어요` : '제안을 고르기 전까지 원문 그대로예요';
  elements['result-badge'].hidden = false;
  elements['result-badge'].textContent = output.appliedCount ? `${number(output.appliedCount)}곳 연결` : '원문 그대로';
  elements['copy-button'].disabled = !output.text;
  elements['copy-button'].lastChild.textContent = '결과 복사';
  elements['copy-fallback'].hidden = true;
  elements['changes-details'].hidden = !output.appliedCount;
  elements['change-count'].textContent = `${number(output.appliedCount)}곳`;
  if (elements['changes-details'].open) renderHighlights();
  else elements['highlighted-result'].replaceChildren();
  updateReviewState();
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
    mark.title = segment.text ? '줄바꿈 또는 하이픈을 바꾼 자리 주변' : '줄바꿈 또는 하이픈을 제거한 위치';
    if (!segment.text) mark.setAttribute('aria-label', '줄바꿈 또는 하이픈을 제거한 위치');
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
  elements['filter-description'].textContent = activeFilter === 'recommended'
    ? '문장 중간에서 끊긴 것으로 보이는 곳이에요. 한꺼번에 적용하거나 하나씩 골라 보세요.'
    : '문단의 경계나 하이픈처럼 뜻을 살펴야 하는 곳이에요. 원문을 읽고 직접 선택해 주세요.';
  const fragment = document.createDocumentFragment();
  const current = suggestions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const originalLines = analysis.source.split(/\r\n|\r|\n/);
  for (const [index, suggestion] of current.entries()) {
    const item = makeElement('li');
    const card = makeElement('article', 'suggestion-card');
    card.dataset.suggestion = suggestion.id;
    const header = makeElement('div', 'suggestion-header');
    header.append(makeElement('span', 'line-label', `${number(suggestion.line)}–${number(suggestion.line + 1)}줄`), makeElement('span', 'suggestion-state', '원문 유지'));
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
    const reason = makeElement('p', 'suggestion-reason', suggestion.reason);
    reason.id = reasonId;
    const fieldset = makeElement('fieldset', 'choice-options');
    fieldset.setAttribute('aria-describedby', reasonId);
    fieldset.append(makeElement('legend', 'sr-only', `${suggestion.line}줄과 ${suggestion.line + 1}줄 사이 처리`));
    for (const option of suggestion.options) {
      const label = makeElement('label', 'choice-label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `choice-${activeFilter}-${page}-${index}`;
      input.value = option.value;
      input.dataset.suggestion = suggestion.id;
      input.checked = (choices[suggestion.id] || 'keep') === option.value;
      label.append(input, makeElement('span', '', option.label));
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
    elements['empty-title'].textContent = noSuggestions ? '지금은 이을 줄이 없어요' : activeFilter === 'recommended' ? '자동으로 추천할 곳은 없어요' : '따로 판단할 곳은 없어요';
    elements['empty-description'].textContent = noSuggestions ? '원문을 그대로 결과에 옮겼어요. 필요하면 복사해서 사용하세요.' : activeFilter === 'recommended' ? '직접 판단 탭에서 문맥을 살펴볼 수 있어요.' : '연결 추천 탭에서 이어 붙일 곳을 골라 보세요.';
  }
  elements.pagination.hidden = pageCount <= 1;
  elements['previous-page'].disabled = page <= 0;
  elements['next-page'].disabled = page >= pageCount - 1;
  elements['page-description'].textContent = `${number(page + 1)} / ${number(pageCount)} 페이지 · ${PAGE_SIZE}개씩 보기`;
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
    announce('현재 선택과 되돌리기 기록을 유지한 채 제안을 다시 표시합니다.');
    return;
  }
  invalidateOutput();
  try {
    analysis = analyzeText(source);
    const recommended = groupSuggestions('recommended').length;
    const ambiguous = groupSuggestions('ambiguous').length;
    activeFilter = recommended || !ambiguous ? 'recommended' : 'ambiguous';
    elements['recommended-count'].textContent = number(recommended);
    elements['ambiguous-count'].textContent = number(ambiguous);
    const protectedCount = analysis.stats.protectedLineCount;
    elements['review-description'].textContent = `연결 추천 ${number(recommended)}곳 · 직접 판단 ${number(ambiguous)}곳${protectedCount ? ` · 구조를 보호한 ${number(protectedCount)}줄` : ''}. 아직 원문은 바꾸지 않았어요.`;
    const warnings = document.createDocumentFragment();
    for (const warning of analysis.warnings) warnings.append(makeElement('li', '', warning.message));
    elements['warning-list'].replaceChildren(warnings);
    elements.warnings.hidden = !analysis.warnings.length;
    elements['review-section'].hidden = false;
    renderOutput();
    renderSuggestions();
    elements.source.scrollTop = 0;
    elements.result.scrollTop = 0;
    elements['analyze-button'].firstChild.textContent = '제안 다시 보기 ';
    announce(`분석을 마쳤어요. 연결 추천 ${number(recommended)}곳, 직접 판단 ${number(ambiguous)}곳입니다. 원문은 그대로입니다.`);
  } catch (error) {
    invalidateOutput();
    elements['source-error'].hidden = false;
    elements['source-error'].textContent = '제안을 만드는 중 문제가 생겼어요. 원문은 그대로 있습니다. 글을 나눠서 다시 시도해 주세요.';
    announce('제안을 만들지 못했어요. 원문은 유지되었습니다.');
  }
}

function selectResult() {
  elements.result.focus();
  elements.result.select();
  elements.result.setSelectionRange(0, elements.result.value.length);
}

function showCopyFallback() {
  const isApple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  elements['copy-fallback'].hidden = false;
  elements['copy-instruction'].textContent = `자동 복사를 사용할 수 없어 결과를 선택했어요. ${isApple ? '⌘ Command+C' : 'Ctrl+C'}로 복사하거나 선택한 글의 복사 메뉴를 사용해 주세요.`;
  selectResult();
  announce(elements['copy-instruction'].textContent);
}

elements.source.addEventListener('input', () => {
  const hadAnalysis = Boolean(analysis);
  rawPastedSource = null;
  invalidateOutput();
  updateSourceState();
  if (hadAnalysis) announce('원문이 바뀌어 이전 제안과 결과를 비웠어요. 연결 제안을 다시 확인해 주세요.');
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
  if (hadAnalysis) announce('새 원문을 붙여 넣어 이전 제안과 결과를 비웠어요. 연결 제안을 다시 확인해 주세요.');
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
  announce('예시를 넣었어요. 연결 제안 보기를 눌러 시작해 보세요.');
});

elements['reset-button'].addEventListener('click', () => {
  invalidateOutput();
  rawPastedSource = null;
  elements.source.value = '';
  updateSourceState();
  elements.source.focus();
  announce('원문, 결과, 선택 기록을 모두 비웠어요.');
});

elements['analyze-button'].addEventListener('click', analyze);

elements['apply-recommended-button'].addEventListener('click', () => {
  const changes = pendingRecommended().map((suggestion) => ({ id: suggestion.id, before: choices[suggestion.id] || 'keep', after: 'join' }));
  recordChanges(changes, `추천 ${number(changes.length)}곳을 연결했어요. 직접 판단할 곳은 그대로입니다.`);
});

elements['suggestion-list'].addEventListener('change', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'radio' || !analysis) return;
  const suggestion = analysis.suggestions.find((item) => item.id === input.dataset.suggestion);
  if (!suggestion || !suggestion.options.some((option) => option.value === input.value)) return;
  const before = choices[suggestion.id] || 'keep';
  if (before === input.value) return;
  const option = suggestion.options.find((item) => item.value === input.value);
  recordChanges([{ id: suggestion.id, before, after: input.value }], `${suggestion.line}줄과 ${suggestion.line + 1}줄 사이: ${option.label} 선택을 적용했어요.`);
});

elements['undo-button'].addEventListener('click', () => {
  const changes = history.pop();
  if (!changes || !analysis) return;
  for (const change of changes) {
    if (change.before === 'keep') delete choices[change.id];
    else choices[change.id] = change.before;
  }
  renderOutput();
  announce(`마지막 선택 ${number(changes.length)}곳을 되돌렸어요.`);
});

for (const filter of ['recommended', 'ambiguous']) {
  elements[`${filter}-filter`].addEventListener('click', () => {
    activeFilter = filter;
    page = 0;
    renderSuggestions();
    announce(`${filter === 'recommended' ? '연결 추천' : '직접 판단'} ${number(groupSuggestions().length)}곳을 표시합니다.`);
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
  if (!output?.text) return;
  const version = ++clipboardVersion;
  const text = output.text;
  elements['copy-button'].disabled = true;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    if (version !== clipboardVersion) return;
    elements['copy-button'].lastChild.textContent = '복사했어요';
    elements['copy-fallback'].hidden = true;
    announce('결과를 복사했어요.');
  } catch {
    if (version !== clipboardVersion) return;
    showCopyFallback();
  } finally {
    if (version === clipboardVersion) elements['copy-button'].disabled = !output?.text;
  }
});

elements['select-result-button'].addEventListener('click', () => {
  selectResult();
  announce('결과 전체를 선택했어요. 키보드 단축키나 복사 메뉴로 복사해 주세요.');
});

elements['changes-details'].addEventListener('toggle', () => {
  if (elements['changes-details'].open) renderHighlights();
});

updateSourceState();
