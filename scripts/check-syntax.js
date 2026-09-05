#!/usr/bin/env node
'use strict';

/**
 * Parses every JavaScript file in the project without executing it.
 * Cheap insurance against a typo shipping in a rarely-exercised branch.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOTS = ['src', 'worker/src', 'scripts', 'tests'];
const root = path.join(__dirname, '..');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

let failures = 0;
let checked = 0;

for (const dir of ROOTS) {
  for (const file of walk(path.join(root, dir))) {
    checked += 1;
    const source = fs.readFileSync(file, 'utf8');
    try {
      // Compiling only: nothing in the file is run.
      new vm.Script(source, { filename: file });
    } catch (error) {
      failures += 1;
      process.stderr.write(`✖ ${path.relative(root, file)}\n  ${error.message}\n`);
    }
  }
}

process.stdout.write(
  failures === 0
    ? `✔ ${checked} JavaScript files parse cleanly\n`
    : `✖ ${failures} of ${checked} files failed to parse\n`,
);
process.exit(failures === 0 ? 0 : 1);
