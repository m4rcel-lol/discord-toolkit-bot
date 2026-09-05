'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const qr = require('../src/services/qr');
const { ValidationError } = require('../src/utils/validation');

test('every QR type round trips through create and decode', async () => {
  const cases = [
    { options: { type: 'text', value: 'hello doggy' }, expected: 'hello doggy' },
    { options: { type: 'url', value: 'https://example.com/path?a=1' }, expected: 'https://example.com/path?a=1' },
    { options: { type: 'url', value: 'example.com' }, expected: 'https://example.com' },
    { options: { type: 'email', value: 'a@b.com', subject: 'Hi' }, expected: 'mailto:a@b.com?subject=Hi' },
    { options: { type: 'phone', value: '+15551234567' }, expected: 'tel:+15551234567' },
    { options: { type: 'sms', value: '+15551234567', body: 'woof' }, expected: 'SMSTO:+15551234567:woof' },
    { options: { type: 'wifi', value: 'DoggyNet', password: 'goodboy', security: 'WPA' }, expected: 'WIFI:T:WPA;S:DoggyNet;P:goodboy;;' },
    { options: { type: 'discord', value: 'https://discord.gg/abcDEF' }, expected: 'https://discord.gg/abcDEF' },
  ];

  for (const { options, expected } of cases) {
    const created = await qr.createQr(options);
    assert.equal(created.payload, expected, `${options.type} payload`);
    assert.equal(created.buffer.subarray(1, 4).toString('ascii'), 'PNG');

    const decoded = await qr.decodeQr(created.buffer);
    assert.equal(decoded.data, expected, `${options.type} round trip`);
  }
});

test('classifies decoded payloads', () => {
  assert.equal(qr.classifyPayload('https://example.com'), 'URL');
  assert.equal(qr.classifyPayload('mailto:a@b.com'), 'Email');
  assert.equal(qr.classifyPayload('WIFI:T:WPA;S:x;P:y;;'), 'Wi-Fi network');
  assert.equal(qr.classifyPayload('BEGIN:VCARD'), 'Contact card');
  assert.equal(qr.classifyPayload('otpauth://totp/x'), 'One-time password secret');
  assert.equal(qr.classifyPayload('just some words'), 'Text');
});

test('every error-correction level produces a scannable code', async () => {
  for (const level of ['L', 'M', 'Q', 'H']) {
    const created = await qr.createQr({ type: 'text', value: 'level test', errorCorrection: level });
    assert.equal(created.meta.errorCorrectionLevel, level);
    assert.equal((await qr.decodeQr(created.buffer)).data, 'level test');
  }
});

test('rejects invalid input', async () => {
  await assert.rejects(() => qr.createQr({ type: 'text', value: '' }), ValidationError);
  await assert.rejects(() => qr.createQr({ type: 'nope', value: 'x' }), ValidationError);
  await assert.rejects(() => qr.createQr({ type: 'email', value: 'not-an-email' }), ValidationError);
  await assert.rejects(() => qr.createQr({ type: 'phone', value: 'abc' }), ValidationError);
  await assert.rejects(() => qr.createQr({ type: 'url', value: 'javascript:alert(1)' }), ValidationError);
  await assert.rejects(() => qr.createQr({ type: 'wifi', value: 'net', security: 'WPA' }), ValidationError);
  await assert.rejects(() => qr.createQr({ type: 'text', value: 'x'.repeat(qr.MAX_PAYLOAD + 1) }), ValidationError);
});

test('decoding rejects non-images and images without a code', async () => {
  await assert.rejects(() => qr.decodeQr(Buffer.alloc(0)), ValidationError);
  await assert.rejects(() => qr.decodeQr(Buffer.from('this is not an image')), ValidationError);

  const Jimp = require('jimp');
  const blank = await (await Jimp.create(200, 200, 0xffffffff)).getBufferAsync(Jimp.MIME_PNG);
  await assert.rejects(() => qr.decodeQr(blank), ValidationError);
});
