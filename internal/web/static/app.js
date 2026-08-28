(function () {
  var path = location.pathname;
  document.querySelectorAll(".rail nav a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (!href) return;
    var current;
    if (href === "/") {
      current = path === "/" || path.indexOf("/purchases/") === 0 ||
        (path.indexOf("/products/") === 0 && path.indexOf("/products/new") !== 0);
    } else {
      current = path === href || path.indexOf(href + "/") === 0;
    }
    if (current) a.classList.add("is-current");
  });

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

  function unitOf(form) {
    var attr = form.getAttribute("data-pack-unit");
    if (attr) return attr.trim();
    var sel = form.querySelector("[data-pack-unit-select]");
    if (sel && sel.selectedIndex >= 0) {
      var text = (sel.options[sel.selectedIndex].text || "").trim();
      if (text && text !== "Select…") return text;
    }
    var size = form.querySelector("[data-pack-size]");
    var label = size && size.closest("label");
    if (!label) return "";
    var m = label.textContent.match(/\(([^)]+)\)/);
    return m ? m[1].trim() : "";
  }

  function syncPack(form) {
    var count = form.querySelector("[data-pack-count]");
    var size = form.querySelector("[data-pack-size]");
    var total = form.querySelector("[data-pack-total]");
    if (!count || !size || !total) return;
    var packs = parseNum(count.value);
    var packSize = parseNum(size.value);
    if (!packs || !packSize) {
      total.hidden = true;
      total.textContent = "";
      return;
    }
    var unit = unitOf(form);
    total.hidden = false;
    total.textContent = "Total " + formatQty(packs * packSize) + (unit ? " " + unit : "");
  }

  function bindPack(form) {
    if (!form || form.getAttribute("data-pack-bound")) return;
    form.setAttribute("data-pack-bound", "1");
    form.addEventListener("input", function () {
      syncPack(form);
    });
    form.addEventListener("change", function () {
      syncPack(form);
    });
    syncPack(form);
  }

  document.querySelectorAll("[data-pack-form]").forEach(bindPack);

  var lines = document.getElementById("receipt-lines");
  if (lines) {
    lines.addEventListener("change", function (e) {
      if (e.target && e.target.name && e.target.name.indexOf("include_") === 0) {
        var field = e.target.closest(".receipt-line");
        if (field) field.classList.toggle("is-off", !e.target.checked);
      }
    });
  }

  var add = document.getElementById("add-line");
  if (add && lines) {
    var count = document.getElementById("line-count");
    var tmpl = document.getElementById("receipt-line-template");
    add.addEventListener("click", function () {
      var i = parseInt(count.value, 10) || 0;
      var html = tmpl.innerHTML.split("__I__").join(String(i));
      var wrap = document.createElement("div");
      wrap.innerHTML = html.trim();
      var field = wrap.firstElementChild;
      lines.appendChild(field);
      bindPack(field);
      count.value = String(i + 1);
    });
  }

  var camera = document.getElementById("bill-camera");
  var file = document.getElementById("bill");
  var form = document.getElementById("receipt-upload");
  if (!camera || !file || !form) return;

  var wrap = document.getElementById("scan-drop");
  var preview = document.getElementById("scan-preview");
  var img = document.getElementById("scan-preview-img");
  var btn = document.getElementById("receipt-submit");
  var url = "";

  function picked() {
    if (camera.files && camera.files[0]) return camera.files[0];
    if (file.files && file.files[0]) return file.files[0];
    return null;
  }

  function show(f) {
    if (url) URL.revokeObjectURL(url);
    if (!f) {
      preview.hidden = true;
      wrap.classList.remove("has-file");
      return;
    }
    url = URL.createObjectURL(f);
    img.src = url;
    preview.hidden = false;
    wrap.classList.add("has-file");
  }

  function onPick(which) {
    return function () {
      if (which === camera) file.value = "";
      else camera.value = "";
      show(picked());
    };
  }
  camera.addEventListener("change", onPick(camera));
  file.addEventListener("change", onPick(file));

  form.addEventListener("submit", function (e) {
    if (!picked()) {
      file.setCustomValidity("Choose a photo of the bill.");
      file.reportValidity();
      e.preventDefault();
      return;
    }
    file.setCustomValidity("");
    btn.disabled = true;
    btn.textContent = "Reading the bill…";
  });
})();
