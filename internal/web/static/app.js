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

  function formatMoney(n) {
    return n.toFixed(2).replace(".", ",");
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
    var qty = packs * packSize;
    var unit = unitOf(form);
    var parts = ["Total " + formatQty(qty) + (unit ? " " + unit : "")];
    var amountEl = form.querySelector("[data-pack-amount]");
    var amount = amountEl ? parseNum(amountEl.value) : null;
    if (amount) {
      var sym = (form.getAttribute("data-pack-symbol") || "").trim();
      var price = formatMoney(amount / qty) + (sym ? " " + sym : "");
      parts.push(price + (unit ? "/" + unit : " per unit"));
    }
    total.hidden = false;
    total.textContent = parts.join(" · ");
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
  function syncLineProduct(line) {
    if (!line) return;
    var sel = line.querySelector("[data-product-choice]");
    var nameField = line.querySelector("[data-new-name]");
    if (!sel || !nameField) return;
    var isNew = sel.value === "new" || sel.value === "";
    nameField.hidden = !isNew;
    if (!isNew) {
      var opt = sel.options[sel.selectedIndex];
      var unitId = opt && opt.getAttribute("data-unit-id");
      var unitSel = line.querySelector("[data-pack-unit-select]");
      var allowed = {};
      var ids = ((opt && opt.getAttribute("data-unit-ids")) || unitId || "").split(",");
      ids.forEach(function (id) {
        if (id) allowed[id] = true;
      });
      if (unitSel && unitId && !allowed[unitSel.value]) {
        unitSel.value = unitId;
      }
      line.setAttribute("data-conversions", (opt && opt.getAttribute("data-conversions")) || "[]");
    } else {
      line.removeAttribute("data-conversions");
    }
    syncPack(line);
  }

  if (lines) {
    lines.addEventListener("change", function (e) {
      if (!e.target || !e.target.name) return;
      var field = e.target.closest(".receipt-line");
      if (!field) return;
      if (e.target.name.indexOf("include_") === 0) {
        field.classList.toggle("is-off", !e.target.checked);
      }
      if (e.target.name.indexOf("product_choice_") === 0) {
        syncLineProduct(field);
      }
    });
    lines.querySelectorAll(".receipt-line").forEach(syncLineProduct);
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
      syncLineProduct(field);
      count.value = String(i + 1);
    });
  }

  var extraUnits = document.getElementById("extra-units");
  var addExtra = document.getElementById("add-extra-unit");
  var extraTmpl = document.getElementById("extra-unit-template");
  var purchaseUnit = document.getElementById("purchase-unit");
  function syncPrimaryUnitLabels() {
    var name = "base unit";
    var locked = document.querySelector("[data-locked-primary-unit]");
    if (locked && locked.textContent.trim()) {
      name = locked.textContent.trim();
    } else if (purchaseUnit && purchaseUnit.selectedIndex >= 0) {
      var text = (purchaseUnit.options[purchaseUnit.selectedIndex].text || "").trim();
      if (text && text !== "Select…") name = text;
    }
    document.querySelectorAll("[data-primary-unit]").forEach(function (el) {
      el.textContent = name;
    });
  }
  if (addExtra && extraUnits && extraTmpl) {
    addExtra.addEventListener("click", function () {
      var wrap = document.createElement("div");
      wrap.innerHTML = extraTmpl.innerHTML.trim();
      extraUnits.appendChild(wrap.firstElementChild);
      syncPrimaryUnitLabels();
    });
    extraUnits.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest("[data-remove-extra]");
      if (!btn) return;
      var row = btn.closest(".extra-unit");
      if (row) row.remove();
    });
  }
  if (purchaseUnit) {
    purchaseUnit.addEventListener("change", syncPrimaryUnitLabels);
    syncPrimaryUnitLabels();
  } else {
    syncPrimaryUnitLabels();
  }

  var changeUnit = document.querySelector("[data-change-unit]");
  if (changeUnit) {
    var unitSel = changeUnit.querySelector("[name=unit_id]");
    function syncNewUnit() {
      var name = "new unit";
      var factor = "";
      if (unitSel && unitSel.selectedIndex >= 0) {
        var opt = unitSel.options[unitSel.selectedIndex];
        var text = (opt.text || "").trim();
        if (unitSel.value && text && text !== "Select…") {
          name = text;
          factor = opt.getAttribute("data-factor") || "";
        }
      }
      changeUnit.querySelectorAll("[data-new-unit]").forEach(function (el) {
        el.textContent = name;
      });
      changeUnit.querySelectorAll("[data-change-factor]").forEach(function (el) {
        el.textContent = factor;
      });
    }
    if (unitSel) {
      unitSel.addEventListener("change", syncNewUnit);
      syncNewUnit();
    }
  }

  var camera = document.getElementById("bill-camera");
  var file = document.getElementById("bill");
  var form = document.getElementById("receipt-upload");
  if (!camera || !file || !form) return;

  var wrap = document.getElementById("scan-drop");
  var preview = document.getElementById("scan-preview");
  var img = document.getElementById("scan-preview-img");
  var fileLabel = document.getElementById("scan-preview-file");
  var btn = document.getElementById("receipt-submit");
  var url = "";

  function picked() {
    if (camera.files && camera.files[0]) return camera.files[0];
    if (file.files && file.files[0]) return file.files[0];
    return null;
  }

  function isPDF(f) {
    if (!f) return false;
    var name = (f.name || "").toLowerCase();
    return f.type === "application/pdf" || name.slice(-4) === ".pdf";
  }

  function show(f) {
    if (url) URL.revokeObjectURL(url);
    url = "";
    if (!f) {
      preview.hidden = true;
      wrap.classList.remove("has-file");
      return;
    }
    if (isPDF(f)) {
      img.hidden = true;
      img.removeAttribute("src");
      fileLabel.hidden = false;
      fileLabel.textContent = f.name || "PDF";
    } else {
      fileLabel.hidden = true;
      fileLabel.textContent = "";
      url = URL.createObjectURL(f);
      img.hidden = false;
      img.src = url;
    }
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
      file.setCustomValidity("Choose a photo or a PDF of the bill.");
      file.reportValidity();
      e.preventDefault();
      return;
    }
    file.setCustomValidity("");
    btn.disabled = true;
    btn.textContent = "Reading the bill…";
  });
})();
