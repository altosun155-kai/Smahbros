// pixeltx.js — pixel dissolve page transitions
(function () {
  'use strict';

  var BLOCK = 22;  // px per pixel block
  var busy  = false;

  // ── Easing ────────────────────────────────────────────────
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeIn(t)  { return t * t * t; }

  // ── Sample page color regions via elementFromPoint ────────
  // Returns a 10×10 flat array of rgb strings covering the viewport.
  function samplePageColors() {
    var W = window.innerWidth, H = window.innerHeight;
    var ROWS = 10, COLS = 10;
    var grid = [];
    var fallback = '#08080a';
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var x = (c + 0.5) * W / COLS;
        var y = (r + 0.5) * H / ROWS;
        var el = document.elementFromPoint(x, y);
        var color = fallback;
        if (el) {
          var bg = window.getComputedStyle(el).backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') color = bg;
        }
        grid.push(color);
      }
    }
    return { grid: grid, rows: ROWS, cols: COLS };
  }

  function colorForBlock(sample, bx, by, W, H) {
    var col = Math.min(sample.cols - 1, Math.floor(bx / W * sample.cols));
    var row = Math.min(sample.rows - 1, Math.floor(by / H * sample.rows));
    return sample.grid[row * sample.cols + col];
  }

  // ── Canvas overlay helper ─────────────────────────────────
  function makeCanvas(W, H) {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;display:block';
    document.body.appendChild(c);
    return c;
  }

  // ── EXIT: page shatters into pixels ──────────────────────
  function playExit(href) {
    busy = true;
    var W = window.innerWidth, H = window.innerHeight;
    var cols = Math.ceil(W / BLOCK), rows = Math.ceil(H / BLOCK);

    var sample = samplePageColors();
    var canvas = makeCanvas(W, H);
    var ctx = canvas.getContext('2d');

    // Build blocks — each starts at its grid position, explodes outward
    var cx = W / 2, cy = H / 2;
    var blocks = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var bx = c * BLOCK, by = r * BLOCK;
        var dx = (bx + BLOCK / 2 - cx), dy = (by + BLOCK / 2 - cy);
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var speed = 1.4 + Math.random() * 2.0;
        var nx = dx / len, ny = dy / len;
        blocks.push({
          x: bx, y: by,
          vx: nx * speed, vy: ny * speed + 0.3,
          rot: (Math.random() - 0.5) * 6,
          color: colorForBlock(sample, bx, by, W, H),
          delay: Math.random() * 0.28
        });
      }
    }

    // Draw the grid immediately (covers page with pixel version)
    blocks.forEach(function (b) {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, BLOCK, BLOCK);
    });

    var DUR = 480, NAV_AT = 260;
    var t0 = null, navigated = false;

    function frame(ts) {
      if (!t0) t0 = ts;
      var el = ts - t0;

      if (!navigated && el >= NAV_AT) {
        navigated = true;
        try { sessionStorage.setItem('_ptx', '1'); } catch (e) {}
        window.location.href = href;
        return;
      }

      ctx.clearRect(0, 0, W, H);
      blocks.forEach(function (b) {
        var t  = Math.max(0, Math.min((el / DUR) - b.delay, 1));
        var e  = easeIn(t);
        var x  = b.x + b.vx * e * W * 0.55;
        var y  = b.y + b.vy * e * H * 0.55;
        var sz = BLOCK * Math.max(0.15, 1 - e * 0.6);
        var a  = Math.max(0, 1 - e * 1.3);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = b.color;
        ctx.translate(x + BLOCK / 2, y + BLOCK / 2);
        ctx.rotate(b.rot * e);
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      });

      if (el < NAV_AT) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  // ── ENTER: pixels fly in and dissolve ────────────────────
  function playEnter() {
    var W = window.innerWidth, H = window.innerHeight;
    var cols = Math.ceil(W / BLOCK), rows = Math.ceil(H / BLOCK);
    var canvas = makeCanvas(W, H);
    var ctx = canvas.getContext('2d');

    // Dark palette with a few accent flecks
    var palette = [];
    for (var i = 0; i < 14; i++) palette.push('#08080a');
    palette.push('#0d0d1a', '#0d0d1a', '#1a1a2e', '#1a1a2e',
                 'rgba(255,68,25,0.7)', 'rgba(255,184,0,0.5)');

    var blocks = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var tx = c * BLOCK, ty = r * BLOCK;
        // Start position: scattered randomly off-screen
        var angle = Math.random() * Math.PI * 2;
        var d = (0.9 + Math.random() * 0.8) * Math.max(W, H);
        // Delay based on distance from centre (outer blocks arrive last)
        var distNorm = Math.hypot((tx - W / 2) / W, (ty - H / 2) / H);
        blocks.push({
          tx: tx, ty: ty,
          sx: tx + Math.cos(angle) * d,
          sy: ty + Math.sin(angle) * d,
          color: palette[Math.floor(Math.random() * palette.length)],
          delay: distNorm * 0.22 + Math.random() * 0.1
        });
      }
    }

    var DUR_FLY = 520, DUR_HOLD = 55, DUR_FADE = 220;
    var TOTAL = DUR_FLY + DUR_HOLD + DUR_FADE;
    var t0 = null;

    function frame(ts) {
      if (!t0) t0 = ts;
      var el = ts - t0;

      if (el <= DUR_FLY + DUR_HOLD) {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          var t = easeOut(Math.max(0, Math.min((el / DUR_FLY) - b.delay, 1)));
          ctx.fillStyle = b.color;
          ctx.fillRect(
            b.sx + (b.tx - b.sx) * t,
            b.sy + (b.ty - b.sy) * t,
            BLOCK + 0.5, BLOCK + 0.5
          );
        }
        canvas.style.opacity = '1';
      } else {
        var fp = (el - DUR_FLY - DUR_HOLD) / DUR_FADE;
        canvas.style.opacity = Math.max(0, 1 - fp).toString();
      }

      if (el < TOTAL) {
        requestAnimationFrame(frame);
      } else {
        canvas.parentNode && canvas.parentNode.removeChild(canvas);
      }
    }

    requestAnimationFrame(frame);
  }

  // ── Check for pending enter animation ────────────────────
  var doEnter = false;
  try {
    doEnter = !!sessionStorage.getItem('_ptx');
    if (doEnter) sessionStorage.removeItem('_ptx');
  } catch (e) {}
  if (doEnter) playEnter();

  // ── Intercept link clicks ─────────────────────────────────
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || busy) return;
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || /^(https?:|\/\/|javascript:|mailto:|#)/.test(href)) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    e.preventDefault();
    playExit(href);
  });

})();
