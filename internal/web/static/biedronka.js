(function () {
  var DIRECT_API = "https://api.prod.biedronka.cloud/api/v7";
  var DIRECT_TOKEN = "https://konto.biedronka.pl/realms/loyalty/protocol/openid-connect/token";
  var AUTH_URL = "https://konto.biedronka.pl/realms/loyalty/protocol/openid-connect/auth";
  var PROXY_API = "/api/biedronka";
  var PROXY_TOKEN = "/api/biedronka/token";
  var CLIENT_ID = "cma20";
  var REDIRECT = "app://cma20.biedronka.pl";

  var signedOutEl = document.getElementById("biedronka-signed-out");
  var form = document.getElementById("biedronka-form");
  if (!form || !signedOutEl) return;

  var accessEl = document.getElementById("biedronka-access");
  var refreshEl = document.getElementById("biedronka-refresh");
  var tokenForm = document.getElementById("biedronka-token-form");
  var signInBtn = document.getElementById("biedronka-signin");
  var finishBtn = document.getElementById("biedronka-finish");
  var codeEl = document.getElementById("biedronka-code");
  var codeStep = document.getElementById("biedronka-code-step");
  var authLinkWrap = document.getElementById("biedronka-auth-link");
  var authHref = document.getElementById("biedronka-auth-href");
  var sessionEl = document.getElementById("biedronka-session");
  var sinceEl = document.getElementById("biedronka-since");
  var receiptsEl = document.getElementById("biedronka-receipts");
  var fetchBtn = document.getElementById("biedronka-fetch");
  var clearBtn = document.getElementById("biedronka-clear");
  var downloadBtn = document.getElementById("biedronka-download");
  var importBtn = document.getElementById("biedronka-import");
  var statusEl = document.getElementById("biedronka-status");
  var resultsEl = document.getElementById("biedronka-results");
  var tableBody = document.querySelector("#biedronka-table tbody");
  var jsonEl = document.getElementById("biedronka-json");

  var viaProxy = false;
  var lastPayload = null;
  var accessToken = "";
  var refreshToken = "";
  var pkceVerifier = "";
  var importedSet = {};
  var importedSince = "";

  try {
    localStorage.removeItem("bulkly.biedronka.tokens");
    sessionStorage.removeItem("bulkly.biedronka.pkce");
  } catch (err) {}

  (function loadImported() {
    var el = document.getElementById("biedronka-imported");
    if (!el) return;
    try {
      var data = JSON.parse(el.getAttribute("data-payload") || "{}");
      importedSince = data.since || "";
      (data.ids || []).forEach(function (id) {
        if (id) importedSet[id] = true;
      });
    } catch (err) {}
  })();

  showSession();

  signInBtn.addEventListener("click", startSignIn);
  finishBtn.addEventListener("click", finishSignIn);
  tokenForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var t = {
      access_token: accessEl.value.trim(),
      refresh_token: refreshEl.value.trim()
    };
    if (!t.access_token && !t.refresh_token) {
      setStatus("Paste an access token or a refresh token.");
      return;
    }
    saveTokens(t);
    accessEl.value = "";
    refreshEl.value = "";
    showSession();
    setStatus("Tokens are in this page until you close or refresh it.");
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    runFetch();
  });
  clearBtn.addEventListener("click", function () {
    accessToken = "";
    refreshToken = "";
    pkceVerifier = "";
    accessEl.value = "";
    refreshEl.value = "";
    lastPayload = null;
    downloadBtn.hidden = true;
    if (importBtn) importBtn.hidden = true;
    resultsEl.hidden = true;
    showSession();
    setStatus("Signed out.");
  });
  downloadBtn.addEventListener("click", function () {
    if (!lastPayload) return;
    var blob = new Blob([JSON.stringify(lastPayload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "biedronka-" + (sinceEl.value || "bills") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  if (importBtn) importBtn.addEventListener("click", runImport);

  function tokens() {
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  function saveTokens(next) {
    if (next.access_token) accessToken = next.access_token;
    if (next.refresh_token) refreshToken = next.refresh_token;
  }

  function signedIn() {
    var t = tokens();
    return !!(t.access_token || t.refresh_token);
  }

  function showSession() {
    var on = signedIn();
    signedOutEl.hidden = on;
    form.hidden = !on;
    if (!on) {
      sessionEl.textContent = "";
      return;
    }
    var payload = jwtPayload(tokens().access_token);
    if (typeof payload.exp === "number") {
      sessionEl.textContent = "Signed in · access token until " + new Date(payload.exp * 1000).toLocaleString("pl-PL");
    } else {
      sessionEl.textContent = "Signed in.";
    }
  }

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function b64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function generatePkce() {
    var raw = crypto.getRandomValues(new Uint8Array(32));
    var verifier = b64url(raw);
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier: verifier, challenge: b64url(new Uint8Array(digest)) };
  }

  function authorizationURL(challenge) {
    var params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    return AUTH_URL + "?" + params.toString();
  }

  async function startSignIn() {
    var pkce = await generatePkce();
    pkceVerifier = pkce.verifier;
    var url = authorizationURL(pkce.challenge);
    authHref.href = url;
    authLinkWrap.hidden = false;
    codeStep.hidden = false;
    setStatus("Sign in in the Biedronka tab (phone, captcha, SMS), then paste the app:// redirect here.");
    var w = window.open(url, "_blank");
    if (!w) setStatus("Popup blocked. Use Open the Biedronka login, then paste the app:// redirect here.");
  }

  async function finishSignIn() {
    var verifier = pkceVerifier;
    if (!verifier) {
      setStatus("Start sign-in again so this page still has the PKCE verifier.");
      return;
    }
    var code;
    try {
      code = authCodeFromRedirect(codeEl.value);
    } catch (err) {
      setStatus(String(err.message || err));
      return;
    }
    finishBtn.disabled = true;
    viaProxy = false;
    try {
      var next = await tokenRequest({
        grant_type: "authorization_code",
        code: code,
        code_verifier: verifier
      });
      if (!next.access_token) throw new Error("token rejected");
      pkceVerifier = "";
      saveTokens(next);
      showSession();
      setStatus("Signed in. Choose a since date, then fetch.");
    } catch (err) {
      setStatus(String(err.message || err));
    } finally {
      finishBtn.disabled = false;
    }
  }

  function authCodeFromRedirect(value) {
    var raw = String(value || "").trim().replace(/^["']|["']$/g, "");
    if (!raw) throw new Error("missing auth code");
    var appIdx = raw.indexOf("app://");
    if (appIdx >= 0) {
      raw = raw.slice(appIdx).split(/\s/)[0].replace(/[.,;"']+$/g, "");
    }
    if (raw.indexOf("://") >= 0 || raw.indexOf("app:") === 0 || raw.indexOf("code=") >= 0) {
      return codeFromRedirect(raw);
    }
    return raw;
  }

  function codeFromRedirect(raw) {
    var parsed;
    try {
      parsed = new URL(raw);
    } catch (err) {
      throw new Error("missing auth code");
    }
    var code = parsed.searchParams.get("code");
    if (!code && parsed.hash) {
      code = new URLSearchParams(parsed.hash.replace(/^#/, "")).get("code");
    }
    if (!code) throw new Error("missing auth code");
    return code;
  }

  function jwtPayload(token) {
    var parts = String(token || "").split(".");
    if (parts.length < 2) return {};
    var padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    try {
      return JSON.parse(atob(padded)) || {};
    } catch (err) {
      return {};
    }
  }

  function ymd(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function defaultSince() {
    if (importedSince) return importedSince;
    var d = new Date();
    d.setDate(d.getDate() - 7);
    return ymd(d);
  }

  if (sinceEl) {
    sinceEl.max = ymd(new Date());
    if (!sinceEl.value) sinceEl.value = defaultSince();
  }

  function cutoffMs() {
    var raw = sinceEl && sinceEl.value;
    if (!raw) return new Date(defaultSince() + "T00:00:00").getTime();
    var d = new Date(raw + "T00:00:00");
    if (isNaN(d.getTime())) return new Date(defaultSince() + "T00:00:00").getTime();
    return d.getTime();
  }

  function txTime(tx) {
    if (!tx || !tx.date) return null;
    var d = new Date(tx.date);
    if (isNaN(d.getTime())) return null;
    return d.getTime();
  }

  async function runFetch() {
    var t = tokens();
    if (!t.access_token && !t.refresh_token) {
      setStatus("Sign in with Moja Biedronka first.");
      return;
    }
    fetchBtn.disabled = true;
    downloadBtn.hidden = true;
    lastPayload = null;
    viaProxy = false;
    try {
      await ensureFresh();
      var collected = [];
      var page = 1;
      var pageCount = 1;
      var cut = cutoffMs();
      while (page <= pageCount) {
        setStatus(progressLine(page, pageCount, collected.length, 0));
        var payload = await apiGet("transactions/", { page: String(page) });
        if (!payload || typeof payload !== "object") {
          throw new Error("transactions response was not JSON");
        }
        pageCount = Math.max(1, Number(payload.page_count) || page);
        var rows = Array.isArray(payload.transactions) ? payload.transactions : [];
        var inWindow = [];
        for (var i = 0; i < rows.length; i++) {
          var when = txTime(rows[i]);
          if (when == null || when >= cut) inWindow.push(rows[i]);
        }
        collected = collected.concat(inWindow);
        if (!rows.length || inWindow.length === 0) break;
        var next = Number(payload.next_page);
        if (!next || next <= page) break;
        page = next;
      }

      var withReceipts = 0;
      var wantReceipts = receiptsEl.checked;
      for (var j = 0; j < collected.length; j++) {
        var tx = collected[j];
        if (!wantReceipts || !tx || !tx.id) continue;
        setStatus(progressLine(page, pageCount, collected.length, withReceipts));
        try {
          if (tx.is_e_receipt_available) {
            tx.receipt = await apiGet("transactions/" + encodeURIComponent(String(tx.id)) + "/e-receipt/", null, { "output-format": "json" });
            tx.source = "e_receipt";
          } else {
            tx.receipt = await apiGet("transactions/" + encodeURIComponent(String(tx.id)) + "/");
            tx.source = "details";
          }
          tx.lines = sellLines(tx.receipt);
          withReceipts++;
        } catch (err) {
          tx.receipt_error = String(err.message || err);
        }
      }

      lastPayload = {
        fetched_at: new Date().toISOString(),
        since: sinceEl && sinceEl.value ? sinceEl.value : defaultSince(),
        via: viaProxy ? "proxy" : "browser",
        transactions: collected
      };
      render(lastPayload);
      var via = viaProxy
        ? "Biedronka blocked the browser, so Bulkly forwarded the calls (tokens went through Bulkly for those requests)."
        : "Fetched directly from the browser.";
      setStatus(collected.length + " bills since " + lastPayload.since + ". " + via);
      downloadBtn.hidden = collected.length === 0;
      if (importBtn) importBtn.hidden = importableCount(collected) === 0;
    } catch (err) {
      setStatus(String(err.message || err));
    } finally {
      fetchBtn.disabled = false;
    }
  }

  function progressLine(page, pageCount, n, receipts) {
    var msg = "Page " + page + " of " + pageCount + " · " + n + " bills";
    if (receiptsEl.checked) msg += " · " + receipts + " receipts";
    if (viaProxy) msg += " · via Bulkly";
    return msg;
  }

  function render(payload) {
    tableBody.textContent = "";
    (payload.transactions || []).forEach(function (tx) {
      var tr = document.createElement("tr");
      var lines = Array.isArray(tx.lines) ? tx.lines.length : "";
      addCell(tr, formatDate(tx.date));
      addCell(tr, tx.store_name || "");
      addCell(tr, tx.receipt_num || tx.id || "");
      addCell(tr, formatMoney(tx.total_price));
      addCell(tr, lines === "" ? (tx.receipt_error || "") : String(lines));
      addCell(tr, tx.source || (tx.is_e_receipt_available ? "e-receipt" : "list"));
      addCell(tr, bulklyLabel(tx));
      tableBody.appendChild(tr);
    });
    jsonEl.textContent = JSON.stringify(payload, null, 2);
    resultsEl.hidden = false;
  }

  function bulklyLabel(tx) {
    if (!tx || !tx.id) return "";
    if (tx.bulkly_status === "imported") return "imported";
    if (tx.bulkly_status === "skipped") return "already in";
    if (tx.bulkly_error) return tx.bulkly_error;
    if (importedSet[tx.id]) return "already in";
    if (tx.receipt) return "new";
    return "";
  }

  function importableCount(rows) {
    var n = 0;
    (rows || []).forEach(function (tx) {
      if (tx && tx.id && tx.receipt && !importedSet[tx.id]) n++;
    });
    return n;
  }

  async function runImport() {
    if (!lastPayload || !lastPayload.transactions) {
      setStatus("Fetch bills first.");
      return;
    }
    var t = tokens();
    if (!t.access_token && !t.refresh_token) {
      setStatus("Sign in with Moja Biedronka first.");
      return;
    }
    var rows = lastPayload.transactions;
    var todo = importableCount(rows);
    if (!todo) {
      setStatus("Nothing new to import.");
      if (importBtn) importBtn.hidden = true;
      return;
    }
    if (importBtn) importBtn.disabled = true;
    if (fetchBtn) fetchBtn.disabled = true;
    var imported = 0;
    var skipped = 0;
    var failed = 0;
    try {
      await ensureFresh();
      for (var i = 0; i < rows.length; i++) {
        var tx = rows[i];
        if (!tx || !tx.id) continue;
        if (importedSet[tx.id]) {
          tx.bulkly_status = "skipped";
          skipped++;
          continue;
        }
        if (!tx.receipt) {
          tx.bulkly_error = "no receipt";
          failed++;
          continue;
        }
        setStatus("Importing " + (imported + skipped + failed + 1) + " of " + todo + " new bills…");
        try {
          var out = await apiPost("import", {
            id: String(tx.id),
            date: tx.date || "",
            store_name: tx.store_name || "",
            receipt_num: tx.receipt_num || "",
            total_price: Number(tx.total_price) || 0,
            receipt: tx.receipt
          });
          if (out && out.status === "skipped") {
            tx.bulkly_status = "skipped";
            importedSet[tx.id] = true;
            skipped++;
          } else {
            tx.bulkly_status = "imported";
            tx.receipt_id = out && out.receipt_id;
            importedSet[tx.id] = true;
            imported++;
          }
        } catch (err) {
          tx.bulkly_error = String(err.message || err);
          failed++;
        }
      }
      render(lastPayload);
      var parts = [];
      if (imported) parts.push("imported " + imported);
      if (skipped) parts.push("skipped " + skipped);
      if (failed) parts.push("failed " + failed);
      setStatus(parts.join(", ") + ". Confirm them under Receipts.");
      if (importBtn) importBtn.hidden = importableCount(rows) === 0;
    } finally {
      if (importBtn) importBtn.disabled = false;
      if (fetchBtn) fetchBtn.disabled = false;
    }
  }

  async function apiPost(path, body) {
    await ensureFresh();
    var t = tokens();
    var headers = {
      Authorization: "Bearer " + t.access_token,
      Accept: "application/json",
      "Content-Type": "application/json"
    };
    var res = await fetch(PROXY_API + "/" + path.replace(/^\//, ""), {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });
    return await readJSON(res);
  }

  function addCell(tr, text) {
    var td = document.createElement("td");
    td.textContent = text == null ? "" : String(text);
    tr.appendChild(td);
  }

  function formatDate(raw) {
    if (!raw) return "";
    var d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    return d.toLocaleString("pl-PL");
  }

  function formatMoney(n) {
    if (n == null || n === "") return "";
    var v = Number(n);
    if (!isFinite(v)) return String(n);
    return v.toFixed(2).replace(".", ",") + " zł";
  }

  function sellLines(payload) {
    var found = extractLines(payload);
    var out = [];
    found.forEach(function (line) {
      if (!line || typeof line !== "object") return;
      var sell = line.sellLine;
      if (sell && typeof sell === "object") {
        out.push({
          name: sell.name,
          vatId: sell.vatId,
          price: sell.price,
          total: sell.total,
          quantity: sell.quantity,
          isStorno: sell.isStorno
        });
        return;
      }
      if (line.name || line.unit_price != null || line.total_price != null) {
        out.push({
          name: line.name,
          price: line.unit_price,
          total: line.total_price,
          quantity: line.quantity
        });
      }
    });
    return out;
  }

  function extractLines(payload) {
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch (err) { return []; }
    }
    if (Array.isArray(payload)) {
      if (payload.some(function (item) { return item && (item.sellLine || item.discountLine || item.sumInCurrency); })) {
        return payload;
      }
      for (var i = 0; i < payload.length; i++) {
        var nested = extractLines(payload[i]);
        if (nested.length) return nested;
      }
      return [];
    }
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.lines)) return payload.lines;
    if (Array.isArray(payload.receiptLines)) return payload.receiptLines;
    if (Array.isArray(payload.items)) return payload.items;
    var keys = ["receipt", "data", "payload", "json"];
    for (var k = 0; k < keys.length; k++) {
      if (payload[keys[k]] != null) {
        var found = extractLines(payload[keys[k]]);
        if (found.length) return found;
      }
    }
    return [];
  }

  async function ensureFresh() {
    var t = tokens();
    var payload = jwtPayload(t.access_token);
    if (typeof payload.exp === "number" && payload.exp - 60 > Date.now() / 1000) return;
    if (!t.refresh_token) return;
    var next = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: t.refresh_token
    });
    saveTokens({
      access_token: next.access_token,
      refresh_token: next.refresh_token || t.refresh_token
    });
    showSession();
  }

  async function tokenRequest(fields) {
    var body = new URLSearchParams(Object.assign({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT
    }, fields));
    var headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    if (!viaProxy) {
      try {
        return await readJSON(await fetch(DIRECT_TOKEN, { method: "POST", headers: headers, body: body }));
      } catch (err) {
        viaProxy = true;
      }
    }
    return await readJSON(await fetch(PROXY_TOKEN, { method: "POST", headers: headers, body: body }));
  }

  async function apiGet(path, query, extraHeaders) {
    await ensureFresh();
    var t = tokens();
    var headers = Object.assign({
      Authorization: "Bearer " + t.access_token,
      Accept: "application/json",
      "Accept-Language": "pl-PL"
    }, extraHeaders || {});
    var qs = "";
    if (query) qs = "?" + new URLSearchParams(query).toString();
    if (!viaProxy) {
      try {
        return await readJSON(await fetch(DIRECT_API + "/" + path + qs, { headers: headers }));
      } catch (err) {
        viaProxy = true;
      }
    }
    var proxyPath = path.replace(/\/$/, "");
    return await readJSON(await fetch(PROXY_API + "/" + proxyPath + qs, { headers: headers }));
  }

  async function readJSON(res) {
    var text = await res.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (err) { data = text; }
    }
    if (!res.ok) {
      var msg = "http " + res.status;
      if (data && data.error) msg = data.error;
      else if (typeof data === "string" && data) msg = data.slice(0, 180);
      throw new Error(msg);
    }
    return data;
  }
})();
