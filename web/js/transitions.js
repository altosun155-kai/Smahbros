// transitions.js — 16-chapter cinematic page transitions
(function () {
  'use strict';

  var TX_MAP = {
    'index.html':         { cls: 'tx-iris',    num: '001', word: 'ARENA',       dur: 1300, mid: 625 },
    'hub.html':           { cls: 'tx-iris',    num: '001', word: 'ARENA',       dur: 1300, mid: 625 },
    'bracket.html':       { cls: 'tx-blade',   num: '002', word: 'BRACKET',     dur: 1300, mid: 625 },
    'teams-bracket.html': { cls: 'tx-corners', num: '003', word: 'TEAM BATTLE', dur: 1300, mid: 625 },
    'team-standings.html':{ cls: 'tx-rows',    num: '004', word: 'STANDINGS',   dur: 1400, mid: 625 },
    'duel.html':          { cls: 'tx-split',   num: '005', word: '1V1 DUEL',    dur: 1300, mid: 625 },
    'game.html':          { cls: 'tx-ripple',  num: '006', word: 'ARENA',       dur: 1300, mid: 625 },
    'roundrobin.html':    { cls: 'tx-clock',   num: '007', word: 'ROUND ROBIN', dur: 1350, mid: 625 },
    'my-brackets.html':   { cls: 'tx-stack',   num: '008', word: 'MY BRACKETS', dur: 1400, mid: 700 },
    'stats.html':         { cls: 'tx-trio',    num: '009', word: 'STATS',       dur: 1350, mid: 625 },
    'leaderboard.html':   { cls: 'tx-curtain', num: '010', word: 'THE THRONE',  dur: 1300, mid: 625 },
    'mastery.html':       { cls: 'tx-wave',    num: '011', word: 'MASTERY',     dur: 1500, mid: 625 },
    'practice.html':      { cls: 'tx-scan',    num: '012', word: 'PRACTICE',    dur: 1400, mid: 625 },
    'tier-list.html':     { cls: 'tx-tiers',   num: '013', word: 'TIER LIST',   dur: 1500, mid: 700 },
    'favorites.html':     { cls: 'tx-star',    num: '014', word: 'FAVORITES',   dur: 1350, mid: 625 },
    'friends.html':       { cls: 'tx-blue',    num: '015', word: 'YOUR CIRCLE', dur: 1300, mid: 625 },
    'profile.html':       { cls: 'tx-close',   num: '016', word: 'PROFILE',     dur: 1300, mid: 625 },
  };
  var DEFAULT_TX = TX_MAP['index.html'];

  var pendingEnter = null;
  try {
    pendingEnter = sessionStorage.getItem('txEnter');
    if (pendingEnter) sessionStorage.removeItem('txEnter');
  } catch (e) {}

  // ── CSS ────────────────────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent =
    '@property --p{syntax:"<angle>";inherits:false;initial-value:0deg}' +

    // Base
    '.tx{position:fixed;inset:0;z-index:9000;pointer-events:none;display:none;overflow:hidden}' +
    '.tx.go{display:block;pointer-events:auto}' +
    '.tx-trio.go{display:flex}' +
    '.tx-wave.go{display:grid;grid-template-columns:repeat(20,1fr);grid-template-rows:repeat(12,1fr)}' +

    // Label
    '.tx .label{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10;text-align:center;opacity:0;pointer-events:none}' +
    '.tx .label .num{display:block;font:700 13px/1 monospace;letter-spacing:.4em;color:#f0eee8;opacity:.65;margin-bottom:14px}' +
    '.tx .label .word{display:block;font-family:Anton,Impact,sans-serif;font-size:clamp(60px,10vw,160px);line-height:.9;letter-spacing:.02em;color:#f0eee8}' +
    '.tx.go .label{animation:_lbl 700ms 350ms cubic-bezier(.4,0,.2,1) forwards}' +
    '@keyframes _lbl{0%{opacity:0;transform:translate(-50%,-30%)}25%,75%{opacity:1;transform:translate(-50%,-50%)}100%{opacity:0;transform:translate(-50%,-70%)}}' +
    '.tx.dark-label .label .num,.tx.dark-label .label .word{color:#0a0a0c}' +
    '.tx.go.enter .label{animation:none;opacity:0}' +

    // 1. IRIS — index/hub
    '.tx-iris .circle{position:absolute;border-radius:50%;background:#0a0a0c;left:var(--mx,50%);top:var(--my,50%);width:0;height:0;transform:translate(-50%,-50%)}' +
    '.tx-iris.go .circle{animation:_irisIn 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _irisIn{to{width:300vmax;height:300vmax}}' +
    '.tx-iris.go.enter .circle{animation:_irisOut 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _irisOut{from{width:300vmax;height:300vmax;opacity:1}to{width:0;height:0;opacity:.8}}' +

    // 2. BLADE — bracket
    '.tx-blade .blade{position:absolute;left:-50%;top:-50%;width:200%;height:200%;background:#ff4419;transform:translateX(120%) rotate(-12deg)}' +
    '.tx-blade.go .blade{animation:_bladeIn 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _bladeIn{to{transform:translateX(0) rotate(-12deg)}}' +
    '.tx-blade.go.enter .blade{animation:_bladeOut 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _bladeOut{from{transform:translateX(0) rotate(-12deg)}to{transform:translateX(-120%) rotate(-12deg)}}' +

    // 3. CORNERS — teams-bracket
    '.tx-corners .qd{position:absolute;width:50%;height:50%}' +
    '.tx-corners .qd.tl{top:0;left:0;background:#3a86ff;transform:translate(-100%,-100%)}' +
    '.tx-corners .qd.tr{top:0;right:0;background:#ff4419;transform:translate(100%,-100%)}' +
    '.tx-corners .qd.bl{bottom:0;left:0;background:#ffb800;transform:translate(-100%,100%)}' +
    '.tx-corners .qd.br{bottom:0;right:0;background:#3dd17f;transform:translate(100%,100%)}' +
    '.tx-corners.go .qd{animation:_cornerIn 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _cornerIn{to{transform:translate(0,0)}}' +
    '.tx-corners.go.enter .qd.tl{animation:_cOutTL 500ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-corners.go.enter .qd.tr{animation:_cOutTR 500ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-corners.go.enter .qd.bl{animation:_cOutBL 500ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-corners.go.enter .qd.br{animation:_cOutBR 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _cOutTL{from{transform:translate(0,0)}to{transform:translate(-100%,-100%)}}' +
    '@keyframes _cOutTR{from{transform:translate(0,0)}to{transform:translate(100%,-100%)}}' +
    '@keyframes _cOutBL{from{transform:translate(0,0)}to{transform:translate(-100%,100%)}}' +
    '@keyframes _cOutBR{from{transform:translate(0,0)}to{transform:translate(100%,100%)}}' +

    // 4. ROWS — team-standings
    '.tx-rows .rw{position:absolute;left:0;width:100%;height:16.67%;background:#ffb800;transform:translateX(-100%)}' +
    '.tx-rows .rw:nth-child(1){top:0%}.tx-rows .rw:nth-child(2){top:16.67%}.tx-rows .rw:nth-child(3){top:33.33%}' +
    '.tx-rows .rw:nth-child(4){top:50%}.tx-rows .rw:nth-child(5){top:66.67%}.tx-rows .rw:nth-child(6){top:83.33%}' +
    '.tx-rows.go .rw{animation:_rowIn 400ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-rows.go .rw:nth-child(1){animation-delay:0ms}.tx-rows.go .rw:nth-child(2){animation-delay:50ms}' +
    '.tx-rows.go .rw:nth-child(3){animation-delay:100ms}.tx-rows.go .rw:nth-child(4){animation-delay:150ms}' +
    '.tx-rows.go .rw:nth-child(5){animation-delay:200ms}.tx-rows.go .rw:nth-child(6){animation-delay:250ms}' +
    '@keyframes _rowIn{to{transform:translateX(0)}}' +
    '.tx-rows.go.enter .rw{animation:_rowOut 400ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-rows.go.enter .rw:nth-child(1){animation-delay:0ms}.tx-rows.go.enter .rw:nth-child(2){animation-delay:0ms}' +
    '.tx-rows.go.enter .rw:nth-child(3){animation-delay:0ms}.tx-rows.go.enter .rw:nth-child(4){animation-delay:0ms}' +
    '.tx-rows.go.enter .rw:nth-child(5){animation-delay:0ms}.tx-rows.go.enter .rw:nth-child(6){animation-delay:0ms}' +
    '@keyframes _rowOut{from{transform:translateX(0)}to{transform:translateX(100%)}}' +

    // 5. SPLIT — duel
    '.tx-split .half{position:absolute;top:0;height:100%;width:50%}' +
    '.tx-split .half.l{left:0;background:#0a0a0c;transform:translateX(-100%)}' +
    '.tx-split .half.r{right:0;background:#dad5cb;transform:translateX(100%)}' +
    '.tx-split.go .half.l{animation:_splitInL 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '.tx-split.go .half.r{animation:_splitInR 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _splitInL{to{transform:translateX(0)}}' +
    '@keyframes _splitInR{to{transform:translateX(0)}}' +
    '.tx-split.go.enter .half.l{animation:_splitOutL 500ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-split.go.enter .half.r{animation:_splitOutR 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _splitOutL{from{transform:translateX(0)}to{transform:translateY(-100%)}}' +
    '@keyframes _splitOutR{from{transform:translateX(0)}to{transform:translateY(100%)}}' +

    // 6. RIPPLE — game
    '.tx-ripple .r1,.tx-ripple .r2,.tx-ripple .r3{position:absolute;left:50%;top:50%;border-radius:50%;background:#3a86ff;width:0;height:0;transform:translate(-50%,-50%);opacity:0}' +
    '.tx-ripple.go .r1{animation:_ripIn 700ms cubic-bezier(.4,0,.2,1) forwards}' +
    '.tx-ripple.go .r2{animation:_ripIn 700ms 80ms cubic-bezier(.4,0,.2,1) forwards}' +
    '.tx-ripple.go .r3{animation:_ripIn 700ms 160ms cubic-bezier(.4,0,.2,1) forwards}' +
    '@keyframes _ripIn{50%{opacity:.4}100%{width:300vmax;height:300vmax;opacity:1}}' +
    '.tx-ripple.go.enter .r1,.tx-ripple.go.enter .r2,.tx-ripple.go.enter .r3{animation:_ripOut 500ms cubic-bezier(.4,0,.2,1) both}' +
    '@keyframes _ripOut{from{width:300vmax;height:300vmax;opacity:1}to{opacity:0;transform:translate(-50%,-50%) scale(1.1)}}' +

    // 7. CLOCK — roundrobin (conic sweep; requires @property --p)
    '.tx-clock .panel{position:absolute;inset:0;background:conic-gradient(from -90deg,#ffb800 0deg,#ffb800 var(--p,0deg),transparent var(--p,0deg))}' +
    '.tx-clock.go .panel{animation:_clockIn 600ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _clockIn{to{--p:360deg}}' +
    '.tx-clock.go.enter .panel{animation:_clockOut 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _clockOut{from{--p:360deg;opacity:1}to{--p:360deg;opacity:0}}' +

    // 8. STACK — my-brackets
    '.tx-stack .card{position:absolute;left:50%;bottom:50%;width:60vw;height:55vh;background:linear-gradient(180deg,#1a1a26,#0a0a0c);border:1px solid #ff4419;border-radius:14px;transform:translate(-50%,150%)}' +
    '.tx-stack .card.c1{transform:translate(-50%,150%) rotate(-3deg)}' +
    '.tx-stack .card.c2{transform:translate(-50%,150%) rotate(0deg)}' +
    '.tx-stack .card.c3{transform:translate(-50%,150%) rotate(3deg)}' +
    '.tx-stack.go .card{animation:_stackIn 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '.tx-stack.go .card.c1{animation-delay:0ms;--r:-3deg}' +
    '.tx-stack.go .card.c2{animation-delay:80ms;--r:0deg}' +
    '.tx-stack.go .card.c3{animation-delay:160ms;--r:3deg}' +
    '@keyframes _stackIn{to{transform:translate(-50%,50%) rotate(var(--r,0deg))}}' +
    '.tx-stack.go.enter .card{animation:_stackOut 500ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-stack.go.enter .card.c1{animation-delay:0ms}.tx-stack.go.enter .card.c2{animation-delay:0ms}.tx-stack.go.enter .card.c3{animation-delay:0ms}' +
    '@keyframes _stackOut{from{transform:translate(-50%,50%) rotate(var(--r,0deg))}to{transform:translate(-50%,-200%) rotate(var(--r,0deg))}}' +

    // 9. TRIO — stats
    '.tx-trio{flex-direction:row}' +
    '.tx-trio .bar{flex:1;background:#ff4419;transform:translateY(-100%)}' +
    '.tx-trio.go .bar{animation:_trioIn 450ms cubic-bezier(.77,0,.175,1) forwards}' +
    '.tx-trio.go .bar:nth-child(1){animation-delay:0ms}' +
    '.tx-trio.go .bar:nth-child(2){animation-delay:100ms}' +
    '.tx-trio.go .bar:nth-child(3){animation-delay:200ms}' +
    '@keyframes _trioIn{to{transform:translateY(0)}}' +
    '.tx-trio.go.enter .bar{animation:_trioOut 450ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-trio.go.enter .bar:nth-child(1){animation-delay:0ms}' +
    '.tx-trio.go.enter .bar:nth-child(2){animation-delay:0ms}' +
    '.tx-trio.go.enter .bar:nth-child(3){animation-delay:0ms}' +
    '@keyframes _trioOut{from{transform:translateY(0)}to{transform:translateY(100%)}}' +

    // 10. CURTAIN — leaderboard
    '.tx-curtain .panel{position:absolute;inset:0;background:#d4a017;transform:translateY(100%)}' +
    '.tx-curtain.go .panel{animation:_curtainIn 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _curtainIn{to{transform:translateY(0)}}' +
    '.tx-curtain.go.enter .panel{animation:_curtainOut 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _curtainOut{from{transform:translateY(0)}to{transform:translateY(-100%)}}' +

    // 11. WAVE — mastery (tiles built programmatically)
    '.tx-wave .tl{background:#ff4419;transform:scale(0);transform-origin:center}' +
    '.tx-wave.go .tl{animation:_tlPop 350ms cubic-bezier(.5,0,.5,1) forwards}' +
    '@keyframes _tlPop{to{transform:scale(1)}}' +
    '.tx-wave.go.enter .tl{animation:_tlFade 350ms cubic-bezier(.5,0,.5,1) both}' +
    '@keyframes _tlFade{from{transform:scale(1)}to{transform:scale(0);opacity:0}}' +

    // 12. SCAN — practice (7 skewed bars)
    '.tx-scan .ln{position:absolute;left:-50%;width:200%;height:14.29%;background:#ff2c5f;transform:translateX(-100%)}' +
    '.tx-scan .ln:nth-child(1){top:0%}.tx-scan .ln:nth-child(2){top:14.29%}.tx-scan .ln:nth-child(3){top:28.57%}' +
    '.tx-scan .ln:nth-child(4){top:42.86%}.tx-scan .ln:nth-child(5){top:57.14%}.tx-scan .ln:nth-child(6){top:71.43%}.tx-scan .ln:nth-child(7){top:85.71%}' +
    '.tx-scan.go .ln{animation:_scanIn 400ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-scan.go .ln:nth-child(odd){animation-delay:0ms}.tx-scan.go .ln:nth-child(even){animation-delay:80ms}' +
    '@keyframes _scanIn{to{transform:translateX(50%)}}' +
    '.tx-scan.go.enter .ln{animation:_scanOut 400ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-scan.go.enter .ln:nth-child(odd){animation-delay:0ms}.tx-scan.go.enter .ln:nth-child(even){animation-delay:0ms}' +
    '@keyframes _scanOut{from{transform:translateX(50%)}to{transform:translateX(150%)}}' +

    // 13. TIERS — tier-list
    '.tx-tiers .t{position:absolute;left:0;width:100%;height:16.67%;transform:translateY(-100%);display:flex;align-items:center;padding-left:60px;font-family:Anton,Impact,sans-serif;font-size:80px;color:#0a0a0c;letter-spacing:.04em}' +
    '.tx-tiers .t.s{top:0%;background:#ff2c5f}.tx-tiers .t.a{top:16.67%;background:#ff8a3d}' +
    '.tx-tiers .t.b{top:33.33%;background:#ffd23f}.tx-tiers .t.c{top:50%;background:#3dd17f}' +
    '.tx-tiers .t.d{top:66.67%;background:#3a86ff}.tx-tiers .t.f{top:83.33%;background:#a878ff}' +
    '.tx-tiers.go .t{animation:_tierIn 400ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-tiers.go .t.s{animation-delay:0ms}.tx-tiers.go .t.a{animation-delay:50ms}' +
    '.tx-tiers.go .t.b{animation-delay:100ms}.tx-tiers.go .t.c{animation-delay:150ms}' +
    '.tx-tiers.go .t.d{animation-delay:200ms}.tx-tiers.go .t.f{animation-delay:250ms}' +
    '@keyframes _tierIn{to{transform:translateY(0)}}' +
    '.tx-tiers.go.enter .t{animation:_tierOut 400ms cubic-bezier(.77,0,.175,1) both}' +
    '.tx-tiers.go.enter .t.s,.tx-tiers.go.enter .t.a,.tx-tiers.go.enter .t.b,' +
    '.tx-tiers.go.enter .t.c,.tx-tiers.go.enter .t.d,.tx-tiers.go.enter .t.f{animation-delay:0ms}' +
    '@keyframes _tierOut{from{transform:translateY(0)}to{transform:translateY(100%)}}' +

    // 14. STAR — favorites
    '.tx-star .star-shape{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(0);width:200vmax;height:200vmax;background:#ffb800;clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)}' +
    '.tx-star.go .star-shape{animation:_starIn 550ms cubic-bezier(.7,0,.3,1) forwards}' +
    '@keyframes _starIn{to{transform:translate(-50%,-50%) scale(1) rotate(0deg)}}' +
    '.tx-star.go.enter .star-shape{animation:_starOut 500ms cubic-bezier(.4,0,.2,1) both}' +
    '@keyframes _starOut{from{transform:translate(-50%,-50%) scale(1) rotate(0deg);opacity:1}to{transform:translate(-50%,-50%) scale(.3) rotate(72deg);opacity:0}}' +

    // 15. BLUE — friends
    '.tx-blue .panel{position:absolute;inset:0;background:#3a86ff;transform:translateX(100%)}' +
    '.tx-blue.go .panel{animation:_blueIn 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _blueIn{to{transform:translateX(0)}}' +
    '.tx-blue.go.enter .panel{animation:_blueOut 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _blueOut{from{transform:translateX(0)}to{transform:translateX(-100%)}}' +

    // 16. CLOSE — profile (iris close)
    '.tx-close .panel{position:absolute;inset:0;background:#0a0a0c;clip-path:circle(0% at 50% 50%)}' +
    '.tx-close.go .panel{animation:_closeIn 500ms cubic-bezier(.77,0,.175,1) forwards}' +
    '@keyframes _closeIn{to{clip-path:circle(150vmax at 50% 50%)}}' +
    '.tx-close.go.enter .panel{animation:_closeOut 500ms cubic-bezier(.77,0,.175,1) both}' +
    '@keyframes _closeOut{from{clip-path:circle(150vmax at 50% 50%)}to{clip-path:circle(0% at 50% 50%)}}';

  document.head.appendChild(css);

  // ── Overlay HTML ───────────────────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'tx-overlays';
  wrap.innerHTML =
    '<div class="tx tx-iris"><div class="circle"></div><div class="label"><span class="num">001</span><span class="word">ARENA</span></div></div>' +
    '<div class="tx tx-blade"><div class="blade"></div><div class="label"><span class="num">002</span><span class="word">BRACKET</span></div></div>' +
    '<div class="tx tx-corners"><div class="qd tl"></div><div class="qd tr"></div><div class="qd bl"></div><div class="qd br"></div><div class="label"><span class="num">003</span><span class="word">TEAM BATTLE</span></div></div>' +
    '<div class="tx tx-rows dark-label"><div class="rw"></div><div class="rw"></div><div class="rw"></div><div class="rw"></div><div class="rw"></div><div class="rw"></div><div class="label"><span class="num">004</span><span class="word">STANDINGS</span></div></div>' +
    '<div class="tx tx-split"><div class="half l"></div><div class="half r"></div><div class="label"><span class="num">005</span><span class="word">1V1 DUEL</span></div></div>' +
    '<div class="tx tx-ripple"><div class="r1"></div><div class="r2"></div><div class="r3"></div><div class="label"><span class="num">006</span><span class="word">ARENA</span></div></div>' +
    '<div class="tx tx-clock dark-label"><div class="panel"></div><div class="label"><span class="num">007</span><span class="word">ROUND ROBIN</span></div></div>' +
    '<div class="tx tx-stack"><div class="card c1"></div><div class="card c2"></div><div class="card c3"></div><div class="label"><span class="num">008</span><span class="word">MY BRACKETS</span></div></div>' +
    '<div class="tx tx-trio"><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="label"><span class="num">009</span><span class="word">STATS</span></div></div>' +
    '<div class="tx tx-curtain dark-label"><div class="panel"></div><div class="label"><span class="num">010</span><span class="word">THE THRONE</span></div></div>' +
    '<div class="tx tx-wave"><div class="label"><span class="num">011</span><span class="word">MASTERY</span></div></div>' +
    '<div class="tx tx-scan"><div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="ln"></div><div class="label"><span class="num">012</span><span class="word">PRACTICE</span></div></div>' +
    '<div class="tx tx-tiers dark-label"><div class="t s">S</div><div class="t a">A</div><div class="t b">B</div><div class="t c">C</div><div class="t d">D</div><div class="t f">F</div><div class="label"><span class="num">013</span><span class="word">TIER LIST</span></div></div>' +
    '<div class="tx tx-star dark-label"><div class="star-shape"></div><div class="label"><span class="num">014</span><span class="word">FAVORITES</span></div></div>' +
    '<div class="tx tx-blue"><div class="panel"></div><div class="label"><span class="num">015</span><span class="word">YOUR CIRCLE</span></div></div>' +
    '<div class="tx tx-close"><div class="panel"></div><div class="label"><span class="num">016</span><span class="word">PROFILE</span></div></div>';
  document.body.appendChild(wrap);

  // ── Wave tile grid (12 rows × 20 cols = 240 tiles) ────────────────────────
  function buildWave(el) {
    el.querySelectorAll('.tl').forEach(function (t) { t.parentNode.removeChild(t); });
    var label = el.querySelector('.label');
    for (var r = 0; r < 12; r++) {
      for (var c = 0; c < 20; c++) {
        var t = document.createElement('div');
        t.className = 'tl';
        t.style.animationDelay = (c * 22 + Math.abs(r - 6) * 8) + 'ms';
        el.insertBefore(t, label);
      }
    }
  }

  // ── Enter animation (destination page reveals) ────────────────────────────
  function playEnter(cls) {
    var el = document.querySelector('.' + cls);
    if (!el) return;
    if (cls === 'tx-wave') buildWave(el);
    el.classList.add('go', 'enter');
    // stack/rows/tiers/scan stagger max ~250ms + 500ms animation = 750ms
    var cleanup = (cls === 'tx-wave') ? 900 : 750;
    setTimeout(function () { el.classList.remove('go', 'enter'); }, cleanup);
  }

  if (pendingEnter) playEnter(pendingEnter);

  // ── Track last click position for iris origin ──────────────────────────────
  var lastX = window.innerWidth / 2;
  var lastY = window.innerHeight / 2;
  document.addEventListener('click', function (e) { lastX = e.clientX; lastY = e.clientY; }, true);

  // ── Exit animation + page navigation ──────────────────────────────────────
  var busy = false;

  function doNav(href, cfg, el) {
    busy = true;

    // Update label text to match destination
    var numEl = el.querySelector('.num');
    var wordEl = el.querySelector('.word');
    if (numEl) numEl.textContent = cfg.num;
    if (wordEl) wordEl.textContent = cfg.word;

    if (cfg.cls === 'tx-iris') {
      el.style.setProperty('--mx', lastX + 'px');
      el.style.setProperty('--my', lastY + 'px');
    }
    if (cfg.cls === 'tx-wave') buildWave(el);

    try { sessionStorage.setItem('txEnter', cfg.cls); } catch (e) {}
    el.classList.add('go');
    setTimeout(function () { window.location.href = href; }, cfg.mid);
  }

  // ── Click interception ─────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;

    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;
    if (/^(https?:|\/\/|javascript:|mailto:|#)/.test(href)) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank') return;
    if (a.hasAttribute('download')) return;

    var filename = href.split('/').pop().split('?')[0] || 'index.html';
    var cfg = TX_MAP[filename] || DEFAULT_TX;
    var el = document.querySelector('.' + cfg.cls);

    // Must confirm overlay exists and not mid-transition before preventing default
    if (!el || busy) return;

    e.preventDefault();
    doNav(href, cfg, el);
  });

})();
