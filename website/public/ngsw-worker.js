// Ersatz für den alten Angular-Service-Worker. Bis zur Trennung lieferte pulsedeck.de die Anwendung samt Service Worker
// (ngsw-worker.js) aus; Browser mit dem alten Worker holen diese Datei beim nächsten Besuch, ersetzen den Worker durch diesen
// und melden ihn sofort ab. Danach lädt die Website normal. Entspricht dem "safety-worker.js" von @angular/service-worker.
// Kann entfernt werden, wenn niemand mehr den alten Worker hat (grob: einige Monate nach der Umstellung).
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  self.registration.unregister();
});
