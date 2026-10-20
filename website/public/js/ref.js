/*
 * Reicht die Kennung ?ref=… aus dem Link, mit dem jemand gekommen ist (Workshop, Empfehlung, Partner), an interne Links und an die
 * Registrierung in der App weiter. Zustandslos: nichts wird gespeichert (kein Cookie, kein localStorage), die Kennung lebt nur in der
 * Adresse. Ohne gültiges ?ref= passiert nichts. Als externe Datei geladen, damit die CSP (script-src 'self') eingehalten bleibt.
 */
(function () {
  var roh = new URLSearchParams(location.search).get('ref');
  if (!roh || !/^[a-z0-9_-]{1,40}$/i.test(roh)) return;
  var ref = roh.toLowerCase();
  var skript = document.currentScript;
  var appOrigin = '';
  try {
    appOrigin = new URL((skript && skript.getAttribute('data-app')) || '').origin;
  } catch (e) {
    /* ohne App-Adresse nur interne Links ergänzen */
  }

  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    if (a.hasAttribute('download')) continue;
    var url;
    try {
      url = new URL(a.getAttribute('href'), location.href);
    } catch (e) {
      continue;
    }
    var intern = url.origin === location.origin;
    if (!intern && url.origin !== appOrigin) continue; // mailto:, fremde Seiten
    if (intern && /\.[a-z0-9]+$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) continue; // Dateien, Feeds, Sitemap
    if (intern && url.pathname === location.pathname && url.hash) continue; // Sprungmarken auf der Seite
    if (url.searchParams.has('ref')) continue;
    url.searchParams.set('ref', ref);
    a.setAttribute('href', intern ? url.pathname + url.search + url.hash : url.toString());
  }
})();
