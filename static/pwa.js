/* Makes the site installable: registers the small service worker (offline page and saved copies of pages already visited). Nothing is stored about the visitor. */
(function () {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () { /* the site works the same without it */ }); });
})();
