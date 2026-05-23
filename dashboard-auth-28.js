/**
 * dashboard-analytics-28.js  — FIXED BUILD
 * Mixta Africa Portfolio Intelligence Hub — Predictive Analytics Bridge
 *
 * ROOT CAUSE OF ORIGINAL BUGS (all fixed here):
 *   1. window._lastAnalytics was never set by index.html → every model silently exited
 *   2. This file targeted wrong element IDs (vel-bars, insights-wrap, agent-scores,
 *      rec-waterfall, pr-ny, pr-rec, pr-risk, pr-dem, sc-b1…) that don't exist in the HTML.
 *      The HTML uses: velocity-bars, strategy-insights, agent-score-bars, recovery-waterfall,
 *      pr-nextyear, pr-recovery, pr-revatrisk, pr-demtrend, sc-bull-1…
 *   3. Two engines (inline HTML + this file) both wrote to the same chart canvases,
 *      causing Chart.js "canvas already in use" errors.
 *
 * FIX STRATEGY:
 *   - Set window._lastAnalytics in the onPostSync hook (so the inline engine can also use it)
 *   - This file now acts as a BRIDGE only: it ensures _lastAnalytics is always populated
 *     and re-triggers the HTML's own computePredictiveAsync/renderPredictive pipeline
 *     after every sync, rather than duplicating it.
 *   - No new charts are created here — the HTML's inline engine owns all chart rendering.
 */

(function () {
  'use strict';

  // ── Bridge: set _lastAnalytics and re-trigger HTML's predictive engine ─────
  function triggerPredictive(rows) {
    if (!rows || !rows.length) return;

    // The HTML's inline engine exposes these globals after renderFromRows runs:
    //   window._lastAllRows    — the raw row array
    //   window.computeAnalytics(rows) → analytics object
    //   window.computePredictiveAsync(analytics, rows) → Promise<P>
    //   window.renderPredictive(analytics, P) → void

    // Safety: all three must exist (they're defined in the inline <script>)
    if (typeof window.computeAnalytics !== 'function' ||
        typeof window.computePredictiveAsync !== 'function' ||
        typeof window.renderPredictive !== 'function') {
      return;
    }

    try {
      const analytics = window.computeAnalytics(rows);
      analytics.currentYearFilter = 'all';
      analytics.currentQtrFilter  = 'all';

      // Expose for any other consumers (e.g. report generator, future modules)
      window._lastAnalytics = analytics;

      // Re-run the inline predictive engine (async, non-blocking)
      window.computePredictiveAsync(analytics, rows)
        .then(P => {
          try { window.renderPredictive(analytics, P); } catch(e) {
            console.warn('[analytics-28 bridge] renderPredictive failed:', e);
          }
        })
        .catch(e => console.warn('[analytics-28 bridge] computePredictiveAsync failed:', e));

    } catch(e) {
      console.warn('[analytics-28 bridge] computeAnalytics failed:', e);
    }
  }

  // ── Hook into the dashboard's data pipeline ───────────────────────────────
  // index.html calls window.onPostSync(rows) after every successful loadData().
  // We patch it here so models re-run after every sync.
  function hook() {
    const origPost = window.onPostSync;
    window.onPostSync = function(rows) {
      // Always call original handler first
      if (typeof origPost === 'function') origPost.apply(this, arguments);
      // Re-trigger predictive with a small delay so the DOM has settled
      setTimeout(() => triggerPredictive(rows), 500);
    };
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  // Hook immediately (this script loads after auth, before data arrives)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hook);
  } else {
    hook();
  }

  // Also fire once after a generous delay in case loadData already ran
  // (e.g. cache hit before this script finished loading)
  setTimeout(() => {
    const rows = window._lastAllRows;
    if (rows && rows.length && !window._lastAnalytics) {
      triggerPredictive(rows);
    }
  }, 1500);

  // Public API — allows manual trigger
  window._analytics28 = { run: triggerPredictive };

})();
