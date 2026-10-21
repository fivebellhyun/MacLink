import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../public/browser-compat.js', import.meta.url), 'utf8');
const script = new vm.Script(source, { filename: 'browser-compat.js' });

function browser({ native = false, modernReason = true } = {}) {
  let timerId = 0;
  const timers = new Map(), cleared = [], controllers = [];
  class Signal extends EventTarget {
    aborted = false;
    constructor() { super(); if (modernReason) this.reason = undefined; }
  }
  class Controller {
    signal = new Signal();
    constructor() { controllers.push(this); }
    abort(reason) {
      if (this.signal.aborted) return;
      this.signal.aborted = true;
      if (modernReason) this.signal.reason = reason;
      this.signal.dispatchEvent(new Event('abort'));
    }
  }
  const context = vm.createContext({
    AbortSignal: Signal, AbortController: Controller, DOMException,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
  });
  if (!native) vm.runInContext('delete Object.hasOwn; delete String.prototype.replaceAll;', context);
  const evaluate = expression => vm.runInContext(expression, context);
  const install = () => script.runInContext(context);
  const tick = () => {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    timer.callback();
    return { id, delay: timer.delay };
  };
  return { context, evaluate, install, timers, cleared, controllers, tick, Signal };
}

test('missing helpers break bootstrap before installation and work afterward', () => {
  const b = browser();
  assert.throws(() => b.evaluate("Object.hasOwn({ label: 'MacLink' }, 'label')"), /not a function/);
  assert.throws(() => b.evaluate("'a+b/c'.replaceAll('+', '-')"), /not a function/);
  assert.throws(() => b.evaluate('AbortSignal.timeout(10000)'), /not a function/);
  b.install();
  assert.equal(b.evaluate("Object.hasOwn({ label: 'MacLink' }, 'label')"), true);
  assert.equal(b.evaluate("'a+b/c'.replaceAll('+', '-').replaceAll('/', '_')"), 'a-b_c');
  assert.equal(b.evaluate('AbortSignal.timeout(10000).aborted'), false);
});

test('hasOwn handles prototype-free maps and inherited or special keys', () => {
  const b = browser(); b.install();
  assert.equal(b.evaluate("Object.hasOwn(Object.create(null), 'toString')"), false);
  assert.equal(b.evaluate("Object.hasOwn({ hasOwnProperty: null, ['__proto__']: 1 }, '__proto__')"), true);
  assert.equal(b.evaluate("Object.hasOwn(Object.create({ inherited: true }), 'inherited')"), false);
  assert.equal(b.evaluate("Object.hasOwn('abc', 'length')"), true);
  assert.equal(b.evaluate("(function () { var key = Symbol('key'), o = {}; o[key] = 1; return Object.hasOwn(o, key); })()"), true);
  assert.throws(() => b.evaluate("Object.hasOwn(null, 'x')"), /null|undefined/);
});

test('replaceAll preserves native literal searches, substitutions and empty matches', () => {
  const b = browser(); b.install();
  const samples = [
    ['a+b/c+a+b/c', '+', '-'], ['a.b[a].b', '.b', '$&!'],
    ['.*+?^${}()|[]\\/', '.*+?^${}()|[]\\/', '$$'],
    ['aba', 'a', '$$/$&/$`/$\'/$1/$<name>'],
    ['abc', '', '$$:$&:$`:$\''], ['😀a😀', '', '.'],
    ['aaaa', 'aa', 'x'], ['abc', 'missing', 'x'], ['undefined', undefined, null],
  ];
  for (const [input, search, replacement] of samples) {
    b.context.values = [input, search, replacement];
    assert.equal(b.evaluate('values[0].replaceAll(values[1], values[2])'), input.replaceAll(search, replacement));
  }
  assert.equal(b.evaluate("'ababa'.replaceAll('ba', function (match, offset, text) { return '[' + match + ':' + offset + ':' + text + ']'; })"),
    'ababa'.replaceAll('ba', (match, offset, text) => `[${match}:${offset}:${text}]`));
  assert.equal(b.evaluate("String.prototype.replaceAll.call(123123, 23, '!')"), '1!1!');
  assert.throws(() => b.evaluate("String.prototype.replaceAll.call(null, 'x', 'y')"), /Invalid string receiver/);
});

test('replaceAll requires global regexes and respects custom replacement methods', () => {
  const b = browser(); b.install();
  assert.throws(() => b.evaluate("'aaa'.replaceAll(/a/, 'x')"), /global/);
  assert.equal(b.evaluate("'ab ab'.replaceAll(/(a)(b)/g, '$2$1')"), 'ba ba');
  assert.equal(b.evaluate("'aaa'.replaceAll(/a/g, function (match, offset) { return offset; })"), '012');
  assert.equal(b.evaluate("'hello'.replaceAll({ [Symbol.replace]: function (input, replacement) { return input + replacement; } }, '!')"), 'hello!');
  assert.throws(() => b.evaluate("'hello'.replaceAll({ [Symbol.replace]: true }, '!')"), /Invalid replacement method/);
  assert.throws(() => b.evaluate("'hello'.replaceAll(Symbol('x'), '!')"), /Symbol/);
});

test('native helpers stay untouched and installed methods are non-enumerable', () => {
  const b = browser({ native: true });
  b.Signal.timeout = () => 'native timeout';
  b.evaluate('globalThis.savedHasOwn = Object.hasOwn; globalThis.savedReplaceAll = String.prototype.replaceAll; globalThis.savedTimeout = AbortSignal.timeout;');
  b.install();
  assert.equal(b.evaluate('savedHasOwn === Object.hasOwn && savedReplaceAll === String.prototype.replaceAll && savedTimeout === AbortSignal.timeout'), true);
  const old = browser(); old.install();
  assert.equal(old.evaluate("[Object, String.prototype, AbortSignal].every(function (target, index) { var d = Object.getOwnPropertyDescriptor(target, ['hasOwn', 'replaceAll', 'timeout'][index]); return !d.enumerable && d.writable && d.configurable; })"), true);
});

test('timeout aborts only at its deadline and clears the timer', () => {
  const b = browser(); b.install();
  const signal = b.evaluate('AbortSignal.timeout(10000)');
  assert.equal(signal.aborted, false);
  assert.equal(b.timers.size, 1);
  assert.equal(b.tick().delay, 10000);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, 'TimeoutError');
  assert.equal(b.timers.size, 0);
  assert.equal(b.cleared.length, 1);
});

test('older abort signals receive a timeout reason and early abort clears pending work', () => {
  const b = browser({ modernReason: false }); b.install();
  const signal = b.evaluate('AbortSignal.timeout(0)');
  assert.equal(signal.aborted, false);
  assert.equal(b.tick().delay, 0);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, 'TimeoutError');
  b.evaluate('AbortSignal.timeout(10000)');
  b.controllers.at(-1).abort();
  assert.equal(b.timers.size, 0);
});

test('long finite timeouts retain their deadline instead of overflowing browser timers', () => {
  const b = browser(); b.install();
  const signal = b.evaluate('AbortSignal.timeout(2147483647 + 10000)');
  assert.equal(b.tick().delay, 2147483647);
  assert.equal(signal.aborted, false);
  assert.equal(b.tick().delay, 10000);
  assert.equal(signal.aborted, true);
  for (const value of ['-1', 'Infinity', 'NaN', '9007199254740992']) {
    assert.throws(() => b.evaluate(`AbortSignal.timeout(${value})`), /Timeout|timeout/);
  }
});

test('compatibility boot script uses ES5 syntax and blocks before application hydration', () => {
  const ast = ts.createSourceFile('browser-compat.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const forbidden = [];
  function visit(node) {
    if (ts.isArrowFunction(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) ||
        ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isAwaitExpression(node) || ts.isSpreadElement(node) || ts.isSpreadAssignment(node) ||
        ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.BlockScoped ||
        node.questionDotToken) forbidden.push(ts.SyntaxKind[node.kind]);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(forbidden, []);
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<head>\s*<script\s+src="\/browser-compat\.js"\s*\/>\s*<\/head>\s*<body>/);
});
