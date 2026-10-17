// PulseDeck-Spot: eine pausierte GSAP-Timeline, alle Zeiten aus timing.js (Wort-Cues der Sprecherin).
// Nur Eigenschafts-Tweens, keine Callbacks: der Renderer seekt mit unterdrückten Events.
// Registriert wird die Timeline in index.html, sobald die Schriften geladen sind.
(function () {
  const T = window.SPOT_T;
  const C = T.cues;
  const S = Object.fromEntries(T.scenes.map((s) => [s.id, s]));
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => Array.from(document.querySelectorAll(q));
  const r1 = (n) => Math.round(n * 10) / 10;
  const TAU = Math.PI * 2;

  // ---------- Pulslinie: vier Zustände mit gleicher Punktzahl, damit GSAP die Pfade direkt interpoliert ----------
  const LOGO = [[88, 272], [176, 272], [212, 168], [268, 360], [312, 216], [340, 272], [424, 272]];
  const BIG_K = 3.4;
  const big = (p) => [960 + (p[0] - 256) * BIG_K, 540 + (p[1] - 272) * BIG_K];
  const BIG = [[-60, 540], ...LOGO.map(big), [1980, 540]];
  const N = 240;

  // Punkte gleichmäßig über die Strecken verteilen, Ecken exakt behalten
  function resample(poly, n) {
    const seg = poly.slice(1).map((p, i) => Math.hypot(p[0] - poly[i][0], p[1] - poly[i][1]));
    const total = seg.reduce((a, b) => a + b, 0);
    const counts = seg.map((l) => Math.max(1, Math.round(((n - poly.length) * l) / total)));
    let diff = n - poly.length - counts.reduce((a, b) => a + b, 0);
    for (let i = 0; diff !== 0; i = (i + 1) % counts.length) {
      if (diff > 0) { counts[i] += 1; diff -= 1; } else if (counts[i] > 1) { counts[i] -= 1; diff += 1; }
    }
    const out = [];
    poly.slice(1).forEach((b, i) => {
      const a = poly[i];
      const k = counts[i] + 1;
      for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    });
    out.push(poly[poly.length - 1]);
    return out;
  }
  const bigPts = resample(BIG, N);
  const flatPts = bigPts.map((p) => [p[0], 540]);
  const MARK = { x: 455, y: 430, s: 220 };
  const iconPts = bigPts.map(([X, Y]) => {
    const x = Math.min(424, Math.max(88, 256 + (X - 960) / BIG_K));
    const y = X < 388 || X > 1532 ? 272 : 272 + (Y - 540) / BIG_K;
    return [MARK.x + (x * MARK.s) / 512, MARK.y + (y * MARK.s) / 512];
  });
  // Chaos: verknotete Linie, die sich trotzdem von links nach rechts bewegt (deterministisch, ohne Zufall)
  const scribblePts = flatPts.map((_, i) => {
    const u = i / (N - 1);
    const x = -60 + 2040 * u + 250 * Math.sin(u * TAU * 7.3 + 0.6) + 95 * Math.sin(u * TAU * 16.1 + 2.1);
    const y = 540 + 230 * Math.sin(u * TAU * 4.1 + 1.2) + 110 * Math.cos(u * TAU * 10.7 + 0.3) + 50 * Math.sin(u * TAU * 21.0);
    return [x, y];
  });
  const toD = (pts) => 'M' + pts.map((p) => `${r1(p[0])} ${r1(p[1])}`).join(' L');
  const WIPE = resample([[-60, 540], [760, 540], [840, 430], [940, 650], [1010, 470], [1060, 540], [1980, 540]], 120);

  // Position eines Elements relativ zu einem Vorfahren (ohne Transforms, daher vor dem Aufbau gemessen)
  function offsetIn(el, anc) {
    let x = 0;
    let y = 0;
    for (let e = el; e && e !== anc; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  function build() {
    gsap.registerPlugin(CustomEase, DrawSVGPlugin, SplitText);
    $('#scribble-path').setAttribute('d', toD(scribblePts));
    $('#wipe-path').setAttribute('d', toD(WIPE));

    // ---------- Messungen vor allen Transforms ----------
    // Der Runtime blendet inaktive Szenen aus; zum Messen kurz ins Layout holen, ohne sie zu zeigen.
    const scenes = $$('section.scene');
    const saved = scenes.map((el) => [el.style.getPropertyValue('display'), el.style.getPropertyPriority('display'), el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
    scenes.forEach((el) => { el.style.setProperty('display', 'block', 'important'); el.style.setProperty('visibility', 'hidden', 'important'); });
    const hookBubbles = $$('#hook-list .b');
    const hookBodyH = $('#hook-phone .chat-body').clientHeight;
    const bubbleBottoms = hookBubbles.map((b) => b.offsetTop + b.offsetHeight + 18);
    const pollH = $('#feed-poll').offsetHeight + 26;
    const shiftsCam = $('#shifts-cam');
    const linkBtn = offsetIn($('#ev-btn-link'), shiftsCam);
    const joinA = offsetIn($('#sa-join'), shiftsCam);
    scenes.forEach((el, i) => {
      const [d, dp, v, vp] = saved[i];
      if (d) el.style.setProperty('display', d, dp); else el.style.removeProperty('display');
      if (v) el.style.setProperty('visibility', v, vp); else el.style.removeProperty('visibility');
    });

    // Jede Kamera bekommt eine innere Drift-Ebene: langsames Atmen statt Standbild
    $$('.cam').forEach((cam) => {
      const drift = document.createElement('div');
      drift.className = 'drift';
      while (cam.firstChild) drift.appendChild(cam.firstChild);
      cam.appendChild(drift);
    });

    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
    T.scenes.forEach((sc, i) => {
      const d = $(`#s-${sc.id} .drift`);
      if (d) tl.fromTo(d, { scale: 1, x: 0 }, { scale: 1.045, x: i % 2 ? -14 : 14, duration: sc.end - sc.start, ease: 'none' }, sc.start);
    });
    const end = T.total;

    // Übergang: die Pulslinie zieht einmal durchs Bild
    function wipe(t) {
      tl.fromTo('#wipe-path', { drawSVG: '0% 0%', opacity: 1 }, { drawSVG: '0% 100%', duration: 0.36, ease: 'power2.in', immediateRender: false }, t);
      tl.to('#wipe-path', { drawSVG: '100% 100%', duration: 0.42, ease: 'power2.out' }, t + 0.36);
    }
    tl.set('#wipe-path', { drawSVG: '0% 0%' }, 0);

    // ---------- Grund ----------
    tl.fromTo('#glow-red', { opacity: 0.55, scale: 1 }, { opacity: 1, scale: 1.18, duration: C['turn.start'] - 0.5, ease: 'sine.in' }, 0);
    tl.to('#glow-red', { opacity: 0.18, duration: 0.8, ease: 'power2.out' }, C['turn.start'] - 0.4);
    tl.to('#glow-red', { opacity: 0.85, scale: 1, duration: 1.2, ease: 'power2.out' }, C['brand.brand'] - 0.1);
    tl.fromTo('#glow-red', { x: 0, y: 0 }, { x: 160, y: 110, duration: end, ease: 'sine.inOut' }, 0);
    tl.fromTo('#glow-teal', { x: 0, y: 0, opacity: 0.5 }, { x: -180, y: -90, opacity: 1, duration: end, ease: 'sine.inOut' }, 0);
    tl.fromTo('#grid', { opacity: 0 }, { opacity: 0.7, duration: 1.5 }, C['claim.start']);
    tl.to('#grid', { backgroundPosition: '0px -192px', duration: end - C['claim.start'], ease: 'none' }, C['claim.start']);

    // =====================================================================
    // 1 Chaos im Vereinschat
    // =====================================================================
    const tImp = C['turn.start'] - 0.55;
    tl.fromTo('#hook-phone', { y: 90, scale: 0.94, opacity: 0, rotation: -2 }, { y: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.9, ease: 'expo.out' }, 0.05);
    tl.fromTo('#hook-cam', { scale: 1 }, { scale: 1.1, duration: tImp, ease: 'sine.in' }, 0);

    let listY = 0;
    hookBubbles.forEach((b, k) => {
      const t = T.ev.bubbles[k];
      const me = b.classList.contains('me');
      tl.fromTo(b, { opacity: 0, scale: 0.5, y: 24 }, { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: 'back.out(2.2)', transformOrigin: me ? '100% 100%' : '0% 100%' }, t);
      const target = Math.min(0, hookBodyH - bubbleBottoms[k]);
      if (target < listY) {
        tl.to('#hook-list', { y: target, duration: 0.28, ease: 'power2.out' }, t);
        listY = target;
      }
      if (T.ev.bubbles[k] < C['hook.n300']) tl.set('#hook-badge', { innerText: 4 + k * 3 }, t);
    });
    tl.set('#hook-plus', { opacity: 0 }, 0);

    tl.fromTo('#hook-day .kicker', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5 }, C['hook.sommerfest'] - 0.45);
    tl.fromTo('#hook-day .word', { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: 'expo.out' }, C['hook.sommerfest'] - 0.3);
    tl.fromTo('#hook-day-ul path', { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.5, ease: 'power2.inOut' }, C['hook.sommerfest'] + 0.25);

    $$('#hook-toasts .toast').forEach((el, i) => {
      tl.fromTo(el, { x: 180, opacity: 0, scale: 0.95 }, { x: 0, opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' }, C['hook.chat'] + i * 0.3);
    });

    tl.fromTo('#hook-300', { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'expo.out' }, C['hook.n300'] - 0.1);
    tl.fromTo('#hook-300', { innerText: 0 }, { innerText: 300, snap: { innerText: 1 }, duration: 0.9, ease: 'power2.out' }, C['hook.n300'] - 0.1);
    tl.fromTo('#hook-300-label', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5 }, C['hook.n300'] + 0.25);
    tl.to('#hook-badge', { innerText: 300, snap: { innerText: 1 }, duration: 0.9, ease: 'power2.out' }, C['hook.n300'] - 0.1);
    tl.to('#hook-plus', { opacity: 1, duration: 0.1 }, C['hook.n300'] + 0.8);

    [['#q1', -6, 'hook.q1'], ['#q2', 4, 'hook.q2'], ['#q3', -3, 'hook.q3']].forEach(([q, rot, cue]) => {
      tl.fromTo(q, { opacity: 0, scale: 1.6, rotation: rot + 7 }, { opacity: 1, scale: 1, rotation: rot, duration: 0.45, ease: 'expo.out' }, C[cue] - 0.06);
      tl.fromTo(`${q} path`, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.5, ease: 'power2.inOut' }, C[cue] + 0.12);
      tl.to('#hook-cam', { x: 8, y: -6, rotation: 0.4, duration: 0.05, repeat: 7, yoyo: true, ease: 'none' }, C[cue]);
    });

    tl.fromTo('#scribble-path', { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: tImp - C['hook.chat'], ease: 'power1.in' }, C['hook.chat']);
    tl.fromTo('#hook-scribble', { opacity: 0.35 }, { opacity: 1, duration: tImp - C['hook.chat'], ease: 'none' }, C['hook.chat']);

    // Alles zieht sich zusammen, nur die Linie bleibt
    tl.to(['#hook-phone', '#hook-toasts', '#q1', '#q2', '#q3', '#hook-day', '#hook-300', '#hook-300-label'], { scale: 0.72, opacity: 0, filter: 'blur(12px)', duration: 0.5, ease: 'power3.in', stagger: 0.02 }, tImp);

    // =====================================================================
    // 2 Durchatmen -> Puls -> Logo
    // =====================================================================
    const tSwap = C['turn.start'] - 0.1;
    const tBr = C['brand.brand'];
    // Kritzelei in Bildschirmkoordinaten zum Übergabezeitpunkt: Kamera (1.1) mal Drift-Ebene
    const pDrift = (tSwap - S.hook.start) / (S.hook.end - S.hook.start);
    const ds = 1 + 0.045 * pDrift;
    const dx = 14 * pDrift;
    const scribbleScreen = scribblePts.map(([x, y]) => [960 + 1.1 * (ds * (x - 960) + dx), 540 + 1.1 * ds * (y - 540)]);
    tl.set('#pulse-path, #pulse-glow', { opacity: 0, attr: { d: toD(scribbleScreen) } }, 0);
    tl.set('#hook-scribble', { visibility: 'hidden' }, tSwap);
    tl.set('#pulse-path', { opacity: 1 }, tSwap);
    tl.set('#pulse-glow', { opacity: 0.6 }, tSwap);
    tl.fromTo('#pulse-path', { stroke: '#ff1f1f', strokeWidth: 5 }, { strokeWidth: 10, duration: 1.0, ease: 'power2.inOut', immediateRender: false }, tSwap);
    tl.to('#pulse-path, #pulse-glow', { attr: { d: toD(flatPts) }, duration: 0.95, ease: 'power3.inOut' }, tSwap + 0.02);

    const tBreOut = C['brand.das'] - 0.3;
    const tBreIn = C['turn.start'] + 0.4;
    tl.fromTo('#turn-breathe', { opacity: 0, letterSpacing: '0.62em', y: 12 }, { opacity: 1, letterSpacing: '0.32em', y: 0, duration: Math.min(0.9, tBreOut - tBreIn - 0.05), ease: 'power2.out' }, tBreIn);
    tl.to('#turn-breathe', { opacity: 0, y: -24, duration: 0.35, ease: 'power2.in' }, tBreOut);

    tl.to('#pulse-path, #pulse-glow', { attr: { d: toD(bigPts) }, duration: 0.34, ease: 'expo.out' }, tBr - 0.3);
    tl.fromTo('#flash', { opacity: 0 }, { opacity: 0.12, duration: 0.06, yoyo: true, repeat: 1, ease: 'none' }, tBr - 0.06);
    tl.to('#pulse-path, #pulse-glow', { attr: { d: toD(iconPts) }, duration: 0.62, ease: 'power3.inOut' }, tBr + 0.14);
    tl.to('#pulse-path', { stroke: '#ffffff', strokeWidth: (44 * MARK.s) / 512, duration: 0.5, ease: 'power2.inOut' }, tBr + 0.2);
    tl.to('#pulse-glow', { opacity: 0, duration: 0.4 }, tBr + 0.3);
    tl.fromTo('#turn-rect', { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.6, ease: 'back.out(1.5)' }, tBr + 0.3);
    tl.set('#turn-icon-line', { opacity: 0 }, 0);
    tl.set('#turn-icon-line', { opacity: 1 }, tBr + 0.8);
    tl.set('#pulse-path', { opacity: 0 }, tBr + 0.8);
    tl.fromTo('#turn-word', { xPercent: -105 }, { xPercent: 0, duration: 0.75, ease: 'expo.out' }, tBr + 0.42);
    tl.to('#turn-logo', { y: -70, scale: 0.86, opacity: 0, duration: 0.45, ease: 'power3.in', transformOrigin: '50% 50%' }, C['claim.start'] - 0.42);

    // =====================================================================
    // 3 Euer Chat bleibt. Das Chaos geht.
    // =====================================================================
    const tCl = C['claim.start'];
    tl.fromTo('#claim-phone', { x: -600, rotationY: 32, opacity: 0, transformPerspective: 1600 }, { x: 0, rotationY: 9, opacity: 1, duration: 1.0, ease: 'expo.out' }, tCl - 0.35);
    tl.to('#claim-phone', { rotationY: 3, duration: S.claim.end - tCl, ease: 'sine.inOut' }, tCl + 0.65);
    $$('#claim-list .b').forEach((b, k) => {
      tl.fromTo(b, { opacity: 0, scale: 0.6, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 0.32, ease: 'back.out(2)', transformOrigin: b.classList.contains('me') ? '100% 100%' : '0% 100%' }, tCl - 0.05 + k * 0.34);
    });
    const l1 = [...$$('#claim-l1 .word'), $('#claim-l1b .word')];
    [C['claim.a'], C['claim.a'] + 0.17, C['claim.bleibt'] - 0.05].forEach((t, i) => {
      tl.fromTo(l1[i], { yPercent: 115 }, { yPercent: 0, duration: 0.6, ease: 'expo.out' }, t);
    });
    const chaos = new SplitText('#claim-chaos', { type: 'chars' }).chars;
    tl.fromTo('#claim-l2 > .word.grad', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }, C['claim.b'] - 0.05);
    tl.fromTo(chaos, { opacity: 0, y: (i) => [-46, 34, -28, 50, -34][i], rotation: (i) => [-20, 16, -12, 22, -16][i] }, { opacity: 1, y: 0, rotation: 0, duration: 0.55, ease: 'back.out(2.2)', stagger: 0.04 }, C['claim.b'] + 0.12);
    tl.fromTo('#claim-l3 .word', { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' }, C['claim.geht'] - 0.05);
    tl.fromTo('#claim-strike path', { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.32, ease: 'power2.out' }, C['claim.geht'] + 0.1);
    tl.to('#claim-chaos', { opacity: 0.3, duration: 0.4 }, C['claim.geht'] + 0.3);
    tl.fromTo('.claim-sub', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6 }, C['claim.geht'] + 0.45);
    tl.fromTo('#claim-cam', { scale: 1 }, { scale: 1.035, duration: S.claim.end - S.claim.start, ease: 'none' }, S.claim.start);

    // Übergang zum Feed
    const tF0 = S.feed.start;
    wipe(tF0 - 0.05);
    tl.to('#claim-cam', { x: -260, opacity: 0, filter: 'blur(8px)', duration: 0.38, ease: 'power3.in' }, tF0);

    // =====================================================================
    // 4 Feed, Umfragen, Newsletter, Push
    // =====================================================================
    tl.fromTo('#feed-win', { x: 560, rotationY: -38, rotationX: 10, opacity: 0, transformPerspective: 2400, transformOrigin: '0% 50%' }, { x: 0, rotationY: -12, rotationX: 4, opacity: 1, duration: 1.1, ease: 'expo.out' }, tF0 + 0.32);
    tl.fromTo('#feed-text .kicker', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5 }, tF0 + 0.3);
    const fw = $$('#feed-text h2 .word');
    tl.fromTo(fw[0], { yPercent: 115 }, { yPercent: 0, duration: 0.6, ease: 'expo.out' }, C['feed.feed'] - 0.35);
    tl.fromTo(fw[1], { yPercent: 115 }, { yPercent: 0, duration: 0.6, ease: 'expo.out' }, C['feed.bleibt'] - 0.05);
    tl.fromTo(fw[2], { yPercent: 115 }, { yPercent: 0, duration: 0.6, ease: 'expo.out' }, C['feed.bleibt'] + 0.15);
    tl.fromTo('#feed-text p', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, C['feed.bleibt'] + 0.45);

    tl.fromTo(['#feed-p2', '#feed-p3'], { y: -pollH }, { y: 0, duration: 0.65, ease: 'power3.inOut' }, C['feed.feed'] - 0.1);
    tl.fromTo('#feed-poll', { opacity: 0, y: -30, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'expo.out' }, C['feed.feed']);
    tl.fromTo('#feed-pinflag', { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2.5)' }, C['feed.bleibt']);
    tl.to('#feed-pin', { color: '#ff0000', backgroundColor: 'rgba(255,0,0,0.12)', duration: 0.3 }, C['feed.bleibt']);
    tl.fromTo('#feed-seen', { innerText: 0 }, { innerText: 41, snap: { innerText: 1 }, duration: S.feed.end - C['feed.feed'], ease: 'power1.out' }, C['feed.feed']);

    tl.to('#feed-win', { rotationY: -5, rotationX: 2, scale: 1.1, x: -150, y: -60, duration: 1.3, ease: 'power3.inOut' }, C['feed.poll'] - 0.3);
    tl.fromTo('#opt-1 .rad i', { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, C['feed.poll']);
    [0.56, 0.33, 0.11].forEach((v, i) => {
      const t = C['feed.poll'] + 0.1 + i * 0.08;
      tl.fromTo(`#opt-${i + 1} .opt-fill`, { scaleX: 0 }, { scaleX: v, duration: 1.0, ease: 'power3.out' }, t);
      tl.fromTo(`#pc-${i + 1}`, { innerText: 0 }, { innerText: Math.round(v * 100), snap: { innerText: 1 }, duration: 1.0, ease: 'power3.out' }, t);
    });
    tl.fromTo('#feed-votes', { innerText: 0 }, { innerText: 9, snap: { innerText: 1 }, duration: 1.0, ease: 'power2.out' }, C['feed.poll'] + 0.1);

    tl.fromTo('#feed-mail', { x: 280, y: 140, rotation: 9, opacity: 0, scale: 0.88 }, { x: 0, y: 0, rotation: -4, opacity: 1, scale: 1, duration: 0.75, ease: 'expo.out' }, C['feed.news'] - 0.1);
    tl.fromTo('#feed-phone', { y: 980, rotation: 12 }, { y: 0, rotation: 4, duration: 0.8, ease: 'expo.out' }, C['feed.push'] - 0.5);
    tl.fromTo('#feed-push', { y: -50, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.8)' }, C['feed.push'] + 0.05);
    tl.to('#feed-push', { scale: 1.05, duration: 0.14, yoyo: true, repeat: 1, ease: 'power2.out' }, C['feed.zaehlt']);

    // Übergang: Reißschwenk nach links
    const tS0 = S.shifts.start;
    tl.to('#feed-cam', { x: -760, opacity: 0, filter: 'blur(14px)', duration: 0.5, ease: 'power3.in' }, tS0);

    // =====================================================================
    // 5 Termin, Schichten, Link teilen, selbst eintragen
    // =====================================================================
    tl.fromTo('#shifts-cam', { x: 760, opacity: 0, filter: 'blur(14px)' }, { x: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out' }, tS0 + 0.35);
    tl.fromTo('#shifts-steps .kicker', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5 }, tS0 + 0.45);
    [['#step-1', 'shifts.termin'], ['#step-2', 'shifts.schichten'], ['#step-3', 'shifts.link']].forEach(([s, cue]) => {
      tl.fromTo(`${s} .step-n`, { scale: 0 }, { scale: 1, duration: 0.45, ease: 'back.out(2.4)' }, C[cue] - 0.12);
      tl.fromTo(`${s} b`, { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.55, ease: 'expo.out' }, C[cue] - 0.06);
    });
    tl.fromTo('#step-sub', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, C['shifts.jeder'] - 0.1);
    $$('#shifts-sketch .sk').forEach((p, i) => {
      tl.fromTo(p, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.9, ease: 'power1.inOut' }, C['shifts.termin'] + i * 0.55);
    });

    tl.fromTo('#shift-ev', { y: -40, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' }, C['shifts.termin'] - 0.05);
    tl.fromTo(['#shift-a', '#shift-b'], { y: 90, opacity: 0, rotationX: 28, transformPerspective: 1600, transformOrigin: '50% 0%' }, { y: 0, opacity: 1, rotationX: 0, duration: 0.75, ease: 'expo.out', stagger: 0.14 }, C['shifts.schichten'] - 0.05);
    tl.set(['#sa-bar', '#sb-bar'], { scaleX: 0 }, 0);
    tl.set(['#sa-avs .av', '#sb-avs .av'], { scale: 0 }, 0);

    // Cursor klickt "Link teilen", das Telefon zeigt den Link im Gruppenchat
    const cx = (b) => b.x + b.w / 2 - 6;
    const cy = (b) => b.y + b.h / 2 - 4;
    tl.fromTo('#cursor-1', { x: 1960, y: 760, opacity: 1 }, { x: cx(linkBtn), y: cy(linkBtn), duration: 0.6, ease: 'power3.inOut' }, C['shifts.link'] - 0.55);
    tl.fromTo('#cursor-1', { scale: 1 }, { scale: 0.85, duration: 0.08, yoyo: true, repeat: 1, ease: 'none' }, C['shifts.link'] + 0.05);
    tl.set('#ripple-1', { opacity: 0 }, 0);
    tl.fromTo('#ripple-1', { x: cx(linkBtn), y: cy(linkBtn), scale: 0.2, opacity: 0.9 }, { scale: 1.2, opacity: 0, duration: 0.5, ease: 'power2.out', immediateRender: false }, C['shifts.link'] + 0.07);
    tl.to('#ev-btn-link', { backgroundColor: 'rgba(255,0,0,0.22)', color: '#ff5050', duration: 0.15 }, C['shifts.link'] + 0.05);
    tl.fromTo('#shifts-phone', { y: 0, rotation: 6 }, { y: -590, rotation: -4, duration: 0.75, ease: 'expo.out' }, C['shifts.link'] + 0.2);
    tl.fromTo('#shifts-linkb', { scale: 0.55, opacity: 0, transformOrigin: '100% 100%' }, { scale: 1, opacity: 1, duration: 0.42, ease: 'back.out(2)' }, C['shifts.gruppe'] - 0.15);
    tl.to('#shifts-phone', { y: 0, rotation: 8, duration: 0.55, ease: 'power3.in' }, C['shifts.jeder'] - 0.35);

    // Mitglieder tragen sich ein
    const avA = $$('#sa-avs .av');
    const avB = $$('#sb-avs .av');
    for (let k = 0; k < 5; k++) {
      const t = C['shifts.jeder'] + 0.05 + k * 0.17;
      tl.to(avA[k], { scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, t);
      tl.set('#sa-c', { innerText: k + 1 }, t);
      tl.to('#sa-bar', { scaleX: (k + 1) / 6, duration: 0.3, ease: 'power2.out' }, t);
    }
    for (let k = 0; k < 3; k++) {
      const t = C['shifts.jeder'] + 0.13 + k * 0.22;
      tl.to(avB[k], { scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, t);
      tl.set('#sb-c', { innerText: k + 1 }, t);
      tl.to('#sb-bar', { scaleX: (k + 1) / 3, duration: 0.3, ease: 'power2.out' }, t);
    }
    const fullB = C['shifts.jeder'] + 0.13 + 2 * 0.22 + 0.25;
    tl.to('#sb-bar', { backgroundColor: '#f87171', duration: 0.3 }, fullB);
    tl.to('#sb-n', { color: '#f87171', duration: 0.3 }, fullB);
    tl.fromTo('#sb-full', { opacity: 0 }, { opacity: 1, duration: 0.3 }, fullB);

    // "Einer klickt, Schicht besetzt."
    tl.to('#cursor-1', { x: cx(joinA), y: cy(joinA), duration: 0.55, ease: 'power3.inOut' }, C['shifts.klickt'] - 0.7);
    tl.to('#cursor-1', { scale: 0.85, duration: 0.08, yoyo: true, repeat: 1, ease: 'none' }, C['shifts.klickt']);
    tl.fromTo('#ripple-1', { x: cx(joinA), y: cy(joinA), scale: 0.2, opacity: 0.9 }, { scale: 1.4, opacity: 0, duration: 0.5, ease: 'power2.out', immediateRender: false }, C['shifts.klickt'] + 0.02);
    tl.to(avA[5], { scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, C['shifts.klickt'] + 0.05);
    tl.set('#sa-c', { innerText: 6 }, C['shifts.klickt'] + 0.05);
    tl.to('#sa-bar', { scaleX: 1, backgroundColor: '#f87171', duration: 0.35, ease: 'power2.out' }, C['shifts.klickt'] + 0.05);
    tl.fromTo('#sa-full', { opacity: 0 }, { opacity: 1, duration: 0.3 }, C['shifts.klickt'] + 0.2);
    tl.to('#cursor-1', { x: '+=160', y: '+=190', opacity: 0, duration: 0.6, ease: 'power2.in' }, C['shifts.besetzt'] + 0.2);
    tl.fromTo('#shift-check path', { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.42, ease: 'power2.out' }, C['shifts.besetzt'] - 0.05);
    tl.to('#shift-a', { scale: 1.03, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' }, C['shifts.besetzt'] - 0.05);

    // Übergang: Zoom durch
    const tA0 = S.activ.start;
    tl.to('#shifts-cam', { scale: 1.4, opacity: 0, filter: 'blur(10px)', duration: 0.55, ease: 'power3.in' }, tA0);

    // =====================================================================
    // 6 Aus Mitgliedern werden Aktive
    // =====================================================================
    const people = $('#activ-people');
    const persons = [];
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 22; col++) {
        const x = 40 + col * 86 + (row % 2) * 43;
        const y = 40 + row * 88;
        if (x > 120 && x < 1740 && y > 300 && y < 1060) continue;
        if (x > 1860) continue;
        const d = document.createElement('div');
        d.className = 'person';
        d.style.left = `${x}px`;
        d.style.top = `${y}px`;
        d.innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke-width="3" stroke-linecap="round"><circle cx="32" cy="22" r="10"/><path d="M12 54 C 12 38, 52 38, 52 54"/></svg>';
        people.appendChild(d);
        persons.push(d);
      }
    }
    const pSvgs = persons.map((p) => p.firstChild);
    tl.set(pSvgs, { stroke: 'rgba(255,255,255,0.16)' }, 0);
    tl.fromTo('#activ-cam', { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'expo.out' }, tA0 + 0.25);
    tl.fromTo('#activ-head .kicker', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, tA0 + 0.35);
    tl.fromTo(persons, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.4, stagger: { each: 0.004, from: 'center' } }, C['activ.mitgliedern'] - 0.3);
    const aw = $$('#activ-head .word');
    tl.fromTo(aw.slice(0, 3), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out', stagger: 0.12 }, C['activ.start'] - 0.05);
    tl.fromTo(aw[3], { opacity: 0, y: 40, scale: 1.2 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'expo.out' }, C['activ.aktive'] - 0.05);
    tl.to(pSvgs, { stroke: '#ff2e2e', duration: 0.3, stagger: { each: 0.006, from: 'center' } }, C['activ.aktive']);
    tl.to(persons, { y: -10, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out', stagger: { each: 0.006, from: 'center' } }, C['activ.aktive']);

    tl.fromTo('#activ-board', { y: 160, rotationX: 24, opacity: 0, transformPerspective: 2200, transformOrigin: '50% 0%' }, { y: 0, rotationX: 0, opacity: 1, duration: 1.0, ease: 'expo.out' }, C['activ.mitgliedern'] - 0.1);
    tl.set('#mt-1, #mt-2', { opacity: 0 }, 0);
    const badges = $$('#activ-quest .badge');
    badges.forEach((b, i) => {
      if (i === 2) return;
      tl.set([b.querySelector('.done'), b.querySelector('small')], { opacity: 0 }, 0);
      tl.set(b.querySelector('.pi-check'), { scale: 0 }, 0);
    });
    const tQ = C['activ.quest'];
    tl.to('#activ-head', { y: -150, opacity: 0, duration: 0.7, ease: 'power3.in' }, tQ - 0.3);
    tl.to('#activ-people', { y: -120, opacity: 0.35, duration: 1.2, ease: 'power3.inOut' }, tQ - 0.3);
    tl.to('#activ-cam', { scale: 1.08, y: -150, duration: 1.4, ease: 'power3.inOut' }, tQ - 0.25);
    tl.fromTo('#quest-bar', { scaleX: 0.2 }, { scaleX: 1, duration: 1.35, ease: 'power2.inOut' }, tQ + 0.15);
    tl.fromTo('#quest-pct', { innerText: 20 }, { innerText: 100, snap: { innerText: 1 }, duration: 1.35, ease: 'power2.inOut' }, tQ + 0.15);
    [0, 1, 3, 4].forEach((i, j) => {
      const b = badges[i];
      const t = tQ + 0.25 + j * 0.3;
      tl.to(b.querySelector('.done'), { opacity: 1, duration: 0.25 }, t);
      tl.to(b.querySelector('.pi-check'), { scale: 1, duration: 0.4, ease: 'back.out(3)' }, t);
      tl.to(b.querySelector('small'), { opacity: 1, duration: 0.3 }, t + 0.1);
    });
    tl.to('#activ-cam', { scale: 1.04, y: -250, duration: 1.1, ease: 'power3.inOut' }, C['activ.micro'] - 0.35);
    tl.fromTo(['#mt-1', '#mt-2'], { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out', stagger: 0.15 }, C['activ.micro'] - 0.1);
    ['#sk-1', '#sk-2', '#sk-3'].forEach((s, i) => {
      tl.to(s, { borderColor: '#ff0000', backgroundColor: 'rgba(255,0,0,0.14)', color: '#ff5050', duration: 0.25 }, C['activ.skills'] - 0.3 + i * 0.14);
    });
    tl.to('#mt-1', { borderColor: 'rgba(255,0,0,0.55)', boxShadow: '0 0 0 1px rgba(255,0,0,0.4), 0 24px 70px rgba(255,0,0,0.18)', duration: 0.4 }, C['activ.skills'] + 0.1);

    // Übergang: nach oben schieben
    const tW0 = S.wissen.start;
    tl.to('#activ-cam', { y: '-=520', opacity: 0, duration: 0.55, ease: 'power3.in' }, tW0);

    // =====================================================================
    // 7 Wissen bleibt: Wiki, Dateien, Arbeitsgruppen, KI
    // =====================================================================
    tl.fromTo('#wissen-cam', { y: 520, opacity: 0 }, { y: 0, opacity: 1, duration: 0.75, ease: 'expo.out' }, tW0 + 0.25);
    tl.fromTo('#wissen-head .kicker', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5 }, tW0 + 0.35);
    const ww = $$('#wissen-head .word');
    tl.fromTo(ww.slice(0, 2), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out', stagger: 0.12 }, C['wissen.start'] - 0.05);
    tl.fromTo(ww[2], { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out' }, C['wissen.bleibt'] - 0.05);

    tl.fromTo('#wiki-panel', { y: 70, opacity: 0, rotationY: 14, transformPerspective: 1800 }, { y: 0, opacity: 1, rotationY: 0, duration: 0.7, ease: 'expo.out' }, C['wissen.wiki'] - 0.2);
    tl.fromTo(['#ws-1', '#ws-2', '#ws-3'], { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.18 }, C['wissen.wiki'] + 0.1);
    tl.fromTo('#files-panel', { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, ease: 'expo.out' }, C['wissen.dateien'] - 0.2);
    tl.fromTo(['#f-1', '#f-2', '#f-3'], { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.1 }, C['wissen.dateien'] - 0.05);
    tl.fromTo('#groups-panel', { y: 70, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, ease: 'expo.out' }, C['wissen.ag'] - 0.2);
    tl.fromTo(['#g-1', '#g-2', '#g-3'], { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.1 }, C['wissen.ag'] - 0.05);

    tl.fromTo('#ai-panel', { x: 300, opacity: 0 }, { x: 0, opacity: 1, duration: 0.75, ease: 'expo.out' }, C['wissen.wunsch'] - 0.2);
    // Fokus auf den KI-Assistenten: das Panel wächst, der Rest tritt zurück
    tl.to(['#wiki-panel', '#files-panel', '#groups-panel', '#wissen-head', '#wissen-key'], { opacity: 0.38, x: -40, duration: 0.9, ease: 'power3.inOut' }, C['wissen.wunsch'] - 0.1);
    tl.to('#ai-panel', { scale: 1.12, x: -40, transformOrigin: '100% 50%', boxShadow: '0 60px 160px rgba(0,0,0,0.85), 0 0 0 1px rgba(139,92,246,0.35)', duration: 0.9, ease: 'power3.inOut' }, C['wissen.wunsch'] - 0.1);
    const tAsk = C['wissen.wunsch'] + 0.25;
    const tAns = Math.min(C['wissen.ki'] + 0.45, C['wissen.doku'] - 0.2);
    tl.fromTo('#ai-q', { opacity: 0, scale: 0.7, transformOrigin: '100% 0%' }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)' }, tAsk);
    tl.fromTo('#ai-dots', { opacity: 0 }, { opacity: 1, duration: 0.2 }, tAsk + 0.35);
    tl.fromTo('#ai-dots i', { y: 0 }, { y: -8, duration: 0.16, yoyo: true, repeat: 3, stagger: 0.07, ease: 'sine.inOut' }, tAsk + 0.4);
    tl.to('#ai-dots', { opacity: 0, duration: 0.15 }, tAns - 0.05);
    tl.fromTo('#ai-a', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.35 }, tAns);
    const aiWords = new SplitText('#ai-a-text', { type: 'words' }).words;
    tl.fromTo(aiWords, { opacity: 0 }, { opacity: 1, duration: 0.12, stagger: 0.035, ease: 'none' }, tAns + 0.04);
    tl.fromTo('#ai-src', { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, tAns + 0.04 + aiWords.length * 0.035);
    tl.to('#ws-3', { opacity: 1, backgroundColor: 'rgba(255,0,0,0.09)', boxShadow: 'inset 4px 0 0 #ff0000', duration: 0.4 }, tAns + 0.3);
    tl.fromTo('#wissen-key path, #wissen-key circle', { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.6, stagger: 0.1, ease: 'power2.inOut' }, tAns + 0.1);

    // Übergang zum Datenschutz
    const tT0 = S.trust.start;
    wipe(tT0 - 0.05);
    tl.to('#wissen-cam', { scale: 0.92, opacity: 0, duration: 0.36, ease: 'power3.in' }, tT0);

    // =====================================================================
    // 8 Vertrauen
    // =====================================================================
    tl.fromTo('#trust-head .kicker', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5 }, tT0 + 0.4);
    [['#tt-1', 'trust.de'], ['#tt-2', 'trust.tel'], ['#tt-3', 'trust.track'], ['#tt-4', 'trust.os']].forEach(([el, cue]) => {
      const t = Math.max(C[cue] - 0.1, tT0 + 0.42);
      tl.fromTo(el, { opacity: 0, scale: 1.12, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'expo.out' }, t);
      tl.fromTo(`${el} .tt-ic`, { scale: 0.4 }, { scale: 1, duration: 0.5, ease: 'back.out(2.6)' }, t + 0.05);
      tl.fromTo(`${el} .sketch > *`, { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.6, stagger: 0.08, ease: 'power2.inOut' }, t + 0.2);
    });
    tl.fromTo('#trust-cam', { scale: 1 }, { scale: 1.035, duration: S.trust.end - tT0, ease: 'none' }, tT0);

    // Übergang: die Kacheln fallen zur Mitte, das Logo kommt
    const tC0 = S.cta.start;
    tl.to(['#tt-1', '#tt-2', '#tt-3', '#tt-4'], { scale: 0.8, opacity: 0, duration: 0.45, ease: 'power3.in', stagger: 0.04 }, tC0);
    tl.to('#trust-head', { opacity: 0, duration: 0.3 }, tC0);

    // =====================================================================
    // 9 Abschluss
    // =====================================================================
    const tB = C['cta.brand'];
    tl.fromTo('#cta-logo .logo-mark', { scale: 0, rotation: -14 }, { scale: 1, rotation: 0, duration: 0.75, ease: 'back.out(1.6)' }, tB - 0.3);
    tl.fromTo('#cta-icon-line', { drawSVG: '0% 0%' }, { drawSVG: '0% 100%', duration: 0.6, ease: 'power2.inOut' }, tB - 0.1);
    tl.fromTo('#cta-word', { opacity: 0, x: -40, clipPath: 'inset(0% 100% 0% 0%)' }, { opacity: 1, x: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.75, ease: 'expo.out' }, tB + 0.1);
    tl.fromTo('#cta-l1', { yPercent: 115 }, { yPercent: 0, duration: 0.65, ease: 'expo.out' }, C['cta.mitglieder'] - 0.1);
    tl.fromTo('#cta-l2', { yPercent: 115 }, { yPercent: 0, duration: 0.65, ease: 'expo.out' }, C['cta.info'] - 0.15);
    tl.fromTo('#cta-btn', { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.55, ease: 'back.out(2)' }, C['cta.jetzt'] - 0.1);
    tl.fromTo('#cta-url', { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.5, ease: 'expo.out' }, C['cta.url'] - 0.25);
    tl.fromTo('#cta-ea', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, C['cta.url'] + 0.2);
    // Zum Schluss schlägt der Puls zweimal; dahinter läuft eine EKG-Linie, ihr Ausschlag trifft den Herzschlag
    const tBeat = end - 1.25;
    $('#cta-ecg-path').setAttribute('d', toD(resample([[-60, 1000], [860, 1000], [900, 952], [948, 1052], [988, 972], [1014, 1000], [1980, 1000]], 120)));
    tl.set('#cta-ecg-path', { drawSVG: '0% 0%' }, 0);
    tl.fromTo('#cta-ecg-path', { drawSVG: '0% 0%' }, { drawSVG: '0% 16%', duration: 0.5, ease: 'none', immediateRender: false }, tB + 0.3);
    tl.to('#cta-ecg-path', { drawSVG: '84% 100%', duration: 2.6, ease: 'none' }, tB + 0.8);
    tl.to('#cta-ecg-path', { drawSVG: '100% 100%', duration: 0.5, ease: 'none' }, tB + 3.4);
    tl.fromTo('#cta-ecg-path', { drawSVG: '0% 0%' }, { drawSVG: '34% 50%', duration: 1.0, ease: 'none', immediateRender: false }, tBeat - 1.0);
    tl.to('#cta-ecg-path', { drawSVG: '100% 100%', duration: 1.1, ease: 'none' }, tBeat);
    tl.to('#cta-logo .logo-mark', { scale: 1.09, duration: 0.11, yoyo: true, repeat: 1, ease: 'power2.out' }, tBeat);
    tl.to('#cta-logo .logo-mark', { scale: 1.06, duration: 0.11, yoyo: true, repeat: 1, ease: 'power2.out' }, tBeat + 0.3);
    tl.to('#cta-btn', { boxShadow: '0 24px 90px rgba(255,0,0,0.55)', duration: 0.25, yoyo: true, repeat: 1 }, tBeat);

    return tl;
  }

  window.buildPulseDeckSpot = build;
})();
