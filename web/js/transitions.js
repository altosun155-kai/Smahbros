// transitions.js — cinematic page transitions for Smahbros
// Intercepts internal link clicks, plays a themed overlay, then navigates.
// Loaded by nav-inject.js (all nav pages) and manually on hub.html.
(function () {
  'use strict';

  // ─── Config: page → transition ───────────────────────────────────────────
  var TX_MAP = {
    'index.html':        { cls: 'tx-smash',   dur: 1000, mid: 480 },
    'hub.html':          { cls: 'tx-smash',   dur: 1000, mid: 480 },
    'practice.html':     { cls: 'tx-smash',   dur: 1000, mid: 480 },
    'bracket.html':      { cls: 'tx-bracket', dur: 900,  mid: 420 },
    'my-brackets.html':  { cls: 'tx-bracket', dur: 900,  mid: 420 },
    'teams-bracket.html':{ cls: 'tx-bracket', dur: 900,  mid: 420 },
    'roundrobin.html':   { cls: 'tx-bracket', dur: 900,  mid: 420 },
    'game.html':         { cls: 'tx-duel',    dur: 1300, mid: 620 },
    'duel.html':         { cls: 'tx-duel',    dur: 1300, mid: 620 },
    'leaderboard.html':  { cls: 'tx-lb',      dur: 1200, mid: 560 },
    'team-standings.html':{ cls:'tx-lb',      dur: 1200, mid: 560 },
    'stats.html':        { cls: 'tx-stats',   dur: 1100, mid: 520 },
    'mastery.html':      { cls: 'tx-mastery', dur: 1100, mid: 520 },
    'friends.html':      { cls: 'tx-friends', dur: 1200, mid: 560 },
    'tier-list.html':    { cls: 'tx-friends', dur: 1200, mid: 560 },
    'favorites.html':    { cls: 'tx-friends', dur: 1200, mid: 560 },
    'profile.html':      { cls: 'tx-profile', dur: 1100, mid: 520 },
  };
  var DEFAULT_TX = { cls: 'tx-smash', dur: 1000, mid: 480 };

  // ─── Inject CSS ───────────────────────────────────────────────────────────
  var s = document.createElement('style');
  s.textContent = [
    /* overlay base */
    '.tx{position:fixed;inset:0;z-index:9000;pointer-events:none;opacity:0}',
    '.tx.go{opacity:1}',

    /* ── entry veil (new-page reveal) ── */
    '#tx-veil{position:fixed;inset:0;z-index:8999;background:#08080a;pointer-events:none;',
    'transition:opacity 0.42s cubic-bezier(.2,.7,.2,1)}',

    /* ── smash impact ── */
    '.tx-smash{background:transparent;display:grid;place-items:center}',
    '.tx-smash .ring1,.tx-smash .ring2{position:absolute;left:50%;top:50%;border-radius:50%;',
    'border:3px solid #ffb800;width:0;height:0;transform:translate(-50%,-50%)}',
    '.tx-smash.go .ring1{animation:_smashring 1s cubic-bezier(.2,.7,.2,1) forwards}',
    '.tx-smash.go .ring2{animation:_smashring 1s .12s cubic-bezier(.2,.7,.2,1) forwards;border-color:#ff4419}',
    '@keyframes _smashring{0%{width:0;height:0;opacity:1}60%{opacity:.8}100%{width:200vmax;height:200vmax;opacity:0;border-width:0}}',
    '.tx-smash .flash{position:absolute;inset:0;background:radial-gradient(closest-side,#ffb800,transparent 50%);opacity:0}',
    '.tx-smash.go .flash{animation:_flash .35s ease-out forwards}',
    '@keyframes _flash{0%{opacity:0}30%{opacity:.85}100%{opacity:0}}',

    /* ── bracket — lightning slice ── */
    '.tx-bracket{background:transparent;overflow:hidden}',
    '.tx-bracket .slice{position:absolute;left:-20%;top:-20%;width:140%;height:140%;',
    'background:#ff4419;transform:translateY(120%) rotate(-12deg)}',
    '.tx-bracket.go .slice{animation:_bracketSlice .9s cubic-bezier(.65,0,.35,1) forwards}',
    '@keyframes _bracketSlice{0%{transform:translateY(120%) rotate(-12deg)}50%{transform:translateY(0%) rotate(-12deg)}100%{transform:translateY(-120%) rotate(-12deg)}}',
    '.tx-bracket .bolt{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(0);',
    'font-family:Anton,Impact,sans-serif;font-size:30vw;color:#fff;line-height:1;letter-spacing:.02em;',
    'text-shadow:0 0 60px rgba(255,255,255,.6);opacity:0}',
    '.tx-bracket.go .bolt{animation:_bracketBolt .9s ease-out forwards}',
    '@keyframes _bracketBolt{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}30%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}60%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.4)}}',

    /* ── duel — VS slam ── */
    '.tx-duel{overflow:hidden}',
    '.tx-duel .bar-t,.tx-duel .bar-b{position:absolute;left:0;right:0;height:50%;background:#08080a}',
    '.tx-duel .bar-t{top:-50%;clip-path:polygon(0 0,100% 0,100% 100%,0 85%)}',
    '.tx-duel .bar-b{bottom:-50%;clip-path:polygon(0 15%,100% 0,100% 100%,0 100%)}',
    '.tx-duel.go .bar-t{animation:_duelBarT 1.3s cubic-bezier(.7,0,.3,1) forwards}',
    '.tx-duel.go .bar-b{animation:_duelBarB 1.3s cubic-bezier(.7,0,.3,1) forwards}',
    '@keyframes _duelBarT{0%{top:-50%}30%{top:0%}70%{top:0%}100%{top:-50%}}',
    '@keyframes _duelBarB{0%{bottom:-50%}30%{bottom:0%}70%{bottom:0%}100%{bottom:-50%}}',
    '.tx-duel .pname{position:absolute;font-family:Anton,Impact,sans-serif;font-size:14vw;line-height:.9;letter-spacing:.02em;color:#f0eee8;opacity:0}',
    '.tx-duel .p1n{top:18%;left:6%;transform:translateX(-50%)}',
    '.tx-duel .p2n{bottom:18%;right:6%;text-align:right;transform:translateX(50%)}',
    '.tx-duel.go .p1n{animation:_duelP1 1.3s cubic-bezier(.2,.7,.2,1) forwards}',
    '.tx-duel.go .p2n{animation:_duelP2 1.3s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes _duelP1{0%{opacity:0;transform:translateX(-50%)}35%{opacity:1;transform:translateX(0)}70%{opacity:1;transform:translateX(0)}100%{opacity:0;transform:translateX(-50%)}}',
    '@keyframes _duelP2{0%{opacity:0;transform:translateX(50%)}35%{opacity:1;transform:translateX(0)}70%{opacity:1;transform:translateX(0)}100%{opacity:0;transform:translateX(50%)}}',
    '.tx-duel .vsBig{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.4);',
    'font-family:Anton,Impact,sans-serif;font-size:25vw;line-height:1;color:#ff4419;letter-spacing:.04em;',
    'text-shadow:0 0 40px rgba(255,68,25,.5);opacity:0}',
    '.tx-duel.go .vsBig{animation:_duelVS 1.3s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes _duelVS{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}30%{opacity:0;transform:translate(-50%,-50%) scale(.6)}45%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}55%{transform:translate(-50%,-50%) scale(1)}70%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.4)}}',

    /* ── leaderboard — gold curtain ── */
    '.tx-lb{overflow:hidden}',
    '.tx-lb .curtain{position:absolute;left:0;right:0;bottom:-100%;height:100%;',
    'background:linear-gradient(180deg,#ffb800,#7a5c00 80%,#08080a)}',
    '.tx-lb.go .curtain{animation:_lbCurtain 1.2s cubic-bezier(.7,0,.3,1) forwards}',
    '@keyframes _lbCurtain{0%{bottom:-100%}45%{bottom:0%}55%{bottom:0%}100%{bottom:100%}}',
    '.tx-lb .trophy{position:absolute;left:50%;top:60%;transform:translate(-50%,-50%) translateY(60vh);font-size:25vw;line-height:1;opacity:0;filter:drop-shadow(0 0 60px rgba(0,0,0,.4))}',
    '.tx-lb.go .trophy{animation:_lbTrophy 1.2s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes _lbTrophy{0%{opacity:0;transform:translate(-50%,-50%) translateY(60vh) scale(.5) rotate(-20deg)}35%{opacity:1;transform:translate(-50%,-50%) translateY(0) scale(1) rotate(0deg)}65%{opacity:1;transform:translate(-50%,-50%) translateY(0) scale(1) rotate(0deg)}100%{opacity:0;transform:translate(-50%,-50%) translateY(-60vh) scale(.8)}}',
    '.tx-lb .lbtitle{position:absolute;left:0;right:0;top:38%;text-align:center;font-family:Anton,Impact,sans-serif;font-size:11vw;color:#08080a;letter-spacing:.04em;opacity:0;line-height:1}',
    '.tx-lb.go .lbtitle{animation:_lbTitle 1.2s cubic-bezier(.2,.7,.2,1) .1s forwards}',
    '@keyframes _lbTitle{0%{opacity:0;transform:translateY(20px) scale(.95)}35%{opacity:1;transform:translateY(0) scale(1)}65%{opacity:1}100%{opacity:0;transform:translateY(-20px) scale(1.05)}}',

    /* ── stats — matrix rain ── */
    '.tx-stats{overflow:hidden;background:#08080a}',
    '.tx-stats.go{animation:_statsBg 1.1s steps(8,end) forwards}',
    '@keyframes _statsBg{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}',
    '.tx-stats .col{position:absolute;top:-20%;width:30px;font:700 16px/1.4 monospace;color:#ff4419;text-align:center;opacity:.8;text-shadow:0 0 8px #ff4419}',
    '.tx-stats.go .col{animation:_statsRain 1.1s cubic-bezier(.4,0,.6,1) forwards}',
    '@keyframes _statsRain{0%{transform:translateY(0)}100%{transform:translateY(140vh)}}',
    '.tx-stats .bignum{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:Anton,Impact,sans-serif;font-size:25vw;color:#ff4419;letter-spacing:-.02em;opacity:0;text-shadow:0 0 50px rgba(255,68,25,.5);line-height:1}',
    '.tx-stats.go .bignum{animation:_statsNum 1.1s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes _statsNum{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}40%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}60%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}',

    /* ── mastery — grid construct ── */
    '.tx-mastery{overflow:hidden;background:#08080a}',
    '.tx-mastery.go{animation:_mastBg 1.1s ease forwards}',
    '@keyframes _mastBg{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}',
    '.tx-mastery .gx{position:absolute;width:5vw;height:5vw;background:#ff4419;transform:scale(0);box-shadow:0 0 12px #ff4419}',
    '.tx-mastery.go .gx{animation:_mastCell .8s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes _mastCell{0%{transform:scale(0) rotate(0deg);background:#ff4419}40%{transform:scale(1) rotate(45deg);background:#ffb800}100%{transform:scale(0) rotate(90deg);opacity:0}}',

    /* ── friends — orbit assemble ── */
    '.tx-friends{overflow:hidden;background:radial-gradient(circle at center,#0a1424,#08080a)}',
    '.tx-friends.go{animation:_frBg 1.2s ease forwards}',
    '@keyframes _frBg{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}',
    '.tx-friends .orbit{position:absolute;left:50%;top:50%;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#3a86ff,#1a3a8a);display:grid;place-items:center;font-weight:800;font-size:18px;color:#fff;box-shadow:0 0 30px rgba(58,134,255,.5);opacity:0}',
    '.tx-friends.go .orbit{animation:_frOrbit 1.2s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes _frOrbit{0%{transform:translate(-50%,-50%) scale(.3);opacity:0}35%{transform:translate(-50%,-50%) scale(1);opacity:1}65%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(-50%,-50%) scale(.5);opacity:0}}',
    '.tx-friends .center-pulse{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:120px;height:120px;border-radius:50%;background:#3a86ff;opacity:0;box-shadow:0 0 80px #3a86ff}',
    '.tx-friends.go .center-pulse{animation:_frPulse 1.2s ease forwards}',
    '@keyframes _frPulse{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}40%{opacity:.8;transform:translate(-50%,-50%) scale(1.2)}60%{opacity:.8;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(2)}}',

    /* ── profile — radial reveal ── */
    '.tx-profile{overflow:hidden}',
    '.tx-profile .veil{position:absolute;inset:0;background:#08080a;clip-path:circle(0% at 50% 50%)}',
    '.tx-profile.go .veil{animation:_pfVeil 1.1s cubic-bezier(.7,0,.3,1) forwards}',
    '@keyframes _pfVeil{0%{clip-path:circle(0% at 50% 50%)}40%{clip-path:circle(150% at 50% 50%)}60%{clip-path:circle(150% at 50% 50%)}100%{clip-path:circle(0% at 50% 50%)}}',
    '.tx-profile .silhouette{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.5);font-size:50vh;line-height:1;opacity:0;filter:drop-shadow(0 0 60px rgba(255,44,95,.5))}',
    '.tx-profile.go .silhouette{animation:_pfSil 1.1s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes _pfSil{0%{opacity:0;transform:translate(-50%,-50%) scale(.5)}40%{opacity:1;transform:translate(-50%,-50%) scale(1)}60%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.2)}}',
    '.tx-profile .pftitle{position:absolute;left:0;right:0;top:50%;text-align:center;font-family:Anton,Impact,sans-serif;font-size:9vw;color:#ff2c5f;letter-spacing:.02em;line-height:1;transform:translateY(-50%);opacity:0}',
    '.tx-profile.go .pftitle{animation:_pfTitle 1.1s .1s ease forwards}',
    '@keyframes _pfTitle{0%,30%{opacity:0;letter-spacing:.5em}50%{opacity:1;letter-spacing:.02em}70%{opacity:1}100%{opacity:0;letter-spacing:-.05em}}',
  ].join('');
  document.head.appendChild(s);

  // ─── Inject overlay HTML ──────────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'tx-overlays';
  wrap.innerHTML =
    '<div class="tx tx-smash"><div class="flash"></div><div class="ring1"></div><div class="ring2"></div></div>' +
    '<div class="tx tx-bracket"><div class="slice"></div><div class="bolt">⚡</div></div>' +
    '<div class="tx tx-duel"><div class="bar-t"></div><div class="bar-b"></div><div class="pname p1n"></div><div class="pname p2n"></div><div class="vsBig">VS</div></div>' +
    '<div class="tx tx-lb"><div class="curtain"></div><div class="trophy">🏆</div><div class="lbtitle">THE THRONE</div></div>' +
    '<div class="tx tx-stats"><div class="bignum">99</div></div>' +
    '<div class="tx tx-mastery"></div>' +
    '<div class="tx tx-friends"><div class="center-pulse"></div></div>' +
    '<div class="tx tx-profile"><div class="veil"></div><div class="silhouette">👤</div><div class="pftitle">PROFILE</div></div>';
  document.body.appendChild(wrap);

  // ─── Entry veil: covers page then immediately fades out ───────────────────
  var veil = document.createElement('div');
  veil.id = 'tx-veil';
  document.body.appendChild(veil);
  // Two rAF ensures the div is painted before we start the transition
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      veil.style.opacity = '0';
      setTimeout(function () { veil.parentNode && veil.parentNode.removeChild(veil); }, 460);
    });
  });

  // ─── Dynamic setup functions ──────────────────────────────────────────────
  function setupStatsRain(el) {
    el.querySelectorAll('.col').forEach(function (c) { c.parentNode.removeChild(c); });
    var cols = Math.floor(window.innerWidth / 34);
    for (var i = 0; i < cols; i++) {
      var c = document.createElement('div');
      c.className = 'col';
      c.style.left = (i * 34 + 6) + 'px';
      c.style.animationDelay = (Math.random() * 0.4) + 's';
      var txt = '';
      var rows = 8 + Math.floor(Math.random() * 10);
      for (var j = 0; j < rows; j++) txt += (Math.random() > .5 ? '1' : '0') + '<br>';
      c.innerHTML = txt;
      el.appendChild(c);
    }
  }

  function setupMasteryCells(el) {
    el.querySelectorAll('.gx').forEach(function (c) { c.parentNode.removeChild(c); });
    var total = 120;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var span = Math.max(window.innerWidth, window.innerHeight);
    for (var i = 0; i < total; i++) {
      var c = document.createElement('div');
      c.className = 'gx';
      var angle = Math.random() * Math.PI * 2;
      var dist = Math.random() * span / 2;
      c.style.left = (cx + Math.cos(angle) * dist) + 'px';
      c.style.top  = (cy + Math.sin(angle) * dist) + 'px';
      c.style.animationDelay = (dist / span * 0.5) + 's';
      el.appendChild(c);
    }
  }

  function setupFriendOrbits(el) {
    el.querySelectorAll('.orbit').forEach(function (c) { c.parentNode.removeChild(c); });
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var names  = ['K', 'V', 'L', 'R', 'J', 'S', 'T', 'M'];
    var colors = ['#ff4419','#ffb800','#3dd17f','#ff2c5f','#3a86ff','#a878ff','#ff8a3d','#2bd9ff'];
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      var r = 180 + Math.random() * 60;
      var o = document.createElement('div');
      o.className = 'orbit';
      o.style.left = (cx + Math.cos(a) * r) + 'px';
      o.style.top  = (cy + Math.sin(a) * r) + 'px';
      o.style.background = 'linear-gradient(135deg,' + colors[i] + ',#08080a)';
      o.style.animationDelay = (i * 0.05) + 's';
      o.textContent = names[i];
      el.appendChild(o);
    }
  }

  var SETUPS = {
    'tx-stats':   setupStatsRain,
    'tx-mastery': setupMasteryCells,
    'tx-friends': setupFriendOrbits,
  };

  // ─── Navigate with transition ─────────────────────────────────────────────
  var busy = false;

  function navigate(href, txCfg) {
    if (busy) return;
    busy = true;

    var txEl = document.querySelector('.' + txCfg.cls);
    if (!txEl) { window.location.href = href; return; }

    // Populate duel player names from auth context
    if (txCfg.cls === 'tx-duel') {
      var p1 = txEl.querySelector('.p1n');
      var p2 = txEl.querySelector('.p2n');
      if (p1) p1.textContent = ((localStorage.username || 'P1') + '').toUpperCase().slice(0, 8);
      if (p2) p2.textContent = 'VS';
    }

    if (SETUPS[txCfg.cls]) SETUPS[txCfg.cls](txEl);

    txEl.classList.add('go');

    setTimeout(function () {
      window.location.href = href;
    }, txCfg.mid);
  }

  function getTx(filename) {
    return TX_MAP[filename] || DEFAULT_TX;
  }

  // ─── Intercept internal link clicks ──────────────────────────────────────
  document.addEventListener('click', function (e) {
    // Skip if another handler already prevented the default action
    if (e.defaultPrevented) return;

    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;

    // Skip external, hash-only, protocol links, and new-tab targets
    if (/^(https?:|\/\/|javascript:|mailto:|#)/.test(href)) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank') return;
    if (a.hasAttribute('download')) return;

    var filename = href.split('/').pop().split('?')[0];
    if (!filename) filename = 'index.html';

    e.preventDefault();
    navigate(href, getTx(filename));
  });

})();
