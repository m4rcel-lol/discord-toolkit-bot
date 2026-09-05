'use strict';

/**
 * Lua-level hardening injected ahead of user code.
 *
 * This is defence in depth, NOT the security boundary — the real boundary is
 * the container (non-root user, read-only root filesystem, no network, dropped
 * capabilities, pid/memory/CPU limits) plus the deliberately minimal process
 * environment in `executor.js`, which carries none of the worker's secrets.
 *
 * Two details matter here:
 *
 *  1. The Luau CLI sandboxes each script onto its own globals table that
 *     inherits from a *readonly* parent. Assigning `nil` to a global therefore
 *     does NOT hide it — it removes the child's key and the readonly parent's
 *     value shows through again. Every shadow below is consequently a non-nil
 *     value that raises a clear error when touched.
 *
 *  2. It MUST stay on exactly one line, so error line numbers only need a
 *     fixed offset of 1 to map back to the user's source. It is wrapped in a
 *     pcall so a Luau build that behaves differently simply skips it rather
 *     than failing before the user's code ever runs.
 */
const PRELUDE_LINE = [
  'do pcall(function()',
  ' local function blocked(name) return function() error(name .. " is not available in this sandbox", 2) end end',
  ' local _o = os; if type(_o) == "table" then os = { time = _o.time, clock = _o.clock, date = _o.date, difftime = _o.difftime } end',
  ' local _d = debug; if type(_d) == "table" then debug = { traceback = _d.traceback, info = _d.info } end',
  ' io = blocked("io") require = blocked("require") loadstring = blocked("loadstring") load = blocked("load")',
  ' dofile = blocked("dofile") loadfile = blocked("loadfile") getfenv = blocked("getfenv") setfenv = blocked("setfenv")',
  ' newproxy = blocked("newproxy")',
  'end) end',
].join('');

/** Number of lines the prelude adds ahead of the user's first line. */
const PRELUDE_LINE_COUNT = 1;

module.exports = { PRELUDE_LINE, PRELUDE_LINE_COUNT };
