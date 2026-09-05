'use strict';

const Jimp = require('jimp');
const { parseColor } = require('./convert');
const { relativeLuminance } = require('./contrast');

/**
 * Renders palette / swatch PNGs with Jimp (pure JS, so there is no native
 * build step and nothing to compile inside the container).
 */

const SWATCH_WIDTH = 180;
const SWATCH_HEIGHT = 220;
const LABEL_HEIGHT = 54;
const PADDING = 16;

let fontPromise = null;
let smallFontPromise = null;

function loadFonts() {
  fontPromise ||= Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  smallFontPromise ||= Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
  return Promise.all([fontPromise, smallFontPromise]);
}

function toJimpColor({ r, g, b }, alpha = 255) {
  return Jimp.rgbaToInt(r, g, b, alpha);
}

/**
 * @param {Array<{ hex: string, rgb?: object }>} colors
 * @param {object} [options]
 * @param {string} [options.title]
 * @returns {Promise<Buffer>} PNG data
 */
async function renderPalette(colors, { title } = {}) {
  const entries = colors.slice(0, 8).map((color) => {
    const rgb = color.rgb || parseColor(color.hex);
    return { hex: color.hex.toUpperCase(), rgb };
  });
  if (!entries.length) throw new Error('renderPalette needs at least one colour');

  const titleHeight = title ? 44 : 0;
  const width = PADDING * 2 + entries.length * SWATCH_WIDTH + (entries.length - 1) * PADDING;
  const height = PADDING * 2 + titleHeight + SWATCH_HEIGHT;

  const [whiteFont, blackFont] = await loadFonts();
  const image = await Jimp.create(width, height, Jimp.rgbaToInt(24, 25, 28, 255));

  if (title) {
    image.print(whiteFont, PADDING, PADDING + 6, title, width - PADDING * 2);
  }

  for (let index = 0; index < entries.length; index += 1) {
    const { hex, rgb } = entries[index];
    const x = PADDING + index * (SWATCH_WIDTH + PADDING);
    const y = PADDING + titleHeight;

    const swatch = await Jimp.create(SWATCH_WIDTH, SWATCH_HEIGHT - LABEL_HEIGHT, toJimpColor(rgb));
    image.composite(swatch, x, y);

    // Label strip: white text on dark colours, dark text on light ones.
    const label = await Jimp.create(SWATCH_WIDTH, LABEL_HEIGHT, Jimp.rgbaToInt(32, 34, 38, 255));
    image.composite(label, x, y + SWATCH_HEIGHT - LABEL_HEIGHT);
    image.print(
      whiteFont,
      x,
      y + SWATCH_HEIGHT - LABEL_HEIGHT + 14,
      { text: hex, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
      SWATCH_WIDTH,
    );

    // A tiny readability hint drawn inside the swatch itself.
    const isLight = relativeLuminance(rgb) > 0.45;
    image.print(
      isLight ? blackFont : whiteFont,
      x,
      y + 12,
      { text: `rgb ${rgb.r} ${rgb.g} ${rgb.b}`, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER },
      SWATCH_WIDTH,
    );
  }

  return image.getBufferAsync(Jimp.MIME_PNG);
}

/** A single large swatch, used by `/color convert`. */
async function renderSwatch(color, { size = 256 } = {}) {
  const rgb = color.rgb || parseColor(color.hex || color);
  const image = await Jimp.create(size, size, toJimpColor(rgb));
  return image.getBufferAsync(Jimp.MIME_PNG);
}

/** Foreground-on-background preview for `/color contrast`. */
async function renderContrastPreview(foreground, background) {
  const width = 520;
  const height = 200;
  const image = await Jimp.create(width, height, toJimpColor(background));

  // Jimp only ships black and white bitmap fonts, so the sample text uses
  // whichever is closer to the requested foreground, and an exact-colour bar
  // underneath shows the real foreground value.
  const fgFont = await Jimp.loadFont(
    relativeLuminance(foreground) > 0.45 ? Jimp.FONT_SANS_32_WHITE : Jimp.FONT_SANS_32_BLACK,
  );

  const bar = await Jimp.create(width - 60, 12, toJimpColor(foreground));
  image.composite(bar, 30, height - 46);

  image.print(fgFont, 30, 44, { text: 'The quick brown fox', alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT }, width - 60);
  image.print(fgFont, 30, 88, { text: 'jumps over the dog', alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT }, width - 60);

  return image.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { renderPalette, renderSwatch, renderContrastPreview };
