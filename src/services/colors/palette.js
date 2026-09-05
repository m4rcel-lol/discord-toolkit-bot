'use strict';

const { parseColor, rgbToHex, rgbToHsl, hslToRgb, clamp } = require('./convert');
const { ValidationError } = require('../../utils/validation');

/** Classic colour-harmony palettes derived from a single base colour. */

const SCHEMES = {
  complementary: {
    label: 'Complementary',
    description: 'The base colour and its opposite on the wheel.',
    build: (hsl) => [hsl, { ...hsl, h: hsl.h + 180 }],
  },
  analogous: {
    label: 'Analogous',
    description: 'Neighbours on the colour wheel — calm and cohesive.',
    build: (hsl) => [-60, -30, 0, 30, 60].map((offset) => ({ ...hsl, h: hsl.h + offset })),
  },
  triadic: {
    label: 'Triadic',
    description: 'Three colours evenly spaced around the wheel.',
    build: (hsl) => [0, 120, 240].map((offset) => ({ ...hsl, h: hsl.h + offset })),
  },
  tetradic: {
    label: 'Tetradic',
    description: 'Two complementary pairs — rich but demanding.',
    build: (hsl) => [0, 90, 180, 270].map((offset) => ({ ...hsl, h: hsl.h + offset })),
  },
  monochromatic: {
    label: 'Monochromatic',
    description: 'One hue at several lightness levels.',
    build: (hsl) => [12, 28, 44, 60, 76, 90].map((lightness) => ({ ...hsl, l: lightness })),
  },
  shades: {
    label: 'Shades',
    description: 'The base colour walked towards black.',
    build: (hsl) => [95, 80, 65, 50, 35, 20].map((lightness) => ({ ...hsl, l: Math.min(lightness, hsl.l + 45) })),
  },
  'split-complementary': {
    label: 'Split complementary',
    description: 'The base colour plus the two neighbours of its opposite.',
    build: (hsl) => [0, 150, 210].map((offset) => ({ ...hsl, h: hsl.h + offset })),
  },
};

/**
 * @param {string} baseColor
 * @param {string} scheme  a key of SCHEMES
 * @returns {{ scheme: string, label: string, description: string, base: string, colors: Array }}
 */
function buildPalette(baseColor, scheme = 'complementary') {
  const key = String(scheme || '').toLowerCase();
  const definition = SCHEMES[key];
  if (!definition) {
    throw new ValidationError(`\`${scheme}\` is not a palette scheme.`, {
      hint: `Available schemes: ${Object.keys(SCHEMES).join(', ')}.`,
    });
  }

  const rgb = parseColor(baseColor);
  const hsl = rgbToHsl(rgb);

  const colors = definition.build(hsl).map((entry) => {
    const normalised = {
      h: ((entry.h % 360) + 360) % 360,
      s: clamp(entry.s, 0, 100),
      l: clamp(entry.l, 0, 100),
    };
    const asRgb = hslToRgb(normalised);
    return {
      hex: rgbToHex(asRgb),
      rgb: asRgb,
      hsl: { h: Math.round(normalised.h * 10) / 10, s: Math.round(normalised.s * 10) / 10, l: Math.round(normalised.l * 10) / 10 },
    };
  });

  return {
    scheme: key,
    label: definition.label,
    description: definition.description,
    base: rgbToHex(rgb),
    colors,
  };
}

function listSchemes() {
  return Object.entries(SCHEMES).map(([key, value]) => ({ key, label: value.label, description: value.description }));
}

module.exports = { buildPalette, listSchemes, SCHEMES };
