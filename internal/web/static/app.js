(function () {
  var path = location.pathname;
  document.querySelectorAll(".rail nav a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (!href) return;
    var current;
    if (href === "/admin") {
      current = path === "/admin" || path.indexOf("/admin/purchases/") === 0 ||
        (path.indexOf("/admin/products/") === 0 && path.indexOf("/admin/products/new") !== 0);
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

  var searchRoot = document.querySelector("[data-product-search]");
  if (searchRoot) {
    var searchInput = searchRoot.querySelector("input[type=search]");
    var searchList = searchRoot.querySelector("[data-suggest]");
    var searchEmpty = searchRoot.querySelector("[data-suggest-empty]");
    var searchTimer = 0;
    var searchAbort = null;
    var active = -1;

    function setActive(i) {
      var links = searchList.querySelectorAll("a");
      if (!links.length) {
        active = -1;
        return;
      }
      if (i < 0) i = links.length - 1;
      if (i >= links.length) i = 0;
      active = i;
      links.forEach(function (a, n) {
        a.classList.toggle("is-current", n === active);
      });
    }

    function showItems(items) {
      searchList.innerHTML = "";
      active = -1;
      if (!items || !items.length) {
        searchEmpty.hidden = false;
        return;
      }
      searchEmpty.hidden = true;
      items.forEach(function (it) {
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.className = "row";
        a.href = "/products/" + it.id;
        if (it.image) {
          var img = document.createElement("img");
          img.className = "thumb";
          img.src = it.image;
          img.alt = "";
          a.appendChild(img);
        } else {
          var ph = document.createElement("span");
          ph.className = "thumb thumb-empty";
          ph.setAttribute("aria-hidden", "true");
          a.appendChild(ph);
        }
        var main = document.createElement("span");
        main.className = "row-main";
        var name = document.createElement("strong");
        name.textContent = it.name;
        var meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = it.unit || "";
        main.appendChild(name);
        main.appendChild(meta);
        a.appendChild(main);
        li.appendChild(a);
        searchList.appendChild(li);
      });
    }

    function runSearch() {
      var q = (searchInput.value || "").trim();
      if (!q) {
        searchList.innerHTML = "";
        searchEmpty.hidden = true;
        return;
      }
      if (searchAbort) searchAbort.abort();
      searchAbort = new AbortController();
      fetch("/api/products/suggestions?q=" + encodeURIComponent(q), { signal: searchAbort.signal })
        .then(function (r) { return r.json(); })
        .then(showItems)
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
        });
    }

    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 150);
    });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === "Enter" && active >= 0) {
        var links = searchList.querySelectorAll("a");
        if (links[active]) {
          e.preventDefault();
          location.href = links[active].href;
        }
      }
    });
  }

  var chartEl = document.querySelector("[data-price-chart]");
  if (chartEl) {
    var points = [];
    try {
      points = JSON.parse(chartEl.getAttribute("data-price-chart") || "[]");
    } catch (e) {
      points = [];
    }
    if (points.length) {
      var w = 800;
      var h = 280;
      var pad = { l: 78, r: 18, t: 16, b: 40 };
      var ns = "http://www.w3.org/2000/svg";
      function svgEl(name, attrs) {
        var node = document.createElementNS(ns, name);
        Object.keys(attrs || {}).forEach(function (k) {
          if (attrs[k] == null || attrs[k] === "") return;
          node.setAttribute(k, String(attrs[k]));
        });
        return node;
      }
      function dayMs(s) {
        var p = String(s || "").slice(0, 10).split("-");
        return Date.UTC(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
      }
      function niceNum(span, round) {
        var exp = Math.floor(Math.log(span) / Math.LN10);
        var frac = span / Math.pow(10, exp);
        var nice;
        if (round) {
          if (frac < 1.5) nice = 1;
          else if (frac < 3) nice = 2;
          else if (frac < 7) nice = 5;
          else nice = 10;
        } else if (frac <= 1) nice = 1;
        else if (frac <= 2) nice = 2;
        else if (frac <= 5) nice = 5;
        else nice = 10;
        return nice * Math.pow(10, exp);
      }
      function niceScale(min, max, ticks) {
        var padY = (max - min) * 0.08;
        if (!isFinite(padY) || padY <= 0) padY = Math.max(0.5, Math.abs(max) * 0.1 || 1);
        min -= padY;
        max += padY;
        if (min < 0 && numsMin >= 0) min = 0;
        var range = niceNum(max - min || 1, false);
        var step = niceNum(range / Math.max(ticks - 1, 1), true);
        var niceMin = Math.floor(min / step) * step;
        var niceMax = Math.ceil(max / step) * step;
        if (niceMin < 0 && numsMin >= 0) niceMin = 0;
        if (niceMin === niceMax) niceMax = niceMin + step;
        var values = [];
        for (var v = niceMin; v <= niceMax + step / 2; v = +(v + step).toFixed(10)) {
          values.push(v);
        }
        return { min: niceMin, max: niceMax, step: step, ticks: values };
      }
      var t0 = dayMs(chartEl.getAttribute("data-chart-from"));
      var t1 = dayMs(chartEl.getAttribute("data-chart-to"));
      if (!t0 || !t1 || t1 <= t0) {
        t0 = dayMs(points[0].on);
        t1 = dayMs(points[points.length - 1].on);
        if (t1 <= t0) t1 = t0 + 86400000;
      }
      var nums = points.map(function (p) { return Number(p.price); }).filter(function (n) { return isFinite(n); });
      if (nums.length) {
      var numsMin = Math.min.apply(null, nums);
      var numsMax = Math.max.apply(null, nums);
      var yScale = niceScale(numsMin, numsMax, 5);
      var ymin = yScale.min;
      var ymax = yScale.max;
      var innerW = w - pad.l - pad.r;
      var innerH = h - pad.t - pad.b;
      function xOfMs(ms) {
        return pad.l + ((ms - t0) / (t1 - t0)) * innerW;
      }
      function xOf(on) {
        return xOfMs(dayMs(on));
      }
      function yOf(price) {
        return pad.t + (1 - (Number(price) - ymin) / (ymax - ymin)) * innerH;
      }
      function fmtPrice(n) {
        var digits = yScale.step >= 1 ? 0 : yScale.step >= 0.1 ? 1 : 2;
        return n.toFixed(digits).replace(".", ",") + (sym ? " " + sym : "");
      }
      function fmtMonth(ms) {
        var d = new Date(ms);
        var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        var label = names[d.getUTCMonth()];
        if (d.getUTCMonth() === 0) {
          var y = d.getUTCFullYear() % 100;
          return label + " ’" + (y < 10 ? "0" : "") + y;
        }
        return label;
      }
      function monthStarts(from, to) {
        var first = new Date(from);
        var t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
        if (t < from) t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
        var out = [];
        while (t <= to) {
          out.push(t);
          var d = new Date(t);
          t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
        }
        return out;
      }
      var sym = (chartEl.getAttribute("data-chart-symbol") || "").trim();
      var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, role: "img" });
      var months = monthStarts(t0, t1);
      var minor = 0;
      if (yScale.step >= 10) minor = yScale.step / 2;
      else if (yScale.step === 5) minor = 1;
      else if (yScale.step === 2) minor = 1;
      if (minor > 0) {
        for (var yv = ymin + minor; yv < ymax - minor / 2; yv = +(yv + minor).toFixed(10)) {
          if (Math.abs(yv / yScale.step - Math.round(yv / yScale.step)) < 1e-6) continue;
          svg.appendChild(svgEl("line", {
            class: "grid grid-y-minor",
            x1: pad.l, x2: pad.l + innerW, y1: yOf(yv), y2: yOf(yv)
          }));
        }
      }
      months.forEach(function (ms) {
        var x = xOfMs(ms);
        var year = new Date(ms).getUTCMonth() === 0;
        svg.appendChild(svgEl("line", {
          class: "grid grid-x" + (year ? " is-year" : ""),
          x1: x, x2: x, y1: pad.t, y2: pad.t + innerH
        }));
      });
      yScale.ticks.forEach(function (tick) {
        svg.appendChild(svgEl("line", {
          class: "grid grid-y",
          x1: pad.l, x2: pad.l + innerW, y1: yOf(tick), y2: yOf(tick)
        }));
      });
      svg.appendChild(svgEl("rect", {
        class: "frame",
        x: pad.l, y: pad.t, width: innerW, height: innerH
      }));
      var coords = points.map(function (p) {
        return { x: xOf(p.on), y: yOf(p.price) };
      });
      if (coords.length > 1) {
        svg.appendChild(svgEl("polyline", {
          class: "line",
          points: coords.map(function (c) { return c.x + "," + c.y; }).join(" ")
        }));
      }
      coords.forEach(function (c) {
        svg.appendChild(svgEl("circle", { class: "dot", cx: c.x, cy: c.y, r: 1 }));
      });
      yScale.ticks.forEach(function (tick) {
        var t = svgEl("text", {
          class: "axis axis-y",
          x: pad.l - 8,
          y: yOf(tick),
          "text-anchor": "end",
          "dominant-baseline": "middle"
        });
        t.textContent = fmtPrice(tick);
        svg.appendChild(t);
      });
      var lastLabelX = -Infinity;
      months.forEach(function (ms, i) {
        var x = xOfMs(ms);
        if (x - lastLabelX < 44 && i !== months.length - 1) return;
        if (x > pad.l + innerW - 8) return;
        var t = svgEl("text", {
          class: "axis axis-x",
          x: x,
          y: h - 12,
          "text-anchor": "middle"
        });
        t.textContent = fmtMonth(ms);
        svg.appendChild(t);
        lastLabelX = x;
      });
      chartEl.appendChild(svg);
      }
    }
  }

  var camera = document.getElementById("bill-camera");
  var file = document.getElementById("bill");
  var form = document.getElementById("receipt-upload");
  if (!camera || !file || !form) return;

  var wrap = document.getElementById("scan-drop");
  var ready = document.getElementById("scan-ready");
  var btn = document.getElementById("receipt-submit");

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
    if (!f) {
      ready.hidden = true;
      ready.textContent = "";
      wrap.classList.remove("has-file");
      return;
    }
    ready.hidden = false;
    ready.textContent = "File " + (f.name || "bill") + " is ready to upload";
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

  function hasFiles(e) {
    var types = e.dataTransfer && e.dataTransfer.types;
    if (!types) return false;
    if (typeof types.contains === "function") return types.contains("Files");
    return Array.prototype.indexOf.call(types, "Files") !== -1;
  }

  function isBillFile(f) {
    if (!f) return false;
    if (isPDF(f)) return true;
    var type = (f.type || "").toLowerCase();
    if (type.indexOf("image/") === 0) return true;
    var name = (f.name || "").toLowerCase();
    return /\.(jpe?g|png|webp|gif)$/.test(name);
  }

  function firstBill(files) {
    if (!files) return null;
    for (var i = 0; i < files.length; i++) {
      if (isBillFile(files[i])) return files[i];
    }
    return null;
  }

  function assignFile(f) {
    try {
      var dt = new DataTransfer();
      dt.items.add(f);
      file.files = dt.files;
      camera.value = "";
    } catch (err) {}
    file.setCustomValidity("");
    show(f);
  }

  var overTimer = 0;
  function markOver(on) {
    clearTimeout(overTimer);
    if (on) {
      wrap.classList.add("is-over");
      return;
    }
    wrap.classList.remove("is-over");
  }

  document.addEventListener("dragenter", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    markOver(true);
  });
  document.addEventListener("dragover", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    markOver(true);
    overTimer = setTimeout(function () {
      markOver(false);
    }, 150);
  });
  document.addEventListener("dragleave", function (e) {
    if (!hasFiles(e)) return;
    if (e.relatedTarget) return;
    markOver(false);
  });
  document.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    markOver(false);
    var f = firstBill(e.dataTransfer.files);
    if (!f) {
      file.setCustomValidity("Choose a photo or a PDF of the bill.");
      file.reportValidity();
      return;
    }
    assignFile(f);
  });

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
