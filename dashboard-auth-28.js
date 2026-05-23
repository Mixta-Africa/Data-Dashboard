/**
 * dashboard-auth-28.js
 * Mixta Africa Portfolio Intelligence Hub — Google Sign-In Gate
 *
 * SECURITY MODEL (two hard gates, both must pass):
 *   Gate 1 — Domain:  email must end with @mixtafrica.com
 *   Gate 2 — Allowlist: email must be in the exact list below
 *
 * If either gate fails → immediate sign-out + clear denial message.
 * Page content is hidden via CSS before ANY JavaScript runs (body.auth-locked).
 * Content only becomes visible after BOTH gates pass.
 *
 * INSTALL (add before </body> in index 28):
 *   <script src="dashboard-auth-28.js"></script>
 *
 * This file is entirely self-contained — it does not depend on any
 * inline script in index.html having run first. Firebase config is
 * hardcoded here to eliminate race conditions on fast refresh or
 * persistent sessions.
 */

(function () {
  'use strict';

  // ── ALLOWLIST ─────────────────────────────────────────────────────────────
  // Add or remove emails here to control who can access the dashboard.
  // Only exact @mixtafrica.com addresses are accepted (both gates must pass).
  // To grant access to everyone on the domain, leave the set empty and the
  // Gate 2 check will pass for any valid @mixtafrica.com address.
  const ALLOWED = new Set([
    "a.arokodare@mixtafrica.com",
    "a.cameron-cole@mixtafrica.com",
    "a.omotayo@mixtafrica.com",
    "a.uwuigbe@mixtafrica.com",
    "c.ajie@mixtafrica.com",
    "c.uwadiale@mixtafrica.com",
    "dcs_nigeria@mixtafrica.com",
    "deji.alli@mixtafrica.com",
    "e.ezeh@mixtafrica.com",
    "h.kacou@mixtafrica.com",
    "ipd_nigeria@mixtafrica.com",
    "j.olowe@mixtafrica.com",
    "k.haastrup@mixtafrica.com",
    "mcc@mixtafrica.com",
    "mn_costingandprocurement@mixtafrica.com",
    "n.anaeto@mixtafrica.com",
    "o.ajala@mixtafrica.com",
    "o.ekpikie@mixtafrica.com",
    "o.olasunkanmi@mixtafrica.com",
    "o.shoyoye@mixtafrica.com",
    "o.tona-obafemi@mixtafrica.com",
    "pmo_nigeria@mixtafrica.com",
    "r.idaeho@mixtafrica.com",
    "r.jolaiya@mixtafrica.com",
    "s.hughes@mixtafrica.com",
    "t.adebule@mixtafrica.com",
    "t.adeniyi@mixtafrica.com",
    "t.banjo@mixtafrica.com",
    "t.ibidokun@mixtafrica.com",
    "u.ojembe@mixtafrica.com",
    "w.salami@mixtafrica.com",
    "b.ajayi@mixtafrica.com",
    "o.isabu@mixtafrica.com",
    "o.james@mixtafrica.com",
    "o.ogunewu@mixtafrica.com",
  ]);

  // Set to true to bypass Gate 2 and allow any @mixtafrica.com email.
  const ALLOW_FULL_DOMAIN = false;

  const REQUIRED_DOMAIN = 'mixtafrica.com';

  // Contact shown in the denial message
  const ACCESS_CONTACT = 'o.olasunkanmi@mixtafrica.com';

  // ── FIREBASE CONFIG ───────────────────────────────────────────────────────
  // Hardcoded here so this file never depends on index.html having run first.
  // This is index 28's own Firebase project — data-dashboard-ad94f.
  const FIREBASE_CFG = {
    apiKey:            "AIzaSyB2TvSXbXOAutbt0MqJeOrn-7hKfpaqfAo",
    authDomain:        "data-dashboard-ad94f.firebaseapp.com",
    projectId:         "data-dashboard-ad94f",
    storageBucket:     "data-dashboard-ad94f.firebasestorage.app",
    messagingSenderId: "1012632142221",
    appId:             "1:1012632142221:web:1aa118b847705bd1353dc4"
  };

  // ── IDLE TIMEOUT ──────────────────────────────────────────────────────────
  const IDLE_MINUTES        = 60;
  const WARNING_BEFORE_SECS = 60;
  const IDLE_MS             = IDLE_MINUTES * 60 * 1000;
  const WARNING_MS          = IDLE_MS - (WARNING_BEFORE_SECS * 1000);

  // ── STATE ─────────────────────────────────────────────────────────────────
  let _auth        = null;
  let _ready       = false;
  let _signedIn    = false;
  let _idleTimer   = null;
  let _warnTimer   = null;
  let _warnEl      = null;
  let _countdownId = null;

  // ── CSS — injected synchronously before anything renders ─────────────────
  (function injectCSS() {
    const s = document.createElement('style');
    s.id = 'ag28-style';
    s.textContent = `
      /* Lock body — dashboard is invisible until both gates pass */
      body.auth-locked > *:not(#auth-gate-overlay) {
        display:            none !important;
        visibility:         hidden !important;
        pointer-events:     none !important;
      }
      body.auth-locked #auth-gate-overlay {
        display: flex !important;
      }

      /* Auth overlay */
      #auth-gate-overlay {
        display:         none;
        position:        fixed;
        inset:           0;
        z-index:         2147483647;
        align-items:     center;
        justify-content: center;
        background:      linear-gradient(135deg, #fdf2f2 0%, #f5f0f8 100%);
        font-family:     'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .ag28-card {
        background:    #fff;
        border-radius: 20px;
        padding:       44px 40px 36px;
        width:         100%;
        max-width:     400px;
        box-shadow:    0 2px 4px rgba(0,0,0,0.04),
                       0 8px 24px rgba(0,0,0,0.10),
                       0 24px 48px rgba(0,0,0,0.06);
        text-align:    center;
      }
      .ag28-logo {
        width:56px; height:56px; border-radius:12px; object-fit:contain;
        margin:0 auto 18px; display:block; background:#f5f5f5;
      }
      .ag28-card h1 {
        font-size:21px; font-weight:800; color:#1a1a1a;
        letter-spacing:-0.03em; margin-bottom:6px;
      }
      .ag28-card h1 span { color:#C0392B; }
      .ag28-subtitle {
        font-size:13px; color:#888; margin-bottom:30px; line-height:1.5;
      }

      /* Google sign-in button */
      .ag28-google-btn {
        display:flex; align-items:center; justify-content:center; gap:12px;
        width:100%; padding:13px 20px;
        background:#fff; color:#3c4043;
        border:1.5px solid #dadce0; border-radius:10px;
        font-size:14px; font-weight:600; cursor:pointer;
        font-family:inherit;
        box-shadow:0 1px 3px rgba(0,0,0,0.08);
        margin-bottom:12px;
        transition:all 0.18s;
      }
      .ag28-google-btn:hover  { background:#f8f9fa; border-color:#bbb; box-shadow:0 2px 8px rgba(0,0,0,0.12); }
      .ag28-google-btn:active { transform:scale(0.99); }
      .ag28-google-btn:disabled { opacity:0.55; cursor:default; transform:none; }

      .ag28-hint {
        font-size:11.5px; color:#bbb; margin-bottom:18px; letter-spacing:0.01em;
      }
      .ag28-msg {
        min-height:18px; font-size:12px; font-weight:600;
        color:#c62828; padding:0 4px; line-height:1.5;
      }
      .ag28-msg.info { color:#555; font-weight:500; }

      /* Denial block */
      .ag28-denied {
        background:#fff5f5; border:1px solid #ffcdd2; border-radius:10px;
        padding:14px 16px; font-size:12.5px; color:#b71c1c;
        line-height:1.6; margin-top:16px; text-align:left;
      }
      .ag28-denied strong { display:block; margin-bottom:4px; font-size:13px; }

      /* Spinner */
      .ag28-spin {
        display:inline-block; width:16px; height:16px;
        border:2px solid #dadce0; border-top-color:#4285f4;
        border-radius:50%; animation:ag28Spin 0.7s linear infinite;
      }
      @keyframes ag28Spin { to { transform:rotate(360deg); } }

      /* Idle warning banner */
      #ag28-idle-warn {
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        z-index:2147483646;
        background:#1a1a1a; color:#fff;
        border-radius:12px; padding:14px 22px;
        font-family:'DM Sans',-apple-system,sans-serif;
        font-size:13px; font-weight:600;
        box-shadow:0 8px 32px rgba(0,0,0,0.28);
        display:flex; align-items:center; gap:14px;
        white-space:nowrap;
        animation:ag28Warn 0.25s cubic-bezier(0.34,1.56,0.64,1);
        max-width:calc(100vw - 40px);
      }
      @keyframes ag28Warn {
        from { opacity:0; transform:translateX(-50%) translateY(12px); }
        to   { opacity:1; transform:translateX(-50%) translateY(0); }
      }
      #ag28-idle-warn .iw-secs {
        background:rgba(255,255,255,0.15); border-radius:6px;
        padding:2px 8px; font-size:12px; min-width:36px;
        text-align:center; font-variant-numeric:tabular-nums;
      }
      #ag28-idle-warn .iw-stay {
        background:#C0392B; color:#fff; border:none;
        border-radius:7px; padding:6px 14px;
        font-size:12px; font-weight:700; cursor:pointer;
        font-family:inherit; flex-shrink:0; transition:background 0.15s;
      }
      #ag28-idle-warn .iw-stay:hover { background:#922B21; }

      /* User badge injected into dashboard header */
      .ag28-nav-badge {
        display:inline-flex; align-items:center; gap:6px;
        font-size:11px; font-weight:600; color:var(--red, #C0392B);
        background:var(--red4, #FDECEA);
        border:1px solid var(--red3, #F5B7B1);
        border-radius:100px; padding:4px 12px 4px 8px;
        white-space:nowrap;
      }
      .ag28-nav-badge::before {
        content:''; width:7px; height:7px; border-radius:50%;
        background:#27AE60; flex-shrink:0;
      }
      .ag28-signout-btn {
        font-size:11px; font-weight:600;
        padding:4px 10px; border-radius:6px;
        border:1px solid var(--red3,#F5B7B1);
        background:var(--red4,#FDECEA); color:var(--red,#C0392B);
        cursor:pointer; font-family:inherit; transition:background 0.15s;
      }
      .ag28-signout-btn:hover { background:var(--red3,#F5B7B1); }
    `;
    document.head.appendChild(s);
  })();

  // ── Lock body immediately (synchronous) ───────────────────────────────────
  document.body.classList.add('auth-locked');

  // ── Overlay HTML — injected by JS so it's always the first body child ─────
  function injectOverlay() {
    if (document.getElementById('auth-gate-overlay')) return; // already injected

    const GOOGLE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>`;

    const el = document.createElement('div');
    el.id = 'auth-gate-overlay';
    el.innerHTML = `
      <div class="ag28-card">
        <img src="Mixta Africa.jpg" alt="Mixta Africa" class="ag28-logo"
             onerror="this.style.display='none'">
        <h1>Portfolio <span>Intelligence Hub</span></h1>
        <p class="ag28-subtitle">Mixta Africa — Commercial Analytics Dashboard</p>
        <button class="ag28-google-btn" id="ag28-btn" onclick="_authGate28.signIn()">
          ${GOOGLE_SVG}
          <span id="ag28-btn-label">Sign in with Google</span>
        </button>
        <p class="ag28-hint">Use your @mixtafrica.com account</p>
        <p class="ag28-msg" id="ag28-msg"></p>
      </div>
    `;
    // Insert as very first child so auth-locked CSS can never hide it
    document.body.insertBefore(el, document.body.firstChild);
  }

  // ── Gate checks ───────────────────────────────────────────────────────────
  function checkAccess(email) {
    const e = (email || '').toLowerCase().trim();
    const domain = e.split('@')[1] || '';
    if (domain !== REQUIRED_DOMAIN) return { ok: false, reason: 'domain', email: e };
    if (!ALLOW_FULL_DOMAIN && !ALLOWED.has(e)) return { ok: false, reason: 'allowlist', email: e };
    return { ok: true, email: e };
  }

  // ── Unlock — only called after both gates pass ────────────────────────────
  function unlock(user) {
    _signedIn = true;
    document.body.classList.remove('auth-locked');

    const overlay = document.getElementById('auth-gate-overlay');
    if (overlay) overlay.style.display = 'none';

    injectNavBadge(user);
    startIdleTracking();

    // Call dashboard's ready callback — equivalent to dashboard-auth.js calling
    // window.onAuthGateReady() after sign-in in index 29.
    if (typeof window.onAuthGateReady === 'function') {
      window.onAuthGateReady();
      window.onAuthGateReady = null; // fire once only
    }

    console.log('[Auth28] Unlocked for:', user.email);
  }

  // ── Deny — sign out and show clear rejection message ─────────────────────
  function deny(result) {
    if (_auth) _auth.signOut().catch(() => {});
    _signedIn = false;
    setBtnReady();
    setMsg('', true);

    const card = document.querySelector('.ag28-card');
    if (!card) return;
    const old = document.getElementById('ag28-denied-block');
    if (old) old.remove();

    const block = document.createElement('div');
    block.id = 'ag28-denied-block';
    block.className = 'ag28-denied';

    if (result.reason === 'domain') {
      block.innerHTML = `<strong>Wrong account</strong>
        <b>${esc(result.email)}</b> is not a Mixta Africa account.
        Please sign in with your <b>@${REQUIRED_DOMAIN}</b> company email.`;
    } else {
      block.innerHTML = `<strong>Access not granted</strong>
        <b>${esc(result.email)}</b> is not on the approved list for this dashboard.
        Contact <a href="mailto:${esc(ACCESS_CONTACT)}" style="color:#c62828">${esc(ACCESS_CONTACT)}</a> to request access.`;
    }
    card.appendChild(block);
  }

  // ── Auth state handler — the ONLY gate that matters ───────────────────────
  // Called by Firebase when session state changes.
  // Never calls signOut() directly here — that causes an observer loop.
  // Denial is handled by calling deny() which signs out asynchronously.
  function onAuthState(user) {
    if (!user) {
      setBtnReady();
      return;
    }

    const result = checkAccess(user.email);
    if (!result.ok) {
      deny(result);
      return;
    }

    unlock(user);
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  function signIn() {
    if (!_ready) { setMsg('Loading… please wait.', true); return; }
    setBtnLoading();
    setMsg('Opening Google sign-in…', true);

    const provider = new firebase.auth.GoogleAuthProvider();
    // prompt:'select_account' forces account picker every time so users can't
    // accidentally reuse a personal account from a previous browser session.
    // NO hd: hint — hd restricts the picker and causes silent failures when
    // the user picks an account from a different session. Gate 1 (domain check)
    // handles rejection cleanly after the popup completes.
    provider.setCustomParameters({ prompt: 'select_account' });

    _auth.signInWithPopup(provider).catch(err => {
      setBtnReady();
      if (err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request') {
        setMsg('Sign-in cancelled.', true);
      } else if (err.code === 'auth/popup-blocked') {
        setMsg('Popup blocked — allow popups for this site and try again.', false);
      } else if (err.code === 'auth/unauthorized-domain') {
        setMsg('Domain not authorised in Firebase Console. Add this site under Authentication → Settings → Authorised domains.', false);
      } else if (err.code === 'auth/operation-not-allowed') {
        setMsg('Google Sign-In not enabled. Go to Firebase Console → Authentication → Sign-in method → Enable Google.', false);
      } else {
        setMsg('Error: ' + err.message, false);
      }
      console.error('[Auth28]', err.code, err.message);
    });
  }

  // ── Sign out ──────────────────────────────────────────────────────────────
  function signOut(reason) {
    stopIdleTracking();
    if (_auth) _auth.signOut().catch(() => {});
    _signedIn = false;

    document.body.classList.add('auth-locked');
    const overlay = document.getElementById('auth-gate-overlay');
    if (overlay) overlay.style.display = 'flex';

    const denied = document.getElementById('ag28-denied-block');
    if (denied) denied.remove();

    const badge = document.getElementById('ag28-nav-badge-wrap');
    if (badge) badge.remove();

    // Restore original user strip visibility state
    const strip = document.getElementById('userStrip');
    if (strip) strip.style.display = 'none';

    setBtnReady();
    if (reason === 'idle') {
      setMsg('Signed out after ' + IDLE_MINUTES + ' minutes of inactivity.', true);
    } else {
      setMsg('', true);
    }
  }

  // ── Firebase init ─────────────────────────────────────────────────────────
  function initAuth(attempts) {
    if (typeof firebase === 'undefined') {
      if (attempts < 50) setTimeout(() => initAuth(attempts + 1), 200);
      else setMsg('Firebase SDK failed to load. Check your connection and refresh.', false);
      return;
    }

    // Initialize if no app exists yet
    if (!firebase.apps || firebase.apps.length === 0) {
      try {
        firebase.initializeApp(FIREBASE_CFG);
      } catch (e) {
        if (!e.message || !e.message.includes('already')) {
          setMsg('Firebase init failed: ' + e.message, false);
          console.error('[Auth28] Init error:', e);
          return;
        }
      }
    }

    _auth  = firebase.auth();
    _ready = true;

    // onAuthStateChanged is the single source of truth.
    // Fires immediately if a session is already persisted from a previous visit.
    _auth.onAuthStateChanged(onAuthState);
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  function setMsg(text, isInfo) {
    const el = document.getElementById('ag28-msg');
    if (!el) return;
    el.textContent = text;
    el.className   = 'ag28-msg' + (isInfo ? ' info' : '');
  }

  function setBtnLoading() {
    const btn = document.getElementById('ag28-btn');
    const lbl = document.getElementById('ag28-btn-label');
    if (btn) btn.disabled = true;
    if (lbl) lbl.innerHTML = '<span class="ag28-spin"></span>';
  }

  function setBtnReady() {
    const btn = document.getElementById('ag28-btn');
    const lbl = document.getElementById('ag28-btn-label');
    if (btn) btn.disabled = false;
    if (lbl) lbl.textContent = 'Sign in with Google';
  }

  function injectNavBadge(user) {
    // Remove any existing badge
    const old = document.getElementById('ag28-nav-badge-wrap');
    if (old) old.remove();

    // Hide the old inline user strip from index.html
    const strip = document.getElementById('userStrip');
    if (strip) strip.style.display = 'none';

    const name = user.displayName ? user.displayName.split(' ')[0] : (user.email || '').split('@')[0];

    const wrap = document.createElement('div');
    wrap.id = 'ag28-nav-badge-wrap';
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
    wrap.innerHTML = `
      <span class="ag28-nav-badge" title="${esc(user.email)}">${esc(name)}</span>
      <button class="ag28-signout-btn" onclick="_authGate28.signOut()">Sign out</button>
    `;

    // Insert into the header's right-side controls
    const hdrRight = document.querySelector('.hdr-right');
    if (hdrRight) {
      // Insert before the live-badge so it appears naturally in the flow
      const liveBadge = hdrRight.querySelector('.live-badge');
      hdrRight.insertBefore(wrap, liveBadge || hdrRight.firstChild);
    }
  }

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Idle timeout ──────────────────────────────────────────────────────────
  const ACTIVITY_EVENTS = ['mousemove','mousedown','keydown','touchstart','touchmove','click','scroll','wheel'];

  function resetIdleTimer() {
    if (!_signedIn) return;
    clearTimeout(_idleTimer);
    clearTimeout(_warnTimer);
    clearInterval(_countdownId);
    hideIdleWarning();

    _warnTimer = setTimeout(showIdleWarning, WARNING_MS);
    _idleTimer = setTimeout(() => { hideIdleWarning(); signOut('idle'); }, IDLE_MS);
  }

  function startIdleTracking() {
    resetIdleTimer();
    ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, resetIdleTimer, { passive: true }));
  }

  function stopIdleTracking() {
    clearTimeout(_idleTimer);
    clearTimeout(_warnTimer);
    clearInterval(_countdownId);
    hideIdleWarning();
    ACTIVITY_EVENTS.forEach(ev => document.removeEventListener(ev, resetIdleTimer));
  }

  function showIdleWarning() {
    if (_warnEl) return;
    let secsLeft = WARNING_BEFORE_SECS;

    _warnEl = document.createElement('div');
    _warnEl.id = 'ag28-idle-warn';
    _warnEl.innerHTML = `
      <span>⏱</span>
      <span>You'll be signed out due to inactivity in</span>
      <span class="iw-secs" id="ag28-warn-secs">${secsLeft}s</span>
      <button class="iw-stay" onclick="_authGate28.staySignedIn()">Stay signed in</button>
    `;
    document.body.appendChild(_warnEl);

    _countdownId = setInterval(() => {
      secsLeft--;
      const el = document.getElementById('ag28-warn-secs');
      if (el) el.textContent = secsLeft + 's';
      if (secsLeft <= 0) clearInterval(_countdownId);
    }, 1000);
  }

  function hideIdleWarning() {
    clearInterval(_countdownId);
    if (_warnEl) { _warnEl.remove(); _warnEl = null; }
  }

  function staySignedIn() { resetIdleTimer(); }

  // ── Public API ────────────────────────────────────────────────────────────
  window._authGate28 = { signIn, signOut, staySignedIn, getUser: () => _auth?.currentUser };
  // Alias for compatibility
  window._authGate   = window._authGate28;
  window.authGate    = window._authGate28;

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    injectOverlay();
    initAuth(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot(); // DOM already ready (e.g. script at end of body)
  }

})();
