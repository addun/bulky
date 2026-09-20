const REDIRECT_PREFIX = "app://cma20.biedronka.pl";

function hasAuthCode(url) {
  return typeof url === "string" && /[?&#]code=/.test(url);
}

function forward(url) {
  if (typeof url !== "string" || url.indexOf(REDIRECT_PREFIX) !== 0) return false;
  if (!hasAuthCode(url)) return true;
  chrome.runtime.sendMessage({ type: "biedronka-redirect", url: url }, function () {
    void chrome.runtime.lastError;
  });
  return true;
}

window.addEventListener("message", function (e) {
  if (e.source !== window) return;
  var data = e.data;
  if (!data || data.source !== "bulkly-biedronka" || !data.url) return;
  forward(data.url);
});

document.addEventListener(
  "click",
  function (e) {
    var el = e.target;
    while (el && el.tagName !== "A") el = el.parentElement;
    if (!el) return;
    var href = el.getAttribute("href") || "";
    if (!forward(href)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  true
);
