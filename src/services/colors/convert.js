'use strict';

const { nameToHex, hexToName } = require('./names');
const { ValidationError } = require('../../utils/validation');

/**
 * Colour parsing and colour-space conversion.
 *
 * Internally everything is normalised to `{ r, g, b, a }` with 0-255 channels
 * and a 0-1 alpha; every other representation is derived from that.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// ── conversions ───────────────────────────────────────────────────────────

function rgbToHex({ r, g, b, a = 1 }, { includeAlpha = false } = {}) {
  const hex = [r, g, b].map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('');
  if (includeAlpha && a < 1) {
    return `#${hex}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0')}`.toUpperCase();
  }
  return `#${hex}`.toUpperCase();
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: round(h, 1), s: round(s * 100, 1), l: round(l * 100, 1) };
}

function hslToRgb({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  const [r1, g1, b1] =
    hue < 60 ? [c, x, 0] :
    hue < 120 ? [x, c, 0] :
    hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] :
    hue < 300 ? [x, 0, c] : [c, 0, x];

  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

function rgbToHsv({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return { h: round(h, 1), s: round(s * 100, 1), v: round(max * 100, 1) };
}

function hsvToRgb({ h, s, v }) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;

  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  const [r1, g1, b1] =
    hue < 60 ? [c, x, 0] :
    hue < 120 ? [x, c, 0] :
    hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] :
    hue < 300 ? [x, 0, c] : [c, 0, x];

  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

function rgbToCmyk({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: round(((1 - rn - k) / (1 - k)) * 100, 1),
    m: round(((1 - gn - k) / (1 - k)) * 100, 1),
    y: round(((1 - bn - k) / (1 - k)) * 100, 1),
    k: round(k * 100, 1),
  };
}

function cmykToRgb({ c, m, y, k }) {
  const cn = clamp(c, 0, 100) / 100;
  const mn = clamp(m, 0, 100) / 100;
  const yn = clamp(y, 0, 100) / 100;
  const kn = clamp(k, 0, 100) / 100;
  return {
    r: Math.round(255 * (1 - cn) * (1 - kn)),
    g: Math.round(255 * (1 - mn) * (1 - kn)),
    b: Math.round(255 * (1 - yn) * (1 - kn)),
  };
}

// ── parsing ───────────────────────────────────────────────────────────────

const HEX_RE = /^#?([0-9a-f]{3,8})$/i;

function parseHex(text) {
  const match = HEX_RE.exec(text.trim());
  if (!match) return null;
  const hex = match[1];
  if (![3, 4, 6, 8].includes(hex.length)) return null;
  const expand = (chars) => chars.split('').map((char) => char + char).join('');
  const full = hex.length <= 4 ? expand(hex) : hex;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? round(Number.parseInt(full.slice(6, 8), 16) / 255, 3) : 1,
  };
}

/** Pulls the numbers out of `rgb(1, 2, 3 / 0.5)` and friends. */
function parseComponents(body) {
  return body
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function numberOf(token, { percentBase = 1 } = {}) {
  if (token.endsWith('%')) {
    const value = Number.parseFloat(token.slice(0, -1));
    if (!Number.isFinite(value)) return NaN;
    return (value / 100) * percentBase;
  }
  if (token.endsWith('deg')) return Number.parseFloat(token.slice(0, -3));
  return Number.parseFloat(token);
}

const FUNCTIONAL_RE = /^([a-z]+)\s*\(([^)]*)\)$/i;

/**
 * Parses any supported colour notation.
 * @param {string} input
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function parseColor(input) {
  const text = String(input ?? '').trim();
  if (!text) throw new ValidationError('Give the doggy a colour to look at.');
  if (text.length > 100) throw new ValidationError('That colour value is too long.');

  const named = nameToHex(text);
  if (named) return parseHex(named);

  const hex = parseHex(text);
  if (hex) return hex;

  const functional = FUNCTIONAL_RE.exec(text);
  if (functional) {
    const fn = functional[1].toLowerCase();
    const parts = parseComponents(functional[2]);

    if ((fn === 'rgb' || fn === 'rgba') && parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3).map((part) => numberOf(part, { percentBase: 255 }));
      const a = parts[3] !== undefined ? numberOf(parts[3]) : 1;
      if ([r, g, b, a].some((value) => !Number.isFinite(value))) {
        throw new ValidationError('That `rgb()` value has a component the doggy could not read.');
      }
      return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255), a: clamp(a, 0, 1) };
    }

    if ((fn === 'hsl' || fn === 'hsla') && parts.length >= 3) {
      const h = numberOf(parts[0]);
      const s = numberOf(parts[1], { percentBase: 100 });
      const l = numberOf(parts[2], { percentBase: 100 });
      const a = parts[3] !== undefined ? numberOf(parts[3]) : 1;
      if ([h, s, l, a].some((value) => !Number.isFinite(value))) {
        throw new ValidationError('That `hsl()` value has a component the doggy could not read.');
      }
      return { ...hslToRgb({ h, s, l }), a: clamp(a, 0, 1) };
    }

    if ((fn === 'hsv' || fn === 'hsb') && parts.length >= 3) {
      const h = numberOf(parts[0]);
      const s = numberOf(parts[1], { percentBase: 100 });
      const v = numberOf(parts[2], { percentBase: 100 });
      if ([h, s, v].some((value) => !Number.isFinite(value))) {
        throw new ValidationError('That `hsv()` value has a component the doggy could not read.');
      }
      return { ...hsvToRgb({ h, s, v }), a: 1 };
    }

    if (fn === 'cmyk' && parts.length >= 4) {
      const [c, m, y, k] = parts.slice(0, 4).map((part) => numberOf(part, { percentBase: 100 }));
      if ([c, m, y, k].some((value) => !Number.isFinite(value))) {
        throw new ValidationError('That `cmyk()` value has a component the doggy could not read.');
      }
      return { ...cmykToRgb({ c, m, y, k }), a: 1 };
    }
  }

  // Bare "255 102 0" / "255,102,0" is a common thing to paste around.
  const bare = parseComponents(text);
  if (bare.length === 3 && bare.every((part) => /^\d+(\.\d+)?$/.test(part))) {
    const [r, g, b] = bare.map(Number);
    if ([r, g, b].every((value) => value >= 0 && value <= 255)) {
      return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: 1 };
    }
  }

  throw new ValidationError(`\`${text.slice(0, 40)}\` is not a colour the doggy recognises.`, {
    hint: 'Try `#FF6600`, `rgb(255, 102, 0)`, `hsl(24, 100%, 50%)`, `cmyk(0,60,100,0)` or a CSS name like `tomato`.',
  });
}

/** Full description of a colour in every supported space. */
function describeColor(input) {
  const rgb = parseColor(input);
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const cmyk = rgbToCmyk(rgb);
  const hex = rgbToHex(rgb);

  return {
    rgb,
    hex,
    hexAlpha: rgbToHex(rgb, { includeAlpha: true }),
    hsl,
    hsv,
    cmyk,
    name: hexToName(hex),
    int: (rgb.r << 16) + (rgb.g << 8) + rgb.b,
    css: {
      hex,
      rgb: rgb.a < 1 ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rgb.a})` : `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      hsl: rgb.a < 1
        ? `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${rgb.a})`
        : `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      hsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
      cmyk: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
    },
  };
}

module.exports = {
  parseColor,
  describeColor,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  rgbToCmyk,
  cmykToRgb,
  clamp,
  round,
};
