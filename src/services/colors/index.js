'use strict';

const convert = require('./convert');
const contrast = require('./contrast');
const palette = require('./palette');
const image = require('./image');
const names = require('./names');

module.exports = {
  ...convert,
  ...contrast,
  ...palette,
  ...image,
  ...names,
};
