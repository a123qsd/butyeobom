import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, applyChoices } from '../src/transform.js';

const edgeCases = [
  '',
  '\r\n',
  '\n\r\n\r',
  '  첫 줄\t\r\n둘째 줄  \r\n',
  '첫 줄\r둘째 줄\n셋째 줄\r\n마지막 줄',
  'e\u0301와 🌱\r\n한글과 👩‍💻\n마지막 👨‍👩‍👧‍👦',
  '<img src=x onerror=alert(1)>\n<script>문자열</script>\n& < > " \'',
  '```js\r\nconst sample = "fictional";\r\n  run(sample);\r\n```\r\n',
  '| 열 하나 | 열 둘 |\n| --- | --- |\n| 값 하나 | 값 둘 |',
  '- 창작 항목 하나\n- 창작 항목 둘\n\n끝 문장.\n',
  'A fictional inter-\r\nnational example with preserved gaps.\r\n\r\n끝.',
];

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function checkResult(result) {
  assert.equal(result.segments.map(segment => segment.text).join(''), result.text);
  assert.ok(Number.isInteger(result.appliedCount));
  assert.ok(result.appliedCount >= 0);
}

test('keeping original is exact for mixed newlines, whitespace, Unicode, and markup', () => {
  for (const source of edgeCases) {
    const analysis = analyzeText(source);
    const choices = Object.fromEntries(analysis.suggestions.map(({ id }) => [id, 'keep']));
    for (const selected of [{}, choices]) {
      const result = applyChoices(analysis, selected);
      assert.equal(result.text, source);
      assert.equal(result.appliedCount, 0);
      checkResult(result);
    }
  }
});

test('deterministic mixed-newline corpus preserves every source code unit by default', () => {
  let seed = 0x6a4f3c29;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const tokens = ['글', 'fictional', '\r\n', '\n', '\r', '  ', '\t', '🌱', 'e\u0301', '-', '|', '`', '<', '>', '\u200b'];
  for (let trial = 0; trial < 150; trial += 1) {
    const length = 1 + random() % 80;
    const source = Array.from({ length }, () => tokens[random() % tokens.length]).join('');
    const analysis = analyzeText(source);
    const result = applyChoices(analysis, {});
    assert.equal(result.text, source, `source preservation failed for corpus case ${trial}`);
    assert.deepEqual(analyzeText(source), analysis, `analysis changed for corpus case ${trial}`);
    checkResult(result);
  }
});

test('an individual permitted edit cannot alter any text outside its declared range', () => {
  let editsChecked = 0;
  for (const source of edgeCases) {
    const analysis = analyzeText(source);
    const originalSnapshot = JSON.stringify(analysis);
    freezeDeep(analysis);
    for (const suggestion of analysis.suggestions) {
      assert.ok(Number.isInteger(suggestion.start));
      assert.ok(Number.isInteger(suggestion.end));
      assert.ok(suggestion.start >= 0 && suggestion.start <= suggestion.end);
      assert.ok(suggestion.end <= source.length);
      for (const option of suggestion.options.filter(option => option.value !== 'keep')) {
        const choices = Object.freeze({ [suggestion.id]: option.value });
        const result = applyChoices(analysis, choices);
        const expected = source.slice(0, suggestion.start) + option.replacement + source.slice(suggestion.end);
        assert.equal(result.text, expected);
        assert.equal(result.appliedCount, 1);
        assert.equal(JSON.stringify(analysis), originalSnapshot);
        checkResult(result);
        editsChecked += 1;
      }
    }
  }
  assert.ok(editsChecked > 0, 'the corpus must exercise at least one offered edit');
});
