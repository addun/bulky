(function () {
  function parseNum(raw) {
    raw = String(raw || "").trim().replace(",", ".");
    if (!raw) return null;
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return null;
    return n;
  }

  function formatQty(n) {
    var s = String(n);
    if (s.indexOf("e") !== -1 || s.indexOf("E") !== -1) {
      s = n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    }
    return s.replace(".", ",");
  }

  function setupPackForm(form) {
    var count = form.querySelector("[data-pack-count]");
    var size = form.querySelector("[data-pack-size]");
    var total = form.querySelector("[data-pack-total]");
    if (!count || !size || !total) return;

    function unit() {
      var label = size.closest("label");
      if (!label) return "";
      var m = label.textContent.match(/\(([^)]+)\)/);
      return m ? m[1].trim() : "";
    }

    function sync() {
      var packs = parseNum(count.value);
      var packSize = parseNum(size.value);
      if (!packs || !packSize) {
        total.hidden = true;
        total.textContent = "";
        return;
      }
      total.hidden = false;
      total.textContent = "Total " + formatQty(packs * packSize) + " " + unit();
    }

    count.addEventListener("input", sync);
    size.addEventListener("input", sync);
    sync();
  }

  document.querySelectorAll("[data-pack-form]").forEach(setupPackForm);
})();
