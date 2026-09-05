'use strict';

/**
 * Unit registry for `<expression> to <unit>` conversions.
 *
 * Every unit stores a factor relative to the base unit of its dimension.
 * Temperature is the one exception: it is affine, so it carries explicit
 * to/from base functions instead of a plain factor.
 */

const DEFINITIONS = {
  // ── length (base: metre) ────────────────────────────────────────────────
  nm: { dim: 'length', factor: 1e-9, label: 'nanometres' },
  um: { dim: 'length', factor: 1e-6, label: 'micrometres' },
  mm: { dim: 'length', factor: 1e-3, label: 'millimetres' },
  cm: { dim: 'length', factor: 1e-2, label: 'centimetres' },
  m: { dim: 'length', factor: 1, label: 'metres' },
  km: { dim: 'length', factor: 1000, label: 'kilometres' },
  in: { dim: 'length', factor: 0.0254, label: 'inches' },
  ft: { dim: 'length', factor: 0.3048, label: 'feet' },
  yd: { dim: 'length', factor: 0.9144, label: 'yards' },
  mi: { dim: 'length', factor: 1609.344, label: 'miles' },
  nmi: { dim: 'length', factor: 1852, label: 'nautical miles' },
  ly: { dim: 'length', factor: 9.4607304725808e15, label: 'light years' },
  au: { dim: 'length', factor: 1.495978707e11, label: 'astronomical units' },

  // ── mass (base: kilogram) ───────────────────────────────────────────────
  mg: { dim: 'mass', factor: 1e-6, label: 'milligrams' },
  g: { dim: 'mass', factor: 1e-3, label: 'grams' },
  kg: { dim: 'mass', factor: 1, label: 'kilograms' },
  t: { dim: 'mass', factor: 1000, label: 'tonnes' },
  oz: { dim: 'mass', factor: 0.028349523125, label: 'ounces' },
  lb: { dim: 'mass', factor: 0.45359237, label: 'pounds' },
  st: { dim: 'mass', factor: 6.35029318, label: 'stone' },

  // ── time (base: second) ─────────────────────────────────────────────────
  ns: { dim: 'time', factor: 1e-9, label: 'nanoseconds' },
  us: { dim: 'time', factor: 1e-6, label: 'microseconds' },
  ms: { dim: 'time', factor: 1e-3, label: 'milliseconds' },
  s: { dim: 'time', factor: 1, label: 'seconds' },
  min: { dim: 'time', factor: 60, label: 'minutes' },
  h: { dim: 'time', factor: 3600, label: 'hours' },
  d: { dim: 'time', factor: 86400, label: 'days' },
  wk: { dim: 'time', factor: 604800, label: 'weeks' },
  yr: { dim: 'time', factor: 31557600, label: 'julian years' },

  // ── data (base: byte) ───────────────────────────────────────────────────
  bit: { dim: 'data', factor: 1 / 8, label: 'bits' },
  kbit: { dim: 'data', factor: 1000 / 8, label: 'kilobits' },
  Mbit: { dim: 'data', factor: 1e6 / 8, label: 'megabits' },
  Gbit: { dim: 'data', factor: 1e9 / 8, label: 'gigabits' },
  B: { dim: 'data', factor: 1, label: 'bytes' },
  kB: { dim: 'data', factor: 1e3, label: 'kilobytes' },
  MB: { dim: 'data', factor: 1e6, label: 'megabytes' },
  GB: { dim: 'data', factor: 1e9, label: 'gigabytes' },
  TB: { dim: 'data', factor: 1e12, label: 'terabytes' },
  PB: { dim: 'data', factor: 1e15, label: 'petabytes' },
  KiB: { dim: 'data', factor: 1024, label: 'kibibytes' },
  MiB: { dim: 'data', factor: 1024 ** 2, label: 'mebibytes' },
  GiB: { dim: 'data', factor: 1024 ** 3, label: 'gibibytes' },
  TiB: { dim: 'data', factor: 1024 ** 4, label: 'tebibytes' },
  PiB: { dim: 'data', factor: 1024 ** 5, label: 'pebibytes' },

  // ── speed (base: metre / second) ────────────────────────────────────────
  'm/s': { dim: 'speed', factor: 1, label: 'metres per second' },
  'km/h': { dim: 'speed', factor: 1000 / 3600, label: 'kilometres per hour' },
  mph: { dim: 'speed', factor: 1609.344 / 3600, label: 'miles per hour' },
  kn: { dim: 'speed', factor: 1852 / 3600, label: 'knots' },

  // ── area (base: square metre) ───────────────────────────────────────────
  'mm2': { dim: 'area', factor: 1e-6, label: 'square millimetres' },
  'cm2': { dim: 'area', factor: 1e-4, label: 'square centimetres' },
  'm2': { dim: 'area', factor: 1, label: 'square metres' },
  'km2': { dim: 'area', factor: 1e6, label: 'square kilometres' },
  ha: { dim: 'area', factor: 1e4, label: 'hectares' },
  acre: { dim: 'area', factor: 4046.8564224, label: 'acres' },
  'ft2': { dim: 'area', factor: 0.09290304, label: 'square feet' },

  // ── volume (base: litre) ────────────────────────────────────────────────
  ml: { dim: 'volume', factor: 1e-3, label: 'millilitres' },
  l: { dim: 'volume', factor: 1, label: 'litres' },
  'm3': { dim: 'volume', factor: 1000, label: 'cubic metres' },
  gal: { dim: 'volume', factor: 3.785411784, label: 'US gallons' },
  qt: { dim: 'volume', factor: 0.946352946, label: 'US quarts' },
  pt: { dim: 'volume', factor: 0.473176473, label: 'US pints' },
  cup: { dim: 'volume', factor: 0.2365882365, label: 'US cups' },
  floz: { dim: 'volume', factor: 0.0295735295625, label: 'US fluid ounces' },

  // ── angle (base: radian) ────────────────────────────────────────────────
  rad: { dim: 'angle', factor: 1, label: 'radians' },
  deg: { dim: 'angle', factor: Math.PI / 180, label: 'degrees' },
  grad: { dim: 'angle', factor: Math.PI / 200, label: 'gradians' },
  turn: { dim: 'angle', factor: Math.PI * 2, label: 'turns' },

  // ── temperature (base: kelvin, affine) ──────────────────────────────────
  K: { dim: 'temperature', label: 'kelvin', toBase: (v) => v, fromBase: (v) => v },
  C: { dim: 'temperature', label: 'degrees Celsius', toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15 },
  F: {
    dim: 'temperature',
    label: 'degrees Fahrenheit',
    toBase: (v) => ((v - 32) * 5) / 9 + 273.15,
    fromBase: (v) => ((v - 273.15) * 9) / 5 + 32,
  },
};

/** alias (lower case) -> canonical unit key */
const ALIASES = new Map();

function alias(name, key) {
  ALIASES.set(String(name).toLowerCase(), key);
}

// Every canonical name is also an alias of itself.
for (const key of Object.keys(DEFINITIONS)) alias(key, key);

const EXTRA_ALIASES = {
  nm: ['nanometre', 'nanometer', 'nanometres', 'nanometers'],
  um: ['µm', 'μm', 'micrometre', 'micrometer', 'micron', 'microns'],
  mm: ['millimetre', 'millimeter', 'millimetres', 'millimeters'],
  cm: ['centimetre', 'centimeter', 'centimetres', 'centimeters'],
  m: ['metre', 'meter', 'metres', 'meters'],
  km: ['kilometre', 'kilometer', 'kilometres', 'kilometers'],
  in: ['inch', 'inches', '"'],
  ft: ['foot', 'feet'],
  yd: ['yard', 'yards'],
  mi: ['mile', 'miles'],
  nmi: ['nauticalmile', 'nauticalmiles'],
  ly: ['lightyear', 'lightyears'],
  au: ['astronomicalunit', 'astronomicalunits'],

  mg: ['milligram', 'milligrams'],
  g: ['gram', 'grams'],
  kg: ['kilogram', 'kilograms', 'kilo', 'kilos'],
  t: ['tonne', 'tonnes', 'ton', 'tons', 'metricton'],
  oz: ['ounce', 'ounces'],
  lb: ['lbs', 'pound', 'pounds'],
  st: ['stone', 'stones'],

  ns: ['nanosecond', 'nanoseconds'],
  us: ['µs', 'μs', 'microsecond', 'microseconds'],
  ms: ['millisecond', 'milliseconds'],
  s: ['sec', 'secs', 'second', 'seconds'],
  min: ['mins', 'minute', 'minutes'],
  h: ['hr', 'hrs', 'hour', 'hours'],
  d: ['day', 'days'],
  wk: ['week', 'weeks'],
  yr: ['year', 'years'],

  bit: ['bits', 'b'],
  kbit: ['kbits', 'kilobit', 'kilobits'],
  Mbit: ['mbits', 'megabit', 'megabits'],
  Gbit: ['gbits', 'gigabit', 'gigabits'],
  B: ['byte', 'bytes'],
  kB: ['kb', 'kilobyte', 'kilobytes'],
  MB: ['mb', 'megabyte', 'megabytes'],
  GB: ['gb', 'gigabyte', 'gigabytes'],
  TB: ['tb', 'terabyte', 'terabytes'],
  PB: ['pb', 'petabyte', 'petabytes'],
  KiB: ['kib', 'kibibyte', 'kibibytes'],
  MiB: ['mib', 'mebibyte', 'mebibytes'],
  GiB: ['gib', 'gibibyte', 'gibibytes'],
  TiB: ['tib', 'tebibyte', 'tebibytes'],
  PiB: ['pib', 'pebibyte', 'pebibytes'],

  'm/s': ['mps', 'metrespersecond', 'meterspersecond'],
  'km/h': ['kmh', 'kph', 'kilometresperhour', 'kilometersperhour'],
  mph: ['milesperhour'],
  kn: ['knot', 'knots'],

  mm2: ['mm^2', 'squaremillimetre', 'squaremillimetres'],
  cm2: ['cm^2', 'squarecentimetre', 'squarecentimetres'],
  m2: ['m^2', 'sqm', 'squaremetre', 'squaremetres', 'squaremeter', 'squaremeters'],
  km2: ['km^2', 'squarekilometre', 'squarekilometres'],
  ha: ['hectare', 'hectares'],
  acre: ['acres'],
  ft2: ['ft^2', 'sqft', 'squarefoot', 'squarefeet'],

  ml: ['millilitre', 'millilitres', 'milliliter', 'milliliters'],
  l: ['litre', 'litres', 'liter', 'liters'],
  m3: ['m^3', 'cubicmetre', 'cubicmetres'],
  gal: ['gallon', 'gallons'],
  qt: ['quart', 'quarts'],
  pt: ['pint', 'pints'],
  cup: ['cups'],
  floz: ['fluidounce', 'fluidounces'],

  rad: ['radian', 'radians'],
  deg: ['degree', 'degrees', '°'],
  grad: ['gradian', 'gradians', 'gon'],
  turn: ['turns', 'revolution', 'revolutions'],

  K: ['kelvin', 'kelvins'],
  C: ['°c', 'celsius', 'centigrade', 'degreescelsius'],
  F: ['°f', 'fahrenheit', 'degreesfahrenheit'],
};

for (const [key, names] of Object.entries(EXTRA_ALIASES)) {
  for (const name of names) alias(name, key);
}

/**
 * Resolves a user-typed unit name.
 * @returns {{ key: string, unit: object } | null}
 */
function resolveUnit(name) {
  if (!name) return null;
  const raw = String(name).trim();
  if (!raw) return null;

  // Exact match first so `B` (byte) never collapses into `b` (bit).
  if (Object.prototype.hasOwnProperty.call(DEFINITIONS, raw)) {
    return { key: raw, unit: DEFINITIONS[raw] };
  }
  const normalised = raw.toLowerCase().replace(/\s+/g, '');
  const key = ALIASES.get(normalised);
  if (!key) return null;
  return { key, unit: DEFINITIONS[key] };
}

/**
 * Converts a value between two units of the same dimension.
 * @throws {Error} when the dimensions do not match
 */
function convert(value, fromKey, toKey) {
  const from = DEFINITIONS[fromKey];
  const to = DEFINITIONS[toKey];
  if (!from || !to) throw new Error('Unknown unit');
  if (from.dim !== to.dim) {
    const error = new Error(`Cannot convert ${from.label} to ${to.label}.`);
    error.code = 'DIMENSION_MISMATCH';
    throw error;
  }
  const base = from.toBase ? from.toBase(value) : value * from.factor;
  return to.fromBase ? to.fromBase(base) : base / to.factor;
}

/** All unit keys grouped by dimension — used by the `/calc` autocomplete. */
function listUnits() {
  const grouped = {};
  for (const [key, unit] of Object.entries(DEFINITIONS)) {
    (grouped[unit.dim] ||= []).push({ key, label: unit.label });
  }
  return grouped;
}

module.exports = { DEFINITIONS, resolveUnit, convert, listUnits };
