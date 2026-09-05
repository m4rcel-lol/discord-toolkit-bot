'use strict';

const { parseColor, rgbToHex } = require('./convert');

/**
 * WCAG 2.1 contrast maths.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

function channelLuminance(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of an sRGB colour, 0 (black) to 1 (white). */
function relativeLuminance({ r, g, b }) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Contrast ratio between two colours, from 1:1 to 21:1. */
function contrastRatio(a, b) {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

const THRESHOLDS = [
  { id: 'aa-normal', label: 'AA · normal text', minimum: 4.5 },
  { id: 'aa-large', label: 'AA · large text', minimum: 3 },
  { id: 'aaa-normal', label: 'AAA · normal text', minimum: 7 },
  { id: 'aaa-large', label: 'AAA · large text', minimum: 4.5 },
  { id: 'aa-ui', label: 'AA · UI components', minimum: 3 },
];

/**
 * @param {string} foreground
 * @param {string} background
 */
function checkContrast(foreground, background) {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const ratio = contrastRatio(fg, bg);
  const rounded = Math.round(ratio * 100) / 100;

  const results = THRESHOLDS.map((threshold) => ({
    ...threshold,
    passes: ratio >= threshold.minimum,
  }));

  const passingCount = results.filter((result) => result.passes).length;
  const grade =
    ratio >= 7 ? 'Excellent' : ratio >= 4.5 ? 'Good' : ratio >= 3 ? 'Borderline' : 'Poor';

  return {
    foreground: { ...fg, hex: rgbToHex(fg), luminance: Math.round(relativeLuminance(fg) * 10000) / 10000 },
    background: { ...bg, hex: rgbToHex(bg), luminance: Math.round(relativeLuminance(bg) * 10000) / 10000 },
    ratio: rounded,
    ratioText: `${rounded.toFixed(2)}:1`,
    results,
    passingCount,
    grade,
  };
}

module.exports = { relativeLuminance, contrastRatio, checkContrast, THRESHOLDS };
