import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, applyChoices } from '../src/transform.js';
import { suggestionReason, optionLabel, warningMessage } from '../src/transform-text.js';

const INSERT_SPACE_KO = ' 줄바꿈을 공백 하나로 바꿉니다.';
const TIGHT_KO = ' 한 단어가 중간에서 끊겼다면 공백 없이 연결을 직접 선택할 수 있습니다.';
const fixtures = [
  {
    code: 'CONTINUATION',
    source: 'This is a reasonably long wrapped\nparagraph that continues on the next line.',
    ko: '이어지는 본문 줄로 보입니다.' + INSERT_SPACE_KO,
    en: /continue the same paragraph/u,
    values: ['keep', 'join'],
    kind: 'join',
    recommended: true,
  },
  {
    code: 'UNSUPPORTED_SCRIPT',
    source: 'Это достаточно длинный текст\nкоторый продолжается здесь.',
    ko: '이 문자 체계의 단어 경계를 판단하지 못하므로 직접 확인해 주세요.' + INSERT_SPACE_KO + TIGHT_KO,
    en: /writing system.*not supported/u,
    values: ['keep', 'join', 'join-tight'],
    kind: 'ambiguous',
    recommended: false,
  },
  {
    code: 'SENTENCE_END',
    source: 'This sentence has ended.\nAnother sentence begins here.',
    ko: '문장이 끝난 자리라 문단 구분일 수 있습니다.' + INSERT_SPACE_KO,
    en: /sentence ends here.*separate paragraphs/u,
    values: ['keep', 'join'],
    kind: 'ambiguous',
    recommended: false,
  },
  {
    code: 'POSSIBLE_HEADING',
    source: 'Getting started\nthis is a reasonably long introductory paragraph.',
    ko: '제목이나 짧은 독립 문장일 수 있습니다.' + INSERT_SPACE_KO + TIGHT_KO,
    en: /heading.*standalone sentence/u,
    values: ['keep', 'join', 'join-tight'],
    kind: 'ambiguous',
    recommended: false,
  },
  {
    code: 'KOREAN_WORD_BOUNDARY',
    source: '오늘은 날씨가 맑고 따뜻해서 공원으로\n산책을 나가려고 합니다.',
    ko: '한국어는 단어 중간에서 줄이 바뀐 것인지 판단할 수 없어 공백을 확인해야 합니다.' + INSERT_SPACE_KO + TIGHT_KO,
    en: /Korean word may have been split/u,
    values: ['keep', 'join', 'join-tight'],
    kind: 'ambiguous',
    recommended: false,
  },
  {
    code: 'CJK_SPACING',
    source: `${'これは文章の一部です'.repeat(9)}が\n次の行にも文章が続いています。`,
    ko: '한자·일본어 문자 사이에 공백이 필요한지 직접 확인해 주세요.' + INSERT_SPACE_KO + TIGHT_KO,
    en: /space belongs between.*Han or Japanese/u,
    values: ['keep', 'join', 'join-tight'],
    kind: 'ambiguous',
    recommended: false,
  },
  {
    code: 'UNCERTAIN_BOUNDARY',
    source: 'This is a reasonably long line ending with 😀\ncontinuing text on the next line.',
    ko: '줄 경계가 본문 안의 단순 줄바꿈인지 직접 확인해 주세요.' + INSERT_SPACE_KO,
    en: /wrapped line within the same paragraph/u,
    values: ['keep', 'join'],
    kind: 'ambiguous',
    recommended: false,
  },
  {
    code: 'HYPHEN_REVIEW',
    source: 'An example of an inter-\nnational word.',
    ko: '줄 끝 하이픈이 원래 단어의 일부인지 줄 나눔 표시인지 판단할 수 없습니다. 하이픈 유지 또는 제거를 직접 선택해 주세요.',
    en: /hyphen may belong to the word.*Choose explicitly whether to keep or remove/u,
    values: ['keep', 'join', 'dehyphenate'],
    kind: 'hyphen',
    recommended: false,
  },
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test('stable reason metadata covers every classification without changing Korean strings or options', () => {
  for (const fixture of fixtures) {
    const analysis = analyzeText(fixture.source);
    assert.equal(analysis.suggestions.length, 1, fixture.code);
    const [suggestion] = analysis.suggestions;
    assert.equal(suggestion.reasonCode, fixture.code);
    assert.equal(suggestion.kind, fixture.kind);
    assert.equal(suggestion.recommended, fixture.recommended);
    assert.equal(suggestion.spacingCode, fixture.kind === 'hyphen' ? 'HYPHEN_CHOICE' : 'INSERT_SPACE');
    assert.equal(suggestion.trimBoundarySpaces, false);
    assert.equal(suggestion.allowsTightJoin, fixture.values.includes('join-tight'));
    assert.equal(suggestion.reason, fixture.ko);
    assert.equal(suggestionReason(suggestion, 'ko'), fixture.ko);
    assert.equal(suggestionReason(suggestion), fixture.ko);
    assert.deepEqual(suggestion.options.map((option) => option.value), fixture.values);
    assert.match(suggestionReason(suggestion, 'en'), fixture.en);
    for (const option of suggestion.options) assert.equal(optionLabel(suggestion, option, 'ko'), option.label);
  }
});

test('ordinary joins accurately distinguish inserted spaces from existing spaces', () => {
  const [ordinary] = analyzeText(fixtures[0].source).suggestions;
  assert.equal(optionLabel(ordinary, ordinary.options[1], 'en'), 'Join with a space');
  assert.match(suggestionReason(ordinary, 'en'), /replaces the line break with one space/u);

  const source = 'An ordinary paragraph wraps here \r\n and continues with existing spaces.';
  const [spaced] = analyzeText(source).suggestions;
  assert.equal(spaced.spacingCode, 'KEEP_EXISTING_SPACES');
  assert.equal(spaced.trimBoundarySpaces, false);
  assert.equal(spaced.allowsTightJoin, false);
  assert.equal(spaced.reason, '이어지는 본문 줄로 보입니다. 기존 경계 공백은 그대로 두고 줄바꿈만 제거합니다.');
  assert.equal(optionLabel(spaced, spaced.options[1], 'en'), 'Join, keep existing spaces');
  assert.match(suggestionReason(spaced, 'en'), /removes only the line break.*preserves all existing spaces/u);
  assert.equal(applyChoices(analyzeText(source), { [spaced.id]: 'join' }).text, source.replace('\r\n', ''));
});

test('hyphen labels and reasons make keeping, removing, and boundary-space removal explicit', () => {
  for (const source of ['An example of an inter-\nnational word.', 'An example of an inter- \n national word.']) {
    const [suggestion] = analyzeText(source).suggestions;
    const labels = suggestion.options.map((option) => optionLabel(suggestion, option, 'en'));
    assert.deepEqual(labels, ['Keep original', 'Join, keep hyphen', 'Join, remove hyphen']);
    assert.deepEqual(suggestion.options.map((option) => option.label), ['원문 유지', '하이픈 유지하고 연결', '하이픈 제거하고 연결']);
    assert.equal(suggestion.trimBoundarySpaces, source.includes('- '));
    assert.match(suggestionReason(suggestion, 'en'), /Joining adds no space/u);
    if (suggestion.trimBoundarySpaces) {
      assert.match(suggestionReason(suggestion, 'en'), /removes spaces after the line-ending hyphen and at the start of the next line/u);
      assert.equal(suggestion.reason, fixtures[7].ko + ' 연결할 때 하이픈 뒤와 다음 줄 앞의 경계 공백도 제거합니다.');
    } else {
      assert.doesNotMatch(suggestionReason(suggestion, 'en'), /also removes spaces/u);
    }
  }
});

test('tight joins remain an explicit alternative with unambiguous English labels', () => {
  const analysis = analyzeText('프로그\n램');
  const [suggestion] = analysis.suggestions;
  assert.equal(suggestion.allowsTightJoin, true);
  assert.equal(suggestion.recommended, false);
  assert.equal(optionLabel(suggestion, suggestion.options[2], 'en'), 'Join without a space');
  assert.equal(suggestion.options[2].label, '공백 없이 연결');
  assert.match(suggestionReason(suggestion, 'en'), /explicitly choose “Join without a space.”/u);
  assert.equal(applyChoices(analysis).text, '프로그\n램');
  assert.equal(applyChoices(analysis, { [suggestion.id]: 'join' }).text, '프로그 램');
  assert.equal(applyChoices(analysis, { [suggestion.id]: 'join-tight' }).text, '프로그램');
});

test('every warning preserves Korean and provides correct English counts and singular/plural grammar', () => {
  const cases = [
    { source: '- A list item\ncontinued text', code: 'PROTECTED_STRUCTURE', count: 2, english: /Protected 2 lines.*structured blocks/u, singular: /Protected 1 line in/u, plural: /Protected 2 lines in/u },
    { source: fixtures[4].source, code: 'KOREAN_SPACING', count: 1, english: /1 Korean line boundary.*does not correct meaning or spelling/u, singular: /1 Korean line boundary after/u, plural: /2 Korean line boundaries after/u },
    { source: fixtures[7].source, code: 'HYPHEN_REVIEW', count: 1, english: /1 line-ending hyphen requires review.*never removed automatically/u, singular: /1 line-ending hyphen requires/u, plural: /2 line-ending hyphens require/u },
    { source: fixtures[1].source, code: 'SCRIPT_REVIEW', count: 1, english: /1 line boundary uses scripts outside Latin, Hangul, Han, hiragana, and katakana/u, singular: /1 line boundary uses/u, plural: /2 line boundaries use/u },
    { source: fixtures[2].source, code: 'AMBIGUOUS_BOUNDARIES', count: 1, english: /1 line boundary needs review.*defaults to “Keep original.”/u, singular: /1 line boundary needs/u, plural: /2 line boundaries need/u },
  ];
  for (const entry of cases) {
    const warning = analyzeText(entry.source).warnings.find((item) => item.code === entry.code);
    assert.ok(warning, entry.code);
    assert.deepEqual(warning.params, { count: entry.count });
    assert.equal(warningMessage(warning, 'ko'), warning.message);
    assert.equal(warningMessage(warning), warning.message);
    assert.match(warningMessage(warning, 'en'), entry.english);
    assert.match(warningMessage({ ...warning, params: { count: 1 } }, 'en'), entry.singular);
    assert.match(warningMessage({ ...warning, params: { count: 2 } }, 'en'), entry.plural);
    const repeated = analyzeText(`${entry.source}\n\n${entry.source}`).warnings.find((item) => item.code === entry.code);
    assert.deepEqual(repeated.params, { count: entry.count * 2 });
  }
});

test('English explanations for all known result types contain no Korean UI text', () => {
  const sources = [...fixtures.map((fixture) => fixture.source), '- An item\ncontinued item', 'A normal paragraph wraps here \n with existing spaces.', 'An example of an inter- \n national word.'];
  for (const source of sources) {
    const analysis = analyzeText(source);
    for (const suggestion of analysis.suggestions) {
      assert.doesNotMatch(suggestionReason(suggestion, 'en'), /\p{Script=Hangul}/u);
      for (const option of suggestion.options) assert.doesNotMatch(optionLabel(suggestion, option, 'en'), /\p{Script=Hangul}/u);
    }
    for (const warning of analysis.warnings) assert.doesNotMatch(warningMessage(warning, 'en'), /\p{Script=Hangul}/u);
  }
});

test('localization does not mutate analyses, choices, spans, recommendations, or output', () => {
  const source = fixtures.map((fixture) => fixture.source).join('\r\n\r\n');
  const analysis = deepFreeze(analyzeText(source));
  const snapshot = JSON.stringify(analysis);
  for (const suggestion of analysis.suggestions) {
    assert.equal(source.slice(suggestion.start, suggestion.end), suggestion.before);
    for (const option of suggestion.options) {
      const choices = deepFreeze({ [suggestion.id]: option.value });
      const expected = source.slice(0, suggestion.start) + option.replacement + source.slice(suggestion.end);
      const baseline = applyChoices(analysis, choices);
      assert.equal(baseline.text, expected);
      for (const lang of ['ko', 'en', 'ko']) {
        suggestionReason(suggestion, lang);
        optionLabel(suggestion, option, lang);
        for (const warning of analysis.warnings) warningMessage(warning, lang);
        assert.deepEqual(applyChoices(analysis, choices), baseline);
      }
    }
  }
  assert.equal(JSON.stringify(analysis), snapshot);
  assert.equal(applyChoices(analysis).text, source);
});

test('English fallbacks remain English without parsing or leaking legacy Korean messages', () => {
  const suggestion = { kind: 'ambiguous', reason: '한국어 설명', options: [{ value: 'join', replacement: ' ' }] };
  assert.match(suggestionReason(suggestion, 'en'), /wrapped line within the same paragraph/u);
  assert.doesNotMatch(suggestionReason({ ...suggestion, reasonCode: 'constructor', spacingCode: 'constructor' }, 'en'), /한국어|function/u);
  assert.equal(optionLabel(suggestion, { value: 'unknown', label: '한국어 선택' }, 'en'), 'Review option');
  assert.equal(warningMessage({ code: 'UNKNOWN', message: '한국어 경고' }, 'en'), 'Review this warning before changing the text.');
  for (const code of ['PROTECTED_STRUCTURE', 'KOREAN_SPACING', 'HYPHEN_REVIEW', 'SCRIPT_REVIEW', 'AMBIGUOUS_BOUNDARIES']) {
    assert.doesNotMatch(warningMessage({ code, message: '한국어 경고' }, 'en'), /한국어|undefined|null|NaN/u);
  }
});
