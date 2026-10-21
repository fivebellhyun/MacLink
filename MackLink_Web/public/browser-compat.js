// Run before application modules: older TV WebViews can provide WebRTC while
// missing these newer language and timeout helpers. Keep this file ES5 syntax.
(function (global) {
  'use strict';

  function install(target, name, value) {
    Object.defineProperty(target, name, {
      value: value,
      writable: true,
      configurable: true
    });
  }

  if (typeof Object.hasOwn !== 'function') {
    install(Object, 'hasOwn', function hasOwn(object, property) {
      return Object.prototype.hasOwnProperty.call(object, property);
    });
  }

  if (typeof String.prototype.replaceAll !== 'function') {
    install(String.prototype, 'replaceAll', function replaceAll(search, replacement) {
      if (this === null || this === undefined) throw new TypeError('Invalid string receiver');
      if (search !== null && search !== undefined) {
        var matchSymbol = typeof Symbol === 'function' && Symbol.match;
        var matcher = matchSymbol ? search[matchSymbol] : undefined;
        var isRegExp = matcher !== undefined ? !!matcher : Object.prototype.toString.call(search) === '[object RegExp]';
        if (isRegExp && String(search.flags).indexOf('g') === -1) {
          throw new TypeError('replaceAll requires a global regular expression');
        }
        var replaceSymbol = typeof Symbol === 'function' && Symbol.replace;
        var replaceMethod = replaceSymbol ? search[replaceSymbol] : undefined;
        if (replaceMethod !== undefined && replaceMethod !== null) {
          if (typeof replaceMethod !== 'function') throw new TypeError('Invalid replacement method');
          return replaceMethod.call(search, this, replacement);
        }
      }
      if (typeof this === 'symbol' || typeof search === 'symbol') throw new TypeError('Cannot convert a Symbol to a string');
      var input = String(this);
      var needle = String(search);
      // Delegate replacement expansion and callbacks to the existing ES5 replace.
      // Escaping the search keeps metacharacters literal and adds no captures.
      return input.replace(new RegExp(needle.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'g'), replacement);
    });
  }

  if (typeof global.AbortSignal === 'function' &&
      typeof global.AbortController === 'function' &&
      typeof global.AbortSignal.timeout !== 'function') {
    install(global.AbortSignal, 'timeout', function timeout(milliseconds) {
      var remaining = +milliseconds;
      if (!isFinite(remaining)) throw new TypeError('Timeout must be finite');
      remaining = remaining < 0 ? Math.ceil(remaining) : Math.floor(remaining);
      if (remaining < 0 || remaining > 9007199254740991) throw new TypeError('Invalid timeout');
      var controller = new global.AbortController();
      var signal = controller.signal;
      var timer;
      signal.addEventListener('abort', function () { global.clearTimeout(timer); }, { once: true });
      function schedule() {
        // Browsers clamp larger delays to a short timer; retain long deadlines.
        var delay = Math.min(remaining, 2147483647);
        timer = global.setTimeout(function () {
          remaining -= delay;
          if (remaining > 0) { schedule(); return; }
          var reason;
          if (typeof global.DOMException === 'function') {
            reason = new global.DOMException('The operation timed out', 'TimeoutError');
          } else {
            reason = new Error('The operation timed out');
            reason.name = 'TimeoutError';
          }
          // Older AbortController implementations ignore abort(reason).
          if (!('reason' in signal)) install(signal, 'reason', reason);
          controller.abort(reason);
        }, delay);
      }
      schedule();
      return signal;
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
