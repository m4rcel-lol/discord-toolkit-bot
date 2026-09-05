'use strict';

const QRCode = require('qrcode');
const jsQR = require('jsqr');
const Jimp = require('jimp');
const { ValidationError, requireHttpUrl } = require('../../utils/validation');

/**
 * QR generation (via `qrcode`) and decoding (via `jsqr` on a Jimp bitmap).
 * Nothing here ever follows or resolves a decoded URL — the payload is only
 * ever shown back to the user as text.
 */

const MAX_PAYLOAD = 2000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 4096 * 4096;

/** Escapes the reserved characters in a Wi-Fi / MeCard style payload. */
function escapeField(value) {
  return String(value ?? '').replace(/([\;,:"])/g, '\\$1');
}

/**
 * Payload builders per QR "type". Each returns the exact string encoded into
 * the QR symbol, plus a human readable description of what it does.
 */
const TYPES = {
  text: {
    label: 'Plain text',
    build: (options) => {
      const value = String(options.value ?? '').trim();
      if (!value) throw new ValidationError('Give the doggy some text to encode.');
      return { payload: value, summary: 'Plain text' };
    },
  },
  url: {
    label: 'URL',
    build: (options) => {
      const raw = String(options.value ?? '').trim();
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
      const url = requireHttpUrl(withScheme, 'value');
      // Encode exactly what the user typed (plus a scheme when it was missing)
      // rather than the URL object's normalised form.
      return { payload: withScheme, summary: `Opens ${url.hostname}` };
    },
  },
  email: {
    build: (options) => {
      const address = String(options.value ?? '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        throw new ValidationError('That does not look like an email address.');
      }
      const params = new URLSearchParams();
      if (options.subject) params.set('subject', options.subject);
      if (options.body) params.set('body', options.body);
      const query = params.toString();
      return { payload: `mailto:${address}${query ? `?${query}` : ''}`, summary: `Composes an email to ${address}` };
    },
    label: 'Email',
  },
  phone: {
    label: 'Telephone',
    build: (options) => {
      const number = String(options.value ?? '').replace(/[^\d+]/g, '');
      if (!/^\+?\d{4,20}$/.test(number)) throw new ValidationError('That does not look like a phone number.');
      return { payload: `tel:${number}`, summary: `Dials ${number}` };
    },
  },
  sms: {
    label: 'SMS',
    build: (options) => {
      const number = String(options.value ?? '').replace(/[^\d+]/g, '');
      if (!/^\+?\d{4,20}$/.test(number)) throw new ValidationError('That does not look like a phone number.');
      const message = options.body ? `:${String(options.body).replace(/[\r\n]+/g, ' ')}` : '';
      return { payload: `SMSTO:${number}${message}`, summary: `Texts ${number}` };
    },
  },
  wifi: {
    label: 'Wi-Fi network',
    build: (options) => {
      const ssid = String(options.value ?? '').trim();
      if (!ssid) throw new ValidationError('A Wi-Fi QR code needs the network name (SSID).');
      const security = (options.security || (options.password ? 'WPA' : 'nopass')).toUpperCase();
      if (!['WPA', 'WEP', 'NOPASS'].includes(security)) {
        throw new ValidationError('Wi-Fi security must be `WPA`, `WEP` or `nopass`.');
      }
      const parts = [`T:${security === 'NOPASS' ? 'nopass' : security}`, `S:${escapeField(ssid)}`];
      if (security !== 'NOPASS') {
        if (!options.password) throw new ValidationError('That security type needs a password.');
        parts.push(`P:${escapeField(options.password)}`);
      }
      if (options.hidden) parts.push('H:true');
      return { payload: `WIFI:${parts.join(';')};;`, summary: `Joins the “${ssid}” network` };
    },
  },
  discord: {
    label: 'Discord invite',
    build: (options) => {
      const raw = String(options.value ?? '').trim();
      const code = raw.replace(/^https?:\/\/(discord\.gg|discord\.com\/invite)\//i, '').replace(/^\/+/, '');
      if (!/^[a-zA-Z0-9-]{2,64}$/.test(code)) {
        throw new ValidationError('That does not look like a Discord invite code or link.');
      }
      return { payload: `https://discord.gg/${code}`, summary: `Opens the discord.gg/${code} invite` };
    },
  },
  vcard: {
    label: 'Contact card',
    build: (options) => {
      const name = String(options.value ?? '').trim();
      if (!name) throw new ValidationError('A contact card needs a name.');
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeField(name)}`];
      if (options.phone) lines.push(`TEL:${escapeField(options.phone)}`);
      if (options.email) lines.push(`EMAIL:${escapeField(options.email)}`);
      if (options.url) lines.push(`URL:${escapeField(options.url)}`);
      lines.push('END:VCARD');
      return { payload: lines.join('\n'), summary: `Contact card for ${name}` };
    },
  },
};

const ERROR_LEVELS = ['L', 'M', 'Q', 'H'];

/**
 * @param {object} options
 * @param {string} options.type            key of TYPES
 * @param {string} options.value           the primary value for that type
 * @param {string} [options.errorCorrection]
 * @param {string} [options.dark] / [options.light] hex colours
 * @returns {Promise<{ buffer: Buffer, payload: string, summary: string, meta: object }>}
 */
async function createQr(options = {}) {
  const typeKey = String(options.type || 'text').toLowerCase();
  const type = TYPES[typeKey];
  if (!type) throw new ValidationError(`\`${options.type}\` is not a supported QR type.`);

  const { payload, summary } = type.build(options);
  if (payload.length > MAX_PAYLOAD) {
    throw new ValidationError(`That payload is too long for a QR code (${payload.length}/${MAX_PAYLOAD} characters).`);
  }

  const errorCorrectionLevel = ERROR_LEVELS.includes(String(options.errorCorrection || 'M').toUpperCase())
    ? String(options.errorCorrection || 'M').toUpperCase()
    : 'M';

  let buffer;
  try {
    buffer = await QRCode.toBuffer(payload, {
      errorCorrectionLevel,
      type: 'png',
      margin: 2,
      scale: 10,
      color: {
        dark: options.dark || '#101114FF',
        light: options.light || '#FFFFFFFF',
      },
    });
  } catch (error) {
    // The library throws when the payload cannot fit in any QR version.
    throw new ValidationError('That content does not fit into a QR code — try something shorter.', {
      hint: error.message,
    });
  }

  return {
    buffer,
    payload,
    summary,
    meta: {
      type: typeKey,
      typeLabel: type.label,
      errorCorrectionLevel,
      payloadLength: payload.length,
      bytes: buffer.length,
    },
  };
}

/**
 * Decodes a QR code from raw image bytes.
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ data: string, kind: string, location: object|null }>}
 */
async function decodeQr(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new ValidationError('That attachment did not contain any image data.');
  }
  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new ValidationError('That image is too large to scan (limit is 8 MiB).');
  }

  let image;
  try {
    image = await Jimp.read(imageBuffer);
  } catch {
    throw new ValidationError('The doggy could not open that image.', {
      hint: 'PNG, JPEG, BMP, TIFF and GIF are supported.',
    });
  }

  if (image.bitmap.width * image.bitmap.height > MAX_IMAGE_PIXELS) {
    throw new ValidationError('That image has too many pixels to scan.');
  }

  // Try the image as-is, then progressively larger/greyscaled variants —
  // photographs of screens often only decode after normalisation.
  const attempts = [
    (img) => img,
    (img) => img.clone().greyscale().contrast(0.3),
    (img) => img.clone().greyscale().normalize(),
    (img) => {
      const clone = img.clone().greyscale().normalize();
      const scale = Math.min(4, Math.max(1, Math.floor(800 / Math.max(1, Math.min(clone.bitmap.width, clone.bitmap.height)))));
      return scale > 1 ? clone.scale(scale, Jimp.RESIZE_NEAREST_NEIGHBOR) : clone;
    },
  ];

  for (const transform of attempts) {
    const candidate = transform(image);
    const { data, width, height } = candidate.bitmap;
    const result = jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: 'attemptBoth' });
    if (result && result.data) {
      return {
        data: result.data,
        kind: classifyPayload(result.data),
        location: result.location || null,
        dimensions: { width: image.bitmap.width, height: image.bitmap.height },
      };
    }
  }

  throw new ValidationError('No QR code was found in that image.', {
    hint: 'Try a sharper, straight-on crop where the whole code is visible.',
  });
}

/** Best-effort description of what a decoded payload represents. */
function classifyPayload(data) {
  const text = String(data);
  if (/^https?:\/\//i.test(text)) return 'URL';
  if (/^mailto:/i.test(text)) return 'Email';
  if (/^tel:/i.test(text)) return 'Telephone';
  if (/^smsto:/i.test(text)) return 'SMS';
  if (/^wifi:/i.test(text)) return 'Wi-Fi network';
  if (/^begin:vcard/i.test(text)) return 'Contact card';
  if (/^begin:vevent/i.test(text)) return 'Calendar event';
  if (/^geo:/i.test(text)) return 'Geo location';
  if (/^otpauth:/i.test(text)) return 'One-time password secret';
  if (/^bitcoin:|^ethereum:/i.test(text)) return 'Cryptocurrency address';
  return 'Text';
}

function listTypes() {
  return Object.entries(TYPES).map(([key, value]) => ({ key, label: value.label }));
}

module.exports = { createQr, decodeQr, listTypes, classifyPayload, TYPES, MAX_PAYLOAD };
