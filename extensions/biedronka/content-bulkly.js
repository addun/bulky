document.documentElement.dataset.bulklyBiedronkaExt = "1";

function deliver(url) {
  if (!url) return;
  document.documentElement.setAttribute("data-bulkly-biedronka-redirect", url);
  document.documentElement.dispatchEvent(new Event("bulkly-biedronka-redirect"));
}

function connect() {
  var port = chrome.runtime.connect({ name: "bulkly-biedronka" });
  port.onMessage.addListener(function (msg) {
    if (msg && msg.type === "biedronka-redirect" && msg.url) deliver(msg.url);
  });
  port.onDisconnect.addListener(function () {
    setTimeout(connect, 400);
  });
}

connect();

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (!msg || msg.type !== "biedronka-redirect" || !msg.url) return;
  deliver(msg.url);
  sendResponse({ ok: true });
});
