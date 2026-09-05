'use strict';

const { ValidationError } = require('../../utils/validation');

/** Small text helpers used by `/text`. */

const MAX_LENGTH = 4000;

function words(text) {
  return String(text).split(/[\s_\-./\\]+/).filter(Boolean).flatMap((word) =>
    word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/).filter(Boolean),
  );
}

const TRANSFORMS = {
  upper: { label: 'UPPER CASE', apply: (text) => text.toUpperCase() },
  lower: { label: 'lower case', apply: (text) => text.toLowerCase() },
  title: {
    label: 'Title Case',
    apply: (text) => text.replace(/\p{L}[\p{L}\p{N}'’]*/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase()),
  },
  sentence: {
    label: 'Sentence case',
    apply: (text) => {
      const lowered = text.toLowerCase();
      return lowered.replace(/(^\s*\p{L})|([.!?]\s+\p{L})/gu, (match) => match.toUpperCase());
    },
  },
  camel: {
    label: 'camelCase',
    apply: (text) => words(text).map((word, index) =>
      index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    ).join(''),
  },
  pascal: {
    label: 'PascalCase',
    apply: (text) => words(text).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(''),
  },
  snake: { label: 'snake_case', apply: (text) => words(text).map((word) => word.toLowerCase()).join('_') },
  kebab: { label: 'kebab-case', apply: (text) => words(text).map((word) => word.toLowerCase()).join('-') },
  constant: { label: 'CONSTANT_CASE', apply: (text) => words(text).map((word) => word.toUpperCase()).join('_') },
  reverse: { label: 'Reversed', apply: (text) => [...text].reverse().join('') },
  slug: {
    label: 'url-slug',
    apply: (text) =>
      text
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 200),
  },
};

function transform(text, mode) {
  const value = requireText(text);
  const definition = TRANSFORMS[String(mode || '').toLowerCase()];
  if (!definition) throw new ValidationError(`\`${mode}\` is not a supported text transform.`);
  const output = definition.apply(value);
  return { output: output || '(empty result)', label: definition.label, mode };
}

function count(text) {
  const value = requireText(text);
  const graphemes = [...value];
  const wordList = value.split(/\s+/).filter(Boolean);
  const lines = value.split(/\r\n|\r|\n/);
  const sentences = value.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim().length > 0);

  return {
    characters: graphemes.length,
    charactersNoSpaces: graphemes.filter((char) => !/\s/.test(char)).length,
    bytes: Buffer.byteLength(value, 'utf8'),
    words: wordList.length,
    lines: lines.length,
    sentences: sentences.length,
    uniqueWords: new Set(wordList.map((word) => word.toLowerCase())).size,
    longestWord: wordList.reduce((longest, word) => (word.length > longest.length ? word : longest), ''),
    averageWordLength: wordList.length
      ? Math.round((wordList.reduce((total, word) => total + word.length, 0) / wordList.length) * 100) / 100
      : 0,
  };
}

function requireText(text) {
  const value = String(text ?? '');
  if (!value.trim()) throw new ValidationError('Give the doggy some text to work with.');
  if (value.length > MAX_LENGTH) {
    throw new ValidationError(`That text is too long (${value.length} characters, maximum is ${MAX_LENGTH}).`);
  }
  return value;
}

function listTransforms() {
  return Object.entries(TRANSFORMS).map(([key, value]) => ({ key, label: value.label }));
}

module.exports = { transform, count, listTransforms, TRANSFORMS, MAX_LENGTH };
