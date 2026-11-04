/** Presentation-only translations. These helpers never change a choice or the source. */

const REASONS = Object.freeze({
  CONTINUATION: 'These lines appear to continue the same paragraph.',
  UNSUPPORTED_SCRIPT: 'Word boundaries in this writing system are not supported by the detection rules. Please review this join yourself.',
  SENTENCE_END: 'The sentence ends here, so the line break may separate paragraphs.',
  POSSIBLE_HEADING: 'This may be a heading or a short, standalone sentence.',
  KOREAN_WORD_BOUNDARY: 'A Korean word may have been split across these lines. Check whether a space belongs here.',
  CJK_SPACING: 'Check whether a space belongs between these Han or Japanese characters.',
  UNCERTAIN_BOUNDARY: 'Check whether this is simply a wrapped line within the same paragraph.',
  HYPHEN_REVIEW: 'The line-ending hyphen may belong to the word or may only mark a line break. Choose explicitly whether to keep or remove it when joining.',
});

const SPACING = Object.freeze({
  KEEP_EXISTING_SPACES: 'Joining removes only the line break and preserves all existing spaces at the boundary.',
  INSERT_SPACE: 'Joining replaces the line break with one space.',
  HYPHEN_CHOICE: 'Joining adds no space between the lines.',
});

function spacingCode(suggestion) {
  if (suggestion.spacingCode) return suggestion.spacingCode;
  if (suggestion.kind === 'hyphen') return 'HYPHEN_CHOICE';
  return suggestion.options?.find((option) => option.value === 'join')?.replacement === ''
    ? 'KEEP_EXISTING_SPACES'
    : 'INSERT_SPACE';
}

/** Return an explanation for the current locale without interpreting the source text. */
export function suggestionReason(suggestion, lang = 'ko') {
  if (lang !== 'en') return suggestion.reason;
  const fallback = suggestion.kind === 'hyphen' ? 'HYPHEN_REVIEW' : suggestion.kind === 'join' ? 'CONTINUATION' : 'UNCERTAIN_BOUNDARY';
  const parts = [Object.hasOwn(REASONS, suggestion.reasonCode) ? REASONS[suggestion.reasonCode] : REASONS[fallback]];
  const code = spacingCode(suggestion);
  const spacing = Object.hasOwn(SPACING, code) ? SPACING[code] : '';
  if (spacing) parts.push(spacing);
  if (suggestion.trimBoundarySpaces) {
    parts.push('Joining also removes spaces after the line-ending hyphen and at the start of the next line.');
  }
  if (suggestion.allowsTightJoin ?? suggestion.options?.some((option) => option.value === 'join-tight')) {
    parts.push('If one word was split across the lines, you can explicitly choose “Join without a space.”');
  }
  return parts.join(' ');
}

/** Labels describe the actual option; they never select or recommend it. */
export function optionLabel(suggestion, option, lang = 'ko') {
  if (lang !== 'en') return option.label;
  switch (option.value) {
    case 'keep': return 'Keep original';
    case 'join':
      if (suggestion.kind === 'hyphen') return 'Join, keep hyphen';
      return spacingCode(suggestion) === 'KEEP_EXISTING_SPACES' ? 'Join, keep existing spaces' : 'Join with a space';
    case 'join-tight': return 'Join without a space';
    case 'dehyphenate': return 'Join, remove hyphen';
    default: return 'Review option';
  }
}

function countOf(warning) {
  const count = warning.params?.count;
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

/** Translate stable warning codes; unknown English warnings use an English fallback. */
export function warningMessage(warning, lang = 'ko') {
  if (lang !== 'en') return warning.message;
  const count = countOf(warning);
  switch (warning.code) {
    case 'PROTECTED_STRUCTURE':
      return `${count === null ? 'Protected lines' : `Protected ${count} ${count === 1 ? 'line' : 'lines'}`} in structured blocks such as lists, tables, or code. Continuation lines in the same paragraph are protected too.`;
    case 'KOREAN_SPACING':
      return `${count === null ? 'Check Korean spacing' : `Check spacing at ${count} Korean line ${count === 1 ? 'boundary' : 'boundaries'}`} after joining: a line may end in the middle of a word. This tool does not correct meaning or spelling.`;
    case 'HYPHEN_REVIEW':
      return `${count === null ? 'Line-ending hyphens require' : `${count} line-ending ${count === 1 ? 'hyphen requires' : 'hyphens require'}`} review. Hyphens are never removed automatically. At each location, keep the original, join while keeping the hyphen, or join while removing it.`;
    case 'SCRIPT_REVIEW':
      return `${count === null ? 'Some line boundaries use' : `${count} line ${count === 1 ? 'boundary uses' : 'boundaries use'}`} scripts outside Latin, Hangul, Han, hiragana, and katakana. Joins at these boundaries are not recommended; check the word boundaries yourself.`;
    case 'AMBIGUOUS_BOUNDARIES':
      return `${count === null ? 'Some line boundaries need' : `${count} line ${count === 1 ? 'boundary needs' : 'boundaries need'}`} review because of possible sentence endings, headings, or unclear word boundaries. Every location defaults to “Keep original.”`;
    default:
      return 'Review this warning before changing the text.';
  }
}
