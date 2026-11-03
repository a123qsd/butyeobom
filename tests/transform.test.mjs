import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, applyChoices } from '../src/transform.js';

function chooseAll(analysis, value = 'join') {
  return Object.fromEntries(analysis.suggestions.map((suggestion) => [suggestion.id, value]));
}

function assertSegments(result) {
  assert.equal(result.segments.map((segment) => segment.text).join(''), result.text);
  for (const segment of result.segments) {
    assert.equal(typeof segment.changed, 'boolean');
    assert.equal(segment.text.isWellFormed(), true);
  }
}

test('empty and single-line inputs retain their exact source', () => {
  for (const source of ['', 'single line', '\uFEFF한 줄만 있습니다.  ', '\n', '\r\n', '\r']) {
    const analysis = analyzeText(source);
    assert.equal(analysis.source, source);
    assert.equal(analysis.suggestions.length, 0);
    assert.equal(applyChoices(analysis).text, source);
    assertSegments(applyChoices(analysis));
  }
  assert.equal(analyzeText('').stats.lineCount, 0);
  assert.equal(analyzeText('one\r\ntwo\n').stats.lineCount, 3);
  assert.throws(() => analyzeText(null), TypeError);
});

test('ordinary English prose is a recommended but unapplied join', () => {
  const source = 'This is a reasonably long wrapped\nparagraph that continues on the next line.';
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions.length, 1);
  const [suggestion] = analysis.suggestions;
  assert.equal(suggestion.kind, 'join');
  assert.equal(suggestion.recommended, true);
  assert.equal(suggestion.line, 1);
  assert.equal(suggestion.before, '\n');
  assert.equal(suggestion.before, source.slice(suggestion.start, suggestion.end));
  assert.equal(suggestion.options[0].value, 'keep');
  assert.equal(suggestion.options[0].replacement, '\n');
  assert.equal(applyChoices(analysis).text, source);
  const result = applyChoices(analysis, chooseAll(analysis));
  assert.equal(result.text, source.replace('\n', ' '));
  assert.equal(result.appliedCount, 1);
  assertSegments(result);
});

test('Korean word boundaries require review and preserve characters', () => {
  for (const source of ['오늘은 날씨가 맑아서\n공원으로 산책을 나갔습니다.', '텍스트를 자동으로 정\n리하면 단어가 갈라질 수 있습니다.']) {
    const analysis = analyzeText(source);
    assert.equal(analysis.suggestions.length, 1);
    assert.equal(analysis.suggestions[0].recommended, false);
    assert.ok(analysis.warnings.some((warning) => warning.code === 'KOREAN_SPACING'));
    assert.equal(applyChoices(analysis).text, source);
    assert.equal(applyChoices(analysis, chooseAll(analysis)).text, source.replace('\n', ' '));
  }
  const splitWord = analyzeText('프로그\n램');
  assert.equal(splitWord.suggestions[0].recommended, false);
  assert.equal(applyChoices(splitWord, chooseAll(splitWord)).text, '프로그 램');
  assert.equal(applyChoices(splitWord, chooseAll(splitWord, 'join-tight')).text, '프로그램');
  assert.equal(applyChoices(splitWord).text, '프로그\n램');
});

test('CRLF and lone CR are preserved by keep and explicitly replaceable', () => {
  const source = 'This is a reasonably long first\r\nparagraph continued over a line.\r\n\r\nAnother reasonably long paragraph\rcontinues across a lone carriage return.';
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions.length, 2);
  assert.equal(analysis.suggestions[0].before, '\r\n');
  assert.equal(analysis.suggestions[1].before, '\r');
  assert.equal(applyChoices(analysis, chooseAll(analysis, 'keep')).text, source);
  const result = applyChoices(analysis, chooseAll(analysis));
  assert.equal(result.text, 'This is a reasonably long first paragraph continued over a line.\r\n\r\nAnother reasonably long paragraph continues across a lone carriage return.');
  assertSegments(result);
});

test('line-end ASCII hyphens require explicit preserve or remove decisions', () => {
  const source = 'An example of an inter-\r\nnational word and a well-\nknown compound.';
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions.length, 2);
  for (const suggestion of analysis.suggestions) {
    assert.equal(suggestion.kind, 'hyphen');
    assert.equal(suggestion.recommended, false);
    assert.deepEqual(suggestion.options.map((option) => option.value), ['keep', 'join', 'dehyphenate']);
  }
  assert.equal(applyChoices(analysis).text, source);
  assert.equal(applyChoices(analysis, chooseAll(analysis)).text, 'An example of an inter-national word and a well-known compound.');
  const result = applyChoices(analysis, { [analysis.suggestions[0].id]: 'dehyphenate', [analysis.suggestions[1].id]: 'join' });
  assert.equal(result.text, 'An example of an international word and a well-known compound.');
  assert.equal(result.appliedCount, 2);
  assert.ok(result.segments.some((segment) => segment.changed && /international/u.test(segment.text)));
  assertSegments(result);
});

test('hyphen boundary whitespace is removed only with an explained explicit choice', () => {
  const source = 'A line wraps an inter- \n national word.';
  const analysis = analyzeText(source);
  const [suggestion] = analysis.suggestions;
  assert.equal(suggestion.before, '- \n ');
  assert.match(suggestion.reason, /경계 공백/u);
  assert.equal(applyChoices(analysis).text, source);
  assert.equal(applyChoices(analysis, chooseAll(analysis)).text, 'A line wraps an inter-national word.');
  assert.equal(applyChoices(analysis, chooseAll(analysis, 'dehyphenate')).text, 'A line wraps an international word.');
});

test('existing boundary spaces are retained rather than trimmed or duplicated', () => {
  const source = 'An ordinary paragraph wraps here \n and continues with visible boundary spaces.';
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions[0].before, '\n');
  assert.equal(analysis.suggestions[0].options[1].replacement, '');
  const result = applyChoices(analysis, chooseAll(analysis));
  assert.equal(result.text, source.replace('\n', ''));
  assert.ok(result.segments.some((segment) => segment.changed && segment.text.length > 1));
  assertSegments(result);
});

test('blank lines, including whitespace-only lines, remain untouched', () => {
  const source = 'A reasonably long first paragraph\ncontinues here.\n \n\r\nA reasonably long second paragraph\ncontinues below.\n';
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions.length, 2);
  assert.equal(applyChoices(analysis, chooseAll(analysis)).text, 'A reasonably long first paragraph continues here.\n \n\r\nA reasonably long second paragraph continues below.\n');
});

test('lists, tables, headings, and code protect their complete paragraphs', () => {
  const protectedExamples = [
    '- A list item with wrapped text\ncontinuation stays on its own line.\nAnother continuation is also preserved.',
    '1. A numbered item\ncontinued text',
    '(1) A numbered item\ncontinued text',
    '• A bullet item\ncontinued text',
    'A paragraph before a list\n- an item\ncontinued item',
    'Name | Value\nA | 10\nB | 20',
    'Name\tValue\nA\t10',
    'Name   Value\nAlpha  10',
    '# A heading\nText under that heading\nmore text',
    'A heading\n----------\nParagraph under heading',
    '> A quotation\ncontinued quotation',
    '    const value = 1;\n    value += 2;',
    'const value = 1;\nvalue += 2;\nconsole.log(value);',
    'greeting = message\nanswer = value',
    '// explanatory comment\ncontinued text',
    'npm install\nnpm test',
    'function example() {\nreturn 1;\n}',
    'SELECT value\nFROM example\nWHERE value > 0',
    '<script>\nalert("text");\n</script>',
    'https://example.test/path\nfollowed by a description',
  ];
  for (const source of protectedExamples) {
    const analysis = analyzeText(source);
    assert.equal(analysis.suggestions.length, 0, source);
    assert.equal(applyChoices(analysis, chooseAll(analysis)).text, source);
    assert.ok(analysis.warnings.some((warning) => warning.code === 'PROTECTED_STRUCTURE'));
  }
});

test('fenced code spans blank lines, closes with its own marker, and may remain unclosed', () => {
  const source = 'A reasonably long opening paragraph\ncontinues here.\n\n````js\nordinary looking code line\ncontinued code line\n\n```\nstill inside the longer fence\nnext code line\n````\n\nAnother reasonably long paragraph\ncontinues afterwards.\n\n~~~\nunclosed code\ncontinues forever\n\nlast code line';
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions.length, 2);
  assert.deepEqual(analysis.suggestions.map((suggestion) => suggestion.line), [1, 13]);
  const result = applyChoices(analysis, chooseAll(analysis));
  assert.match(result.text, /````js\nordinary looking code line\ncontinued code line\n\n```\nstill inside the longer fence\nnext code line\n````/u);
  assert.match(result.text, /~~~\nunclosed code\ncontinues forever\n\nlast code line$/u);
});

test('sentence endings, possible headings, and unsupported scripts are not recommended', () => {
  const examples = [
    'This sentence has ended.\nAnother sentence begins here.',
    'This sentence has ended!”\nAnother sentence begins here.',
    'Getting started\nthis is a reasonably long introductory paragraph.',
    'A Short Heading\nthis is the first paragraph.',
    '작업 안내\n여기에서 새 문단을 시작합니다.',
    'Это достаточно длинный текст\nкоторый продолжается здесь.',
    'هذه جملة طويلة للتجربة\nوهنا تتمة النص',
    'यह एक परीक्षण वाक्य है\nऔर यह अगली पंक्ति है',
  ];
  for (const source of examples) {
    const analysis = analyzeText(source);
    assert.ok(analysis.suggestions.length > 0, source);
    assert.ok(analysis.suggestions.every((suggestion) => !suggestion.recommended), source);
    assert.equal(applyChoices(analysis).text, source);
  }
});

test('CJK offers explicit no-space joins, and soft hyphens are never silently removed', () => {
  const source = 'これは改行された長い文章の一部で\n次の行にも文章が続いています。';
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions[0].recommended, false);
  assert.equal(applyChoices(analysis, chooseAll(analysis)).text, source.replace('\n', ' '));
  assert.equal(applyChoices(analysis, chooseAll(analysis, 'join-tight')).text, source.replace('\n', ''));
  const softSource = 'This includes a soft hyphen inter\u00ad\nnational form.';
  const softAnalysis = analyzeText(softSource);
  assert.equal(applyChoices(softAnalysis).text, softSource);
  assert.ok(applyChoices(softAnalysis, chooseAll(softAnalysis)).text.includes('\u00ad'));
  assert.ok(softAnalysis.suggestions.every((suggestion) => suggestion.kind !== 'hyphen'));
});

test('Unicode combining marks and emoji survive offsets and highlights without split surrogates', () => {
  const source = `😀${'a'.repeat(80)} e\u0301 and a wrapped\nparagraph with 🧑🏽‍💻 and another ${'b'.repeat(80)}😀`;
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions.length, 1);
  for (const suggestion of analysis.suggestions) {
    assert.equal(suggestion.before, source.slice(suggestion.start, suggestion.end));
    assert.ok(suggestion.contextBefore.length <= 80);
    assert.ok(suggestion.contextAfter.length <= 80);
    assert.equal(suggestion.contextBefore.isWellFormed(), true);
    assert.equal(suggestion.contextAfter.isWellFormed(), true);
  }
  const result = applyChoices(analysis, chooseAll(analysis));
  assert.equal(result.text, source.replace('\n', ' '));
  assertSegments(result);

  const emojiSource = 'A paragraph ending with 😀aaaaaaaaaaa\ncontinues with bbbbbbbbbbb😀 elsewhere.';
  assertSegments(applyChoices(analyzeText(emojiSource), chooseAll(analyzeText(emojiSource))));
  const decomposed = analyzeText('A decomposed cafe\u0301-\nlike example.');
  assert.equal(decomposed.suggestions[0].kind, 'hyphen');
  assert.equal(applyChoices(decomposed, chooseAll(decomposed, 'dehyphenate')).text, 'A decomposed cafe\u0301like example.');
});

test('XSS-shaped strings remain inert text and are not encoded or interpreted', () => {
  const source = 'A paragraph contains the literal <img src=x onerror="alert(1)">\nand also &lt;script&gt; as copied text.';
  const analysis = analyzeText(source);
  const result = applyChoices(analysis, chooseAll(analysis));
  assert.equal(applyChoices(analysis).text, source);
  assert.equal(result.text, source.replace('\n', ' '));
  assert.ok(result.text.includes('<img src=x onerror="alert(1)">'));
  assert.ok(result.text.includes('&lt;script&gt;'));
  assertSegments(result);
});

test('unknown, invalid, inherited, and irrelevant choices preserve the original', () => {
  const source = 'This is a reasonably long wrapped\r\nparagraph that continues here.';
  const analysis = analyzeText(source);
  const id = analysis.suggestions[0].id;
  for (const choices of [{}, null, { missing: 'join' }, { [id]: 'dehyphenate' }, { [id]: 'invalid' }, { [id]: true }, { [id]: null }, Object.create({ [id]: 'join' })]) {
    const result = applyChoices(analysis, choices);
    assert.equal(result.text, source);
    assert.equal(result.appliedCount, 0);
  }
});

test('repeated application is deterministic and does not mutate its inputs', () => {
  const analysis = analyzeText('A reasonably long opening paragraph\ncontinues with an inter-\nnational example.');
  const snapshot = JSON.stringify(analysis);
  const choices = Object.freeze({ ...chooseAll(analysis), [analysis.suggestions[1].id]: 'dehyphenate' });
  const first = applyChoices(analysis, choices);
  assert.deepEqual(applyChoices(analysis, choices), first);
  assert.equal(JSON.stringify(analysis), snapshot);
  const nextAnalysis = analyzeText(first.text);
  assert.equal(nextAnalysis.suggestions.length, 0);
  assert.equal(applyChoices(nextAnalysis).text, first.text);
  assertSegments(first);
});

test('large input has deterministic unique offsets and preserves every paragraph break', () => {
  const paragraph = 'A reasonably long first line of prose\ncontinues here with enough words.\n\n';
  const source = paragraph.repeat(12000);
  const analysis = analyzeText(source);
  assert.equal(analysis.suggestions.length, 12000);
  assert.equal(new Set(analysis.suggestions.map((suggestion) => suggestion.id)).size, 12000);
  assert.equal(applyChoices(analysis).text, source);
  const result = applyChoices(analysis, chooseAll(analysis));
  assert.equal(result.appliedCount, 12000);
  assert.equal(result.text, paragraph.replace('\n', ' ').repeat(12000));
  assertSegments(result);
});
