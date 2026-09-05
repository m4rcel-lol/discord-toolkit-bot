'use strict';

const { EMOJI } = require('./embeds');

/**
 * The toolkit's table of contents. `/toolkit` renders it, the select menu
 * navigates it, and the README quotes it — one definition, three consumers.
 */
const CATEGORIES = [
  {
    id: 'developer',
    emoji: EMOJI.developer,
    name: 'Developer',
    blurb: 'Run Luau, inspect JSON, hashes, encoding and more.',
    commands: [
      { name: '/luau run', description: 'Execute a Luau program in an isolated sandbox.' },
      { name: '/luau compile', description: 'Syntax- and type-check Luau without running it.' },
      { name: '/luau limits', description: 'Show the sandbox limits and worker status.' },
      { name: '/json format', description: 'Pretty-print JSON, optionally sorting keys.' },
      { name: '/json minify', description: 'Strip whitespace and report the saving.' },
      { name: '/json validate', description: 'Check JSON and pinpoint the first error.' },
      { name: '/json diff', description: 'Compare two JSON documents structurally.' },
      { name: '/hash', description: 'SHA-256, SHA-512, SHA-1, MD5 and friends.' },
      { name: '/base64 encode', description: 'Encode text to Base64 or Base64URL.' },
      { name: '/base64 decode', description: 'Decode Base64 back to text.' },
    ],
  },
  {
    id: 'calculator',
    emoji: EMOJI.calculator,
    name: 'Calculator',
    blurb: 'Calculate expressions and conversions.',
    commands: [
      { name: '/calc', description: 'Arithmetic, powers, roots, trigonometry and logs.' },
      { name: '/calc', description: 'Unit conversion — `1 GiB to bytes`, `20 C to F`.' },
      { name: '/calc', description: 'Number bases — `255 to binary`, `0xFF to decimal`.' },
    ],
  },
  {
    id: 'colors',
    emoji: EMOJI.colors,
    name: 'Colors',
    blurb: 'Convert colors, check contrast and generate palettes.',
    commands: [
      { name: '/color convert', description: 'HEX, RGB, HSL, HSV and CMYK in one embed.' },
      { name: '/color contrast', description: 'WCAG contrast ratio with AA / AAA verdicts.' },
      { name: '/color palette', description: 'Complementary, analogous, triadic and more.' },
    ],
  },
  {
    id: 'qr',
    emoji: EMOJI.qr,
    name: 'QR',
    blurb: 'Generate and decode QR codes.',
    commands: [
      { name: '/qr create', description: 'URLs, text, email, phone, Wi-Fi, invites, contacts.' },
      { name: '/qr decode', description: 'Read a QR code out of an uploaded image.' },
    ],
  },
  {
    id: 'wikipedia',
    emoji: EMOJI.wiki,
    name: 'Wikipedia',
    blurb: 'Search Wikipedia and retrieve article summaries.',
    commands: [
      { name: '/wiki search', description: 'Full-text search in any language edition.' },
      { name: '/wiki article', description: 'Summary, thumbnail and link for one article.' },
      { name: '/wiki random', description: 'A random article, for when you are bored.' },
    ],
  },
  {
    id: 'utilities',
    emoji: EMOJI.utilities,
    name: 'Utilities',
    blurb: 'Timestamps, UUIDs, text tools and other helpers.',
    commands: [
      { name: '/timestamp now', description: 'Every Discord timestamp style for right now.' },
      { name: '/timestamp at', description: 'Build a timestamp from a date or unix value.' },
      { name: '/uuid', description: 'Cryptographically random UUIDs (v4 or v7).' },
      { name: '/text transform', description: 'camelCase, snake_case, slugs and more.' },
      { name: '/text count', description: 'Characters, words, lines and byte length.' },
    ],
  },
];

function findCategory(id) {
  return CATEGORIES.find((category) => category.id === id) || null;
}

module.exports = { CATEGORIES, findCategory };
