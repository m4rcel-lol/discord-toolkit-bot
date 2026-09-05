'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const colors = require('../src/services/colors');
const { ValidationError } = require('../src/utils/validation');

test('parses every supported notation to the same colour', () => {
  const expected = { r: 255, g: 102, b: 0 };
  for (const input of ['#FF6600', 'ff6600', '#F60', 'rgb(255, 102, 0)', 'rgb(255 102 0)', '255,102,0', 'hsl(24, 100%, 50%)', 'hsv(24, 100%, 100%)', 'cmyk(0, 60, 100, 0)']) {
    const { rgb } = colors.describeColor(input);
    assert.deepEqual({ r: rgb.r, g: rgb.g, b: rgb.b }, expected, `${input} should parse to #FF6600`);
  }
});

test('converts #FF6600 exactly as documented', () => {
  const result = colors.describeColor('#FF6600');
  assert.equal(result.hex, '#FF6600');
  assert.deepEqual(result.hsl, { h: 24, s: 100, l: 50 });
  assert.deepEqual(result.hsv, { h: 24, s: 100, v: 100 });
  assert.deepEqual(result.cmyk, { c: 0, m: 60, y: 100, k: 0 });
  assert.equal(result.int, 0xff6600);
});

test('named CSS colours and alpha', () => {
  assert.equal(colors.describeColor('tomato').hex, '#FF6347');
  assert.equal(colors.describeColor('rebeccapurple').hex, '#663399');
  assert.equal(colors.describeColor('red').name, 'red');
  assert.equal(colors.describeColor('#FF660080').rgb.a, 0.502);
});

test('round trips through every colour space', () => {
  for (const hex of ['#000000', '#FFFFFF', '#FF6600', '#123456', '#7F7F7F', '#00FF00']) {
    const described = colors.describeColor(hex);
    assert.equal(colors.rgbToHex(colors.hslToRgb(described.hsl)), hex, `HSL round trip for ${hex}`);
    assert.equal(colors.rgbToHex(colors.hsvToRgb(described.hsv)), hex, `HSV round trip for ${hex}`);
    assert.equal(colors.rgbToHex(colors.cmykToRgb(described.cmyk)), hex, `CMYK round trip for ${hex}`);
  }
});

test('WCAG contrast ratios match the specification', () => {
  assert.equal(colors.checkContrast('#000000', '#FFFFFF').ratio, 21);
  assert.equal(colors.checkContrast('#FFFFFF', '#FFFFFF').ratio, 1);
  assert.equal(colors.checkContrast('#FFFFFF', '#FF6600').ratio, 2.94);

  const good = colors.checkContrast('#000000', '#FFFFFF');
  assert.ok(good.results.every((result) => result.passes), 'black on white passes everything');

  const bad = colors.checkContrast('#FFFFFF', '#FF6600');
  assert.equal(bad.results.find((result) => result.id === 'aa-normal').passes, false);
  assert.equal(bad.grade, 'Poor');
});

test('palettes are the right size and start from the base colour', () => {
  const expectations = {
    complementary: 2,
    analogous: 5,
    triadic: 3,
    tetradic: 4,
    monochromatic: 6,
    'split-complementary': 3,
  };
  for (const [scheme, count] of Object.entries(expectations)) {
    const palette = colors.buildPalette('#FF6600', scheme);
    assert.equal(palette.colors.length, count, `${scheme} should have ${count} colours`);
    assert.equal(palette.base, '#FF6600');
    for (const color of palette.colors) assert.match(color.hex, /^#[0-9A-F]{6}$/);
  }
  assert.equal(colors.buildPalette('#FF6600', 'triadic').colors.map((c) => c.hex).join(), '#FF6600,#00FF66,#6600FF');
});

test('rejects nonsense instead of guessing', () => {
  for (const input of ['', '   ', 'not-a-colour', '#GGGGGG', 'rgb(1,2)', 'hsl(a,b,c)', 'x'.repeat(200)]) {
    assert.throws(() => colors.describeColor(input), ValidationError, `${JSON.stringify(input)} should be rejected`);
  }
  assert.throws(() => colors.buildPalette('#FF6600', 'nonsense'), ValidationError);
});

test('renders real PNG images', async () => {
  const palette = colors.buildPalette('#FF6600', 'analogous');
  const png = await colors.renderPalette(palette.colors, { title: 'test' });
  assert.ok(Buffer.isBuffer(png) && png.length > 1000);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'palette output is a PNG');

  const swatch = await colors.renderSwatch({ hex: '#FF6600' });
  assert.equal(swatch.subarray(1, 4).toString('ascii'), 'PNG');

  const preview = await colors.renderContrastPreview(colors.parseColor('#FFF'), colors.parseColor('#FF6600'));
  assert.equal(preview.subarray(1, 4).toString('ascii'), 'PNG');
});
