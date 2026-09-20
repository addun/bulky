const REDIRECT_PREFIX = "app://cma20.biedronka.pl";

var ports = [];
var lastSent = { url: "", at: 0 };

function biedronkaCallbackUrl(url) {
  if (typeof url !== "string") return "";
  var idx = url.indexOf(REDIRECT_PREFIX);
  if (idx < 0) return "";
  var raw = url.slice(idx).split(/\s/)[0].replace(/[.,;"']+$/g, "");
  try {
    raw = decodeURIComponent(raw);
  } catch (err) {}
  if (raw.indexOf(REDIRECT_PREFIX) !== 0) return "";
  if (!/[?&#]code=/.test(raw)) return "";
  return raw;
}

function headerLocation(headers) {
  if (!headers) return "";
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i].name).toLowerCase() === "location") {
      return String(headers[i].value || "");
    }
  }
  return "";
}

function isBulklyImportUrl(url) {
  try {
    var u = new URL(url);
    if (u.pathname.indexOf("/imports/biedronka") !== 0) return false;
    var host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1") return u.port === "8080";
    return host === "shop.home.arpa" || host === "shop.piekna2.pl";
  } catch (err) {
    return false;
  }
}

function notifyBulkly(url) {
  ports.forEach(function (port) {
    try {
      port.postMessage({ type: "biedronka-redirect", url: url });
    } catch (err) {}
  });
  chrome.tabs.query({}, function (tabs) {
    (tabs || []).forEach(function (tab) {
      if (!tab.id || !isBulklyImportUrl(tab.url || "")) return;
      chrome.tabs.sendMessage(tab.id, { type: "biedronka-redirect", url: url }, function () {
        void chrome.runtime.lastError;
      });
    });
  });
}

function captureRedirect(url, closeTabId) {
  var callback = biedronkaCallbackUrl(url);
  if (!callback) return false;
  var now = Date.now();
  if (callback === lastSent.url && now - lastSent.at < 3000) return true;
  lastSent = { url: callback, at: now };
  notifyBulkly(callback);
  if (typeof closeTabId === "number" && closeTabId >= 0) {
    chrome.tabs.remove(closeTabId, function () {
      void chrome.runtime.lastError;
    });
  }
  return true;
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== "bulkly-biedronka") return;
  ports.push(port);
  port.onDisconnect.addListener(function () {
    ports = ports.filter(function (p) {
      return p !== port;
    });
  });
});

chrome.webRequest.onHeadersReceived.addListener(
  function (details) {
    captureRedirect(headerLocation(details.responseHeaders), details.tabId);
  },
  { urls: ["https://konto.biedronka.pl/*"], types: ["main_frame", "sub_frame"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webNavigation.onErrorOccurred.addListener(function (details) {
  if (details.frameId !== 0) return;
  if (details.error !== "net::ERR_UNKNOWN_URL_SCHEME") return;
  captureRedirect(details.url, details.tabId);
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== "biedronka-redirect" || !msg.url) return;
  var tabId = sender && sender.tab ? sender.tab.id : -1;
  captureRedirect(msg.url, tabId);
  sendResponse({ ok: true });
});
