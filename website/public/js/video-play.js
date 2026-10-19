// Play-Overlay für selbst gehostete Videos (Komponente VideoPlatzhalter.astro).
// Liegt als statische Datei in public/, weil die CSP der Website (script-src 'self') Inline-Scripts blockiert.
document.querySelectorAll('[data-video-play]').forEach((button) => {
  const video = button.parentElement ? button.parentElement.querySelector('video') : null;
  if (!video) return;

  button.addEventListener('click', () => {
    video.play();
  });

  // Beim Start verschwindet der Button, erst wenn das Video fertig ist, kommt er zurück.
  video.addEventListener('play', () => button.classList.add('hidden'));
  video.addEventListener('ended', () => button.classList.remove('hidden'));
});
