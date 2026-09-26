(function () {
  var AUTH_URL = "https://konto.biedronka.pl/realms/loyalty/protocol/openid-connect/auth";
  var API = "/api/biedronka";
  var TOKEN = "/api/biedronka/token";
  var CLIENT_ID = "cma20";
  var REDIRECT = "app://cma20.biedronka.pl";
  var HINT_HELPER = "The Chromium helper fills this field after Moja Biedronka sign-in. Click Finish sign-in to continue. The code works once and expires in about a minute.";
  var HINT_PASTE = "After SMS (or if you are already signed in), the login tries to open app://cma20.biedronka.pl?code=…. Paste that address here. To fill it automatically, load the unpacked helper from extensions/biedronka (Chrome, Edge, Brave, or Arc), then refresh. The helper matches localhost:8080, 127.0.0.1:8080, shop.home.arpa, and shop.piekna2.pl. The code works once and expires in about a minute.";

  var signedOutEl = document.getElementById("biedronka-signed-out");
  var signedInEl = document.getElementById("biedronka-signed-in");
  var signInBtn = document.getElementById("biedronka-signin");
  var finishBtn = document.getElementById("biedronka-finish");
  var codeEl = document.getElementById("biedronka-code");
  if (!signedOutEl || !signedInEl || !signInBtn || !finishBtn || !codeEl) return;

  var codeHintEl = document.getElementById("biedronka-code-hint");
  var sessionEl = document.getElementById("biedronka-session");
  var clearBtn = document.getElementById("biedronka-clear");
  var importAllBtn = document.getElementById("biedronka-import-all");
  var moreBtn = document.getElementById("biedronka-more");
  var statusEl = document.getElementById("biedronka-status");
  var resultsEl = document.getElementById("biedronka-results");
  var tableBody = document.querySelector("#biedronka-table tbody");

  var lastPayload = null;
  var accessToken = "";
  var refreshToken = "";
  var pkceVerifier = "";
  var importedSet = {};
  var finishingSignIn = false;
  var loadingBills = false;
  var importing = false;
  var listPage = 1;
  var listArchived = false;

  function log() {
    var args = ["[biedronka]"].concat([].slice.call(arguments));
    console.info.apply(console, args);
  }

  try {
    localStorage.removeItem("bulkly.biedronka.tokens");
    pkceVerifier = sessionStorage.getItem("bulkly.biedronka.pkce") || "";
  } catch (err) {}

  (function loadImported() {
    var el = document.getElementById("biedronka-imported");
    if (!el) return;
    try {
      var data = JSON.parse(el.getAttribute("data-payload") || "{}");
      (data.ids || []).forEach(function (id) {
        if (id) importedSet[id] = true;
      });
    } catch (err) {}
  })();

  showSession();
  applyHelperUi();

  signInBtn.addEventListener("click", startSignIn);
  finishBtn.addEventListener("click", finishSignIn);
  document.documentElement.addEventListener("bulkly-biedronka-redirect", function () {
    var url = document.documentElement.getAttribute("data-bulkly-biedronka-redirect") || "";
    document.documentElement.removeAttribute("data-bulkly-biedronka-redirect");
    if (!url) return;
    codeEl.value = url;
    codeEl.focus();
    setStatus("The helper filled the redirect. Click Finish sign-in.");
  });
  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      accessToken = "";
      refreshToken = "";
      pkceVerifier = "";
      try { sessionStorage.removeItem("bulkly.biedronka.pkce"); } catch (err) {}
      lastPayload = null;
      listPage = 1;
      if (resultsEl) resultsEl.hidden = true;
      if (tableBody) tableBody.textContent = "";
      showSession();
      setStatus("Signed out.");
    });
  }
  if (moreBtn) moreBtn.addEventListener("click", function () { loadBills(false); });
  if (importAllBtn) importAllBtn.addEventListener("click", runImportAll);

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
    signedInEl.hidden = !on;
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

  function helperEnabled() {
    return document.documentElement.getAttribute("data-bulkly-biedronka-ext") === "1";
  }

  function applyHelperUi() {
    if (!codeHintEl) return;
    codeHintEl.textContent = helperEnabled() ? HINT_HELPER : HINT_PASTE;
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
    try { sessionStorage.setItem("bulkly.biedronka.pkce", pkceVerifier); } catch (err) {}
    codeEl.value = "";
    var url = authorizationURL(pkce.challenge);
    if (helperEnabled()) {
      setStatus("Sign in in the Biedronka tab. The helper will fill the redirect here.");
    } else {
      setStatus("Sign in in the Biedronka tab, then paste the app:// redirect here.");
    }
    var w = window.open(url, "_blank");
    if (!w) {
      if (helperEnabled()) {
        setStatus("Popup blocked. Allow popups for this page, then click Sign in again. The helper will fill the redirect here.");
      } else {
        setStatus("Popup blocked. Allow popups for this page, then click Sign in again and paste the app:// redirect here.");
      }
    }
  }

  async function finishSignIn() {
    if (finishingSignIn) return;
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
    finishingSignIn = true;
    finishBtn.disabled = true;
    try {
      var next = await tokenRequest({
        grant_type: "authorization_code",
        code: code,
        code_verifier: verifier
      });
      if (!next.access_token) throw new Error("token rejected");
      pkceVerifier = "";
      try { sessionStorage.removeItem("bulkly.biedronka.pkce"); } catch (err) {}
      saveTokens(next);
      showSession();
      setStatus("Signed in. Loading bills…");
      await loadBills(true);
    } catch (err) {
      setStatus(String(err.message || err));
      codeEl.value = "";
    } finally {
      finishingSignIn = false;
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

  async function loadBills(reset) {
    if (loadingBills) return;
    var t = tokens();
    if (!t.access_token && !t.refresh_token) {
      setStatus("Sign in with Moja Biedronka first.");
      return;
    }
    loadingBills = true;
    if (moreBtn) moreBtn.disabled = true;
    if (importAllBtn) importAllBtn.disabled = true;
    try {
      await ensureFresh();
      if (reset) {
        listPage = 1;
        listArchived = false;
        lastPayload = {
          fetched_at: new Date().toISOString(),
          via: "proxy",
          transactions: []
        };
      }
      setStatus("Loading page " + listPage + "…");
      var query = { page: String(listPage) };
      if (listArchived) query.archived = "1";
      var payload = await apiGet("transactions/", query);
      if (!payload || typeof payload !== "object") {
        throw new Error("transactions response was not JSON");
      }
      var pageCount = Math.max(1, Number(payload.page_count) || listPage);
      var rows = Array.isArray(payload.transactions)
        ? payload.transactions
        : Array.isArray(payload.results)
          ? payload.results
          : [];
      log("listed", listArchived ? "archived" : "current", "page", listPage, "of", pageCount, rows.length + " bills");
      for (var i = 0; i < rows.length; i++) lastPayload.transactions.push(rows[i]);
      var fromArchive = listArchived;
      var next = Number(payload.next_page);
      if (next && next > listPage) listPage = next;
      else if (!listArchived) {
        listArchived = true;
        listPage = 1;
      } else listPage = 0;
      var n = lastPayload.transactions.length;
      var emptyMsg = "";
      if (!n) {
        emptyMsg = fromArchive
          ? "No older bills."
          : "No current bills from the last 12 days. Load more for older bills.";
      }
      render(lastPayload, emptyMsg);
      setStatus(n ? n + " bill" + (n === 1 ? "" : "s") + " loaded." : "");
    } catch (err) {
      setStatus(String(err.message || err));
    } finally {
      loadingBills = false;
      if (moreBtn) {
        moreBtn.hidden = !listPage;
        moreBtn.disabled = false;
      }
      syncImportAll();
    }
  }

  function render(payload, emptyMsg) {
    tableBody.textContent = "";
    var rows = payload.transactions || [];
    if (!rows.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 4;
      td.className = "empty";
      td.textContent = emptyMsg || "No bills.";
      empty.appendChild(td);
      tableBody.appendChild(empty);
    } else {
      rows.forEach(function (tx) {
        var tr = document.createElement("tr");
        addCell(tr, formatDate(tx.date));
        addCell(tr, tx.store_name || "");
        addCell(tr, formatMoney(tx.total_price));
        addImportCell(tr, tx);
        tableBody.appendChild(tr);
      });
    }
    resultsEl.hidden = false;
    syncImportAll();
  }

  function addImportCell(tr, tx) {
    var td = document.createElement("td");
    td.className = "tight";
    if (!tx || !tx.id) {
      tr.appendChild(td);
      return;
    }
    if (importedSet[tx.id] || tx.bulkly_status === "imported" || tx.bulkly_status === "skipped") {
      td.textContent = bulklyLabel(tx);
    } else {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-plain";
      btn.textContent = "Import";
      btn.addEventListener("click", function () {
        importOne(tx);
      });
      td.appendChild(btn);
    }
    tr.appendChild(td);
  }

  function bulklyLabel(tx) {
    if (!tx || !tx.id) return "";
    if (tx.bulkly_status === "imported") return "imported";
    if (tx.bulkly_status === "skipped") return "already in";
    if (tx.bulkly_error) return tx.bulkly_error;
    if (importedSet[tx.id]) return "already in";
    return "";
  }

  function importable(tx) {
    return !!(tx && tx.id && !importedSet[tx.id] && tx.bulkly_status !== "imported" && tx.bulkly_status !== "skipped");
  }

  function importableCount(rows) {
    var n = 0;
    (rows || []).forEach(function (tx) {
      if (importable(tx)) n++;
    });
    return n;
  }

  function syncImportAll() {
    if (!importAllBtn) return;
    var n = lastPayload ? importableCount(lastPayload.transactions) : 0;
    importAllBtn.hidden = !lastPayload;
    importAllBtn.disabled = importing || loadingBills || n === 0;
  }

  async function importOne(tx) {
    if (importing || loadingBills) return;
    if (!importable(tx)) return;
    importing = true;
    syncImportAll();
    setStatus("Importing…");
    try {
      tx.bulkly_error = "";
      await ensureFresh();
      await ensureReceipt(tx);
      await postImport(tx);
    } catch (err) {
      tx.bulkly_error = String(err.message || err);
      log(tx.id, "import failed:", tx.bulkly_error);
      setStatus(tx.bulkly_error);
    }
    importing = false;
    render(lastPayload);
    if (!tx.bulkly_error) setStatus(tx.bulkly_status === "skipped" ? "Already in receipts." : "Imported. Open Receipts to edit products or the visit.");
  }

  async function runImportAll() {
    if (!lastPayload || !lastPayload.transactions) return;
    if (importing || loadingBills) return;
    var rows = lastPayload.transactions;
    var todo = importableCount(rows);
    if (!todo) {
      setStatus("Nothing new to import.");
      syncImportAll();
      return;
    }
    importing = true;
    syncImportAll();
    var imported = 0;
    var skipped = 0;
    var failed = 0;
    try {
      await ensureFresh();
      for (var i = 0; i < rows.length; i++) {
        var tx = rows[i];
        if (!importable(tx)) {
          if (tx && tx.id && importedSet[tx.id]) skipped++;
          continue;
        }
        setStatus("Importing " + (imported + skipped + failed + 1) + " of " + todo + "…");
        try {
          await ensureReceipt(tx);
          await postImport(tx);
          if (tx.bulkly_status === "skipped") skipped++;
          else imported++;
        } catch (err) {
          tx.bulkly_error = String(err.message || err);
          failed++;
          log(tx.id, "import failed:", tx.bulkly_error);
        }
      }
      var parts = [];
      if (imported) parts.push("imported " + imported);
      if (skipped) parts.push("skipped " + skipped);
      if (failed) parts.push("failed " + failed);
      setStatus(parts.join(", ") + ". Open Receipts to edit products or the visit.");
    } finally {
      importing = false;
      render(lastPayload);
    }
  }

  async function postImport(tx) {
    log("POST import", tx.id, "source=" + (tx.source || ""));
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
      log(tx.id, "skipped duplicate");
    } else {
      tx.bulkly_status = "imported";
      tx.receipt_id = out && out.receipt_id;
      importedSet[tx.id] = true;
      log(tx.id, "imported receipt_id=" + (out && out.receipt_id));
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
    var res = await fetch(API + "/" + path.replace(/^\//, ""), {
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
    return await readJSON(await fetch(TOKEN, { method: "POST", headers: headers, body: body }));
  }

  async function ensureReceipt(tx) {
    if (tx.receipt) return;
    setStatus("Loading receipt " + (tx.receipt_num || tx.id) + "…");
    var got = await fetchTxReceipt(tx);
    tx.receipt = got.receipt;
    tx.source = got.source;
  }

  async function fetchTxReceipt(tx) {
    var id = encodeURIComponent(String(tx.id));
    log(tx.id, "details");
    var details = await apiGet("transactions/" + id + "/");
    log(tx.id, "details ok");
    return { receipt: details, source: "details" };
  }

  async function apiGet(path, query) {
    await ensureFresh();
    var t = tokens();
    var headers = {
      Authorization: "Bearer " + t.access_token,
      Accept: "application/json",
      "Accept-Language": "pl-PL"
    };
    var qs = "";
    if (query) qs = "?" + new URLSearchParams(query).toString();
    var proxyPath = path.replace(/\/$/, "");
    return await readJSON(await fetch(API + "/" + proxyPath + qs, { headers: headers }));
  }

  async function readJSON(res) {
    var text = await res.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (err) { data = text; }
    }
    if (!res.ok) {
      throw new Error(tokenError(data, res.status));
    }
    return data;
  }

  function tokenError(data, status) {
    var desc = data && data.error_description ? String(data.error_description) : "";
    var err = data && data.error ? String(data.error) : "";
    if (err === "invalid_grant" || /code not valid/i.test(desc)) {
      return "That login code is expired or already used. Click Sign in again and finish SMS right away.";
    }
    if (desc) return desc;
    if (err) return err;
    if (typeof data === "string" && data) return data.slice(0, 180);
    return "http " + status;
  }
})();
