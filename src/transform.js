/**
 * Reviewable text cleanup. Offsets are UTF-16 offsets, as used by String.slice.
 * The source is never normalized, and no suggestion is applied by default.
 */

const LETTER = /\p{L}/u;
const SUPPORTED_LETTER = /[\p{Script=Latin}\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN = /\p{Script=Latin}/u;
const LOWERCASE = /\p{Ll}/u;
const SENTENCE_END = /[.!?。！？…][\p{Pe}\p{Pf}"'’”]*$/u;
const HORIZONTAL_END = /[^\S\r\n]*$/u;
const HORIZONTAL_START = /^[^\S\r\n]*/u;
const LETTERS_AT_END = /\p{L}[^\S\r\n]*$/u;
const LETTER_AT_START = /^[^\S\r\n]*\p{L}/u;
const WORD_BEFORE_HYPHEN = /\p{L}\p{M}*$/u;

function readLines(source) {
  if (!source.length) return [];
  const lines = [];
  const newline = /\r\n|\n|\r/g;
  let start = 0;
  let match;
  while ((match = newline.exec(source))) {
    lines.push({ text: source.slice(start, match.index), start, end: match.index, next: newline.lastIndex });
    start = newline.lastIndex;
  }
  lines.push({ text: source.slice(start), start, end: source.length, next: source.length });
  return lines;
}

function isStructure(text) {
  return (
    /^\s*(?:[-+*•◦▪‣]|\d+[.)]|\(\d+\)|[A-Za-z가-힣][.)]|[①-⑳])\s+/u.test(text) ||
    /^\s*(?:#{1,6}(?:\s|$)|>|\[[^\]]+\]:)/u.test(text) ||
    /^\s*(?:[-=*]\s*){3,}$/u.test(text) ||
    /^\s*(?:[-=]){2,}\s*$/u.test(text) ||
    /^[ \t]{2,}\S/u.test(text) ||
    /\t|\|/u.test(text) ||
    /\S {2,}\S/u.test(text) ||
    /^\s*(?:https?:\/\/|www\.)\S+\s*$/u.test(text) ||
    /^\s*(?:const|let|var)\s+[\p{L}_$][\w$]*\s*=/u.test(text) ||
    /^\s*[\p{L}_$][\p{L}\p{N}_$.[\]]*\s*(?:[+*/%-]?=)\s*\S/u.test(text) ||
    /^\s*(?:function|class|def|async\s+function|import|export)\b/u.test(text) ||
    /^\s*(?:if|for|while|switch|catch)\s*\(/u.test(text) ||
    /^\s*(?:return|throw)\b.*[;{}]\s*$/u.test(text) ||
    /[{}]\s*;?\s*$/u.test(text) ||
    /^\s*<[/!?]?[A-Za-z][^>]*>/u.test(text) ||
    /^\s*[A-Za-z_$][\w.$]*\(.*\)\s*;?\s*$/u.test(text) ||
    /^\s*[\w"'$.-]+\s*[:=]\s*[\[{"'\d]/u.test(text) ||
    /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|FROM|WHERE|JOIN)\s/u.test(text) ||
    /^\s*(?:\/\/|\/\*|\*\/|--\s|#)/u.test(text) ||
    /^\s*(?:[$%]\s+|(?:npm|npx|pnpm|yarn|pip3?|git|sudo|curl|wget|docker|kubectl)\s+)/u.test(text) ||
    /^\s*#!/u.test(text)
  );
}

function protectedLines(lines) {
  const protectedSet = new Set();
  let fence = null;
  let paragraphStart = 0;
  let paragraphProtected = false;

  function finishParagraph(end) {
    if (paragraphProtected) {
      for (let index = paragraphStart; index < end; index += 1) protectedSet.add(index);
    }
    paragraphStart = end + 1;
    paragraphProtected = false;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].text;
    const marker = text.match(/^\s*(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      protectedSet.add(index);
      paragraphProtected = true;
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
    } else if (marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      protectedSet.add(index);
      paragraphProtected = true;
    }

    if (!text.trim()) {
      finishParagraph(index);
    } else if (isStructure(text)) {
      paragraphProtected = true;
    }
  }
  finishParagraph(lines.length);
  return protectedSet;
}

function hasUnsupportedLetters(text) {
  for (const character of text) {
    if (LETTER.test(character) && !SUPPORTED_LETTER.test(character)) return true;
  }
  return false;
}

function looksLikeHeading(text) {
  if (text.length > 80 || /[.,;!?。！？]/u.test(text)) return false;
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return true;
  if (words.length === 1) return true;
  if (text === text.toUpperCase() && text !== text.toLowerCase()) return true;
  if (words.every((word) => /^[\p{Lu}\p{N}]/u.test(word) || /^(?:a|an|and|as|at|by|for|in|of|on|or|the|to|with)$/u.test(word))) return true;
  return text.length <= 24 && words.length <= 3 && (/^\p{Lu}/u.test(text) || HANGUL.test(text));
}

function isHighSurrogate(code) { return code >= 0xd800 && code <= 0xdbff; }
function isLowSurrogate(code) { return code >= 0xdc00 && code <= 0xdfff; }

function boundaryAfter(text, index) {
  if (isLowSurrogate(text.charCodeAt(index)) && isHighSurrogate(text.charCodeAt(index - 1))) return index + 1;
  return index;
}

function boundaryBefore(text, index) {
  if (isLowSurrogate(text.charCodeAt(index)) && isHighSurrogate(text.charCodeAt(index - 1))) return index - 1;
  return index;
}

function contextBefore(source, position) {
  return source.slice(boundaryAfter(source, Math.max(0, position - 80)), position);
}

function contextAfter(source, position) {
  return source.slice(position, boundaryBefore(source, Math.min(source.length, position + 80)));
}

function classifyJoin(left, right, hasBoundarySpace) {
  const tail = Array.from(left).at(-1) || '';
  const head = Array.from(right)[0] || '';
  const unsupported = hasUnsupportedLetters(left) || hasUnsupportedLetters(right);
  const korean = HANGUL.test(left) || HANGUL.test(right);
  const cjkBoundary = CJK.test(tail) && CJK.test(head);
  const replacement = hasBoundarySpace ? '' : ' ';
  const spacing = hasBoundarySpace
    ? '기존 경계 공백은 그대로 두고 줄바꿈만 제거합니다.'
    : '줄바꿈을 공백 하나로 바꿉니다.';

  let uncertainty = '';
  let reasonCode = 'CONTINUATION';
  if (unsupported) {
    uncertainty = '이 문자 체계의 단어 경계를 판단하지 못하므로 직접 확인해 주세요.';
    reasonCode = 'UNSUPPORTED_SCRIPT';
  } else if (SENTENCE_END.test(left)) {
    uncertainty = '문장이 끝난 자리라 문단 구분일 수 있습니다.';
    reasonCode = 'SENTENCE_END';
  } else if (looksLikeHeading(left) || looksLikeHeading(right) || /[:：]$/u.test(left)) {
    uncertainty = '제목이나 짧은 독립 문장일 수 있습니다.';
    reasonCode = 'POSSIBLE_HEADING';
  } else if (korean && !hasBoundarySpace) {
    uncertainty = '한국어는 단어 중간에서 줄이 바뀐 것인지 판단할 수 없어 공백을 확인해야 합니다.';
    reasonCode = 'KOREAN_WORD_BOUNDARY';
  } else if (cjkBoundary && !hasBoundarySpace) {
    uncertainty = '한자·일본어 문자 사이에 공백이 필요한지 직접 확인해 주세요.';
    reasonCode = 'CJK_SPACING';
  } else if (!((LATIN.test(tail) || /[,;\d]/u.test(tail)) && LATIN.test(head) && LOWERCASE.test(head)) && !cjkBoundary && !(korean && hasBoundarySpace)) {
    uncertainty = '줄 경계가 본문 안의 단순 줄바꿈인지 직접 확인해 주세요.';
    reasonCode = 'UNCERTAIN_BOUNDARY';
  }

  return {
    kind: uncertainty ? 'ambiguous' : 'join',
    recommended: !uncertainty,
    reason: `${uncertainty || '이어지는 본문 줄로 보입니다.'} ${spacing}`,
    reasonCode,
    spacingCode: hasBoundarySpace ? 'KEEP_EXISTING_SPACES' : 'INSERT_SPACE',
    replacement,
    korean,
    unsupported,
  };
}

/** Analyze possible single-line joins without changing any source content. */
export function analyzeText(source) {
  if (typeof source !== 'string') throw new TypeError('source must be a string');
  const lines = readLines(source);
  const protectedSet = protectedLines(lines);
  const suggestions = [];
  let koreanCount = 0;
  let unsupportedCount = 0;
  let hyphenCount = 0;

  for (let index = 0; index + 1 < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (protectedSet.has(index) || protectedSet.has(index + 1)) continue;
    const left = current.text.trim();
    const right = next.text.trim();
    if (!left || !right) continue;

    const trailingSpace = current.text.match(HORIZONTAL_END)[0];
    const leadingSpace = next.text.match(HORIZONTAL_START)[0];
    const hyphen = left.endsWith('-') && WORD_BEFORE_HYPHEN.test(left.slice(0, -1)) && LETTER_AT_START.test(right);
    let start = current.end;
    let end = current.next;
    let kind;
    let recommended;
    let reason;
    let reasonCode;
    let spacingCode;
    let trimBoundarySpaces = false;
    let options;

    if (hyphen) {
      start -= trailingSpace.length + 1;
      end += leadingSpace.length;
      kind = 'hyphen';
      recommended = false;
      hyphenCount += 1;
      if (HANGUL.test(left) || HANGUL.test(right)) koreanCount += 1;
      if (hasUnsupportedLetters(left) || hasUnsupportedLetters(right)) unsupportedCount += 1;
      reason = '줄 끝 하이픈이 원래 단어의 일부인지 줄 나눔 표시인지 판단할 수 없습니다. 하이픈 유지 또는 제거를 직접 선택해 주세요.';
      reasonCode = 'HYPHEN_REVIEW';
      spacingCode = 'HYPHEN_CHOICE';
      trimBoundarySpaces = Boolean(trailingSpace || leadingSpace);
      if (trailingSpace || leadingSpace) reason += ' 연결할 때 하이픈 뒤와 다음 줄 앞의 경계 공백도 제거합니다.';
      options = [
        { value: 'join', label: '하이픈 유지하고 연결', replacement: '-' },
        { value: 'dehyphenate', label: '하이픈 제거하고 연결', replacement: '' },
      ];
    } else {
      const classification = classifyJoin(left, right, Boolean(trailingSpace || leadingSpace));
      ({ kind, recommended, reason, reasonCode, spacingCode } = classification);
      if (classification.korean) koreanCount += 1;
      if (classification.unsupported) unsupportedCount += 1;
      options = [{ value: 'join', label: '줄 연결', replacement: classification.replacement }];
      if (!trailingSpace && !leadingSpace && LETTERS_AT_END.test(left) && LETTER_AT_START.test(right) && (kind === 'ambiguous' || classification.korean || CJK.test(left) || CJK.test(right))) {
        options.push({ value: 'join-tight', label: '공백 없이 연결', replacement: '' });
        reason += ' 한 단어가 중간에서 끊겼다면 공백 없이 연결을 직접 선택할 수 있습니다.';
      }
    }

    const before = source.slice(start, end);
    suggestions.push({
      id: `break-${index + 1}-${start}`,
      line: index + 1,
      start,
      end,
      kind,
      before,
      contextBefore: contextBefore(source, start),
      contextAfter: contextAfter(source, end),
      reason,
      reasonCode,
      spacingCode,
      trimBoundarySpaces,
      allowsTightJoin: options.some((option) => option.value === 'join-tight'),
      recommended,
      options: [{ value: 'keep', label: '원문 유지', replacement: before }, ...options],
    });
  }

  const warnings = [];
  if (protectedSet.size) warnings.push({ code: 'PROTECTED_STRUCTURE', message: `목록·표·코드 등 구조가 있는 ${protectedSet.size}개 줄은 자동 판단 대상에서 제외했습니다. 이어지는 줄도 같은 문단이면 함께 보호합니다.`, params: { count: protectedSet.size } });
  if (koreanCount) warnings.push({ code: 'KOREAN_SPACING', message: '한국어는 줄 끝이 단어 중간일 수 있습니다. 연결 후 띄어쓰기를 직접 확인해 주세요. 뜻이나 맞춤법은 교정하지 않습니다.', params: { count: koreanCount } });
  if (hyphenCount) warnings.push({ code: 'HYPHEN_REVIEW', message: '줄 끝 하이픈은 자동으로 제거하지 않습니다. 각 위치에서 원문 유지, 하이픈 유지 연결, 하이픈 제거 연결 중 하나를 선택할 수 있습니다.', params: { count: hyphenCount } });
  if (unsupportedCount) warnings.push({ code: 'SCRIPT_REVIEW', message: '라틴 문자·한글·한자·일본어 외 문자 체계의 연결은 추천하지 않습니다. 해당 언어의 단어 경계를 직접 확인해 주세요.', params: { count: unsupportedCount } });
  if (suggestions.some((suggestion) => suggestion.kind === 'ambiguous')) warnings.push({ code: 'AMBIGUOUS_BOUNDARIES', message: '문장 끝·제목·단어 경계가 모호한 위치가 있습니다. 모든 위치의 기본 선택은 원문 유지입니다.', params: { count: suggestions.filter((suggestion) => suggestion.kind === 'ambiguous').length } });

  return {
    source,
    suggestions,
    warnings,
    stats: {
      lineCount: lines.length,
      protectedLineCount: protectedSet.size,
      blankLineCount: lines.filter((line) => !line.text.trim()).length,
      suggestionCount: suggestions.length,
      recommendedCount: suggestions.filter((suggestion) => suggestion.recommended).length,
      hyphenCount,
    },
  };
}

/** Apply explicit valid choices; every absent, unknown, or inherited choice keeps the source. */
export function applyChoices(analysis, choices = {}) {
  if (!analysis || typeof analysis.source !== 'string' || !Array.isArray(analysis.suggestions)) {
    throw new TypeError('analysis must be returned by analyzeText');
  }
  const source = analysis.source;
  const chunks = [];
  const changes = [];
  let cursor = 0;
  let outputLength = 0;

  for (const suggestion of analysis.suggestions) {
    const value = choices && Object.prototype.hasOwnProperty.call(choices, suggestion.id) ? choices[suggestion.id] : 'keep';
    if (value === 'keep' || typeof value !== 'string') continue;
    const option = suggestion.options.find((candidate) => candidate.value === value && candidate.value !== 'keep');
    if (!option || typeof option.replacement !== 'string' || option.replacement === suggestion.before) continue;
    if (!Number.isInteger(suggestion.start) || !Number.isInteger(suggestion.end) || suggestion.start < cursor || suggestion.end < suggestion.start || suggestion.end > source.length || source.slice(suggestion.start, suggestion.end) !== suggestion.before) continue;

    const unchanged = source.slice(cursor, suggestion.start);
    chunks.push(unchanged, option.replacement);
    outputLength += unchanged.length;
    changes.push({ start: outputLength, end: outputLength + option.replacement.length, id: suggestion.id });
    outputLength += option.replacement.length;
    cursor = suggestion.end;
  }

  chunks.push(source.slice(cursor));
  const text = chunks.join('');
  if (!changes.length) return { text, appliedCount: 0, segments: [{ text, changed: false }] };

  // Include adjacent text so a deleted newline or hyphen remains visibly reviewable.
  const highlights = [];
  for (const change of changes) {
    const range = {
      start: boundaryBefore(text, Math.max(0, change.start - 12)),
      end: boundaryAfter(text, Math.min(text.length, change.end + 12)),
      id: change.id,
    };
    const previous = highlights.at(-1);
    if (previous && previous.end >= range.start) {
      previous.end = Math.max(previous.end, range.end);
      delete previous.id;
    } else {
      highlights.push(range);
    }
  }

  const segments = [];
  cursor = 0;
  for (const range of highlights) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), changed: false });
    const segment = { text: text.slice(range.start, range.end), changed: true };
    if (range.id) segment.id = range.id;
    segments.push(segment);
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), changed: false });
  return { text, appliedCount: changes.length, segments };
}
