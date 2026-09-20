(function () {
  var PREFIX = "app://cma20.biedronka.pl";

  function capture(url) {
    var raw = String(url || "");
    if (raw.indexOf(PREFIX) !== 0) return false;
    if (/[?&#]code=/.test(raw)) {
      window.postMessage({ source: "bulkly-biedronka", url: raw }, "*");
    }
    return true;
  }

  function wrap(obj, name) {
    var orig = obj[name];
    if (typeof orig !== "function") return;
    obj[name] = function (url) {
      if (capture(url)) return;
      return orig.apply(this, arguments);
    };
  }

  try {
    wrap(Location.prototype, "assign");
    wrap(Location.prototype, "replace");
  } catch (err) {}

  try {
    var desc = Object.getOwnPropertyDescriptor(Location.prototype, "href");
    if (desc && desc.set) {
      Object.defineProperty(Location.prototype, "href", {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (url) {
          if (capture(url)) return;
          return desc.set.call(this, url);
        }
      });
    }
  } catch (err) {}

  try {
    var open = window.open;
    if (typeof open === "function") {
      window.open = function (url) {
        if (capture(url)) return null;
        return open.apply(this, arguments);
      };
    }
  } catch (err) {}
})();
