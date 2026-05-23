/**
 * dashboard-analytics-28.js
 * Mixta Africa Portfolio Intelligence Hub — Predictive Analytics Engine
 *
 * Equivalent of dashboard-pi-engine.js for index 29.
 * Runs 5 predictive models on idle thread after every data sync:
 *   1. OLS Revenue Forecast (3-year projection + confidence band)
 *   2. Collection Recovery (probability-weighted receivables, 24-month timeline)
 *   3. Demand Velocity (moving averages, community momentum)
 *   4. Channel Productivity Score (composite agent index)
 *   5. Strategic Insights (rule-derived action signals)
 *
 * INSTALL (add before </body>, after dashboard-auth-28.js):
 *   <script src="dashboard-analytics-28.js"></script>
 *
 * This file hooks into window.onPostSync (called by index 28 after every
 * successful data load) and window._lastAnalytics (set by renderFromRows).
 * It never blocks the main thread — all computation runs via requestIdleCallback.
 */

(function () {
  'use strict';

  // ── Math primitives ───────────────────────────────────────────────────────

  /** Ordinary Least Squares: y = a + bx. Returns {a, b, r2, sigma, pred(x)} */
  function ols(xs, ys) {
    const n = xs.length;
    if (n < 2) return { a:0, b:0, r2:0, sigma:0, pred: () => 0 };
    const xm = xs.reduce((s,v)=>s+v,0)/n;
    const ym = ys.reduce((s,v)=>s+v,0)/n;
    let sxy=0, sxx=0, sst=0;
    xs.forEach((x,i) => { sxy+=(x-xm)*(ys[i]-ym); sxx+=(x-xm)**2; sst+=(ys[i]-ym)**2; });
    const b = sxx ? sxy/sxx : 0;
    const a = ym - b*xm;
    const sse = xs.reduce((s,x,i) => s+(ys[i]-(a+b*x))**2, 0);
    const sigma = Math.sqrt(sse / Math.max(n-2, 1));
    const r2 = sst ? Math.max(0, 1-sse/sst) : 0;
    return { a, b, r2, sigma, pred: x => a + b*x };
  }

  /** Simple moving average */
  function movAvg(arr, w) {
    return arr.map((_,i) => {
      const sl = arr.slice(Math.max(0,i-w+1), i+1);
      return sl.reduce((s,v)=>s+v,0) / sl.length;
    });
  }

  /** Pearson correlation coefficient */
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const xm = xs.reduce((s,v)=>s+v,0)/n, ym = ys.reduce((s,v)=>s+v,0)/n;
    let num=0, dx=0, dy=0;
    xs.forEach((x,i) => { num+=(x-xm)*(ys[i]-ym); dx+=(x-xm)**2; dy+=(ys[i]-ym)**2; });
    return (dx&&dy) ? num/Math.sqrt(dx*dy) : 0;
  }

  // ── Formatters (mirrors index 28's helpers) ───────────────────────────────
  const fB  = v => '₦' + (v/1e9).toFixed(1) + 'B';
  const fM  = v => '₦' + (v/1e6).toFixed(0) + 'M';
  const fN  = v => v >= 1e9 ? fB(v) : v >= 1e6 ? fM(v) : v.toLocaleString();
  const pct = (a,b) => b ? (a/b*100).toFixed(1)+'%' : '—';

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.textContent = val;
  }

  function mkChart(id, cfg) {
    if (typeof Chart === 'undefined') return;
    const el = document.getElementById(id);
    if (!el) return;
    const existing = Chart.getChart(id);
    if (existing) { try { existing.destroy(); } catch(e){} }
    return new Chart(el, cfg);
  }

  // ── Chart colours ─────────────────────────────────────────────────────────
  const C = {
    red:'#C0392B', red2:'#E74C3C', red3:'#F5B7B1',
    green:'#27AE60', blue:'#2980B9', amber:'#F39C12',
  };

  // ── Model 1: OLS Revenue Forecast ─────────────────────────────────────────
  function runForecast(analytics) {
    const d = analytics;
    if (!d || !d.years || d.years.length < 3) return;

    const xs  = d.years.map(y => parseInt(y));
    const ys  = d.revByYear;
    const m   = ols(xs, ys);
    const lastYr = xs[xs.length-1];

    const proj = [1,2,3].map(k => ({
      yr:   lastYr+k,
      base: Math.max(0, m.pred(lastYr+k)),
      bull: Math.max(0, m.pred(lastYr+k) + m.sigma),
      bear: Math.max(0, m.pred(lastYr+k) - m.sigma),
    }));

    // KPI updates
    setText('pr-ny',  fB(proj[0].base));
    setText('pr-ny-s', 'Bull ' + fB(proj[0].bull) + ' / Bear ' + fB(proj[0].bear));
    setText('pr-r2',  (m.r2*100).toFixed(0) + '%');

    // CAGR
    const n  = d.years.length;
    const fp = d.avgPriceByYear?.[0] || 0;
    const lp = d.avgPriceByYear?.[n-1] || 0;
    const cagr = n>1&&fp>0 ? ((Math.pow(lp/fp, 1/(n-1))-1)*100).toFixed(1)+'%' : '—';
    setText('pr-cagr', cagr);

    const r2Badge = document.getElementById('pr-r2-badge');
    if (r2Badge) {
      r2Badge.textContent = 'R²=' + (m.r2*100).toFixed(0) + '%';
      r2Badge.className   = 'badge ' + (m.r2>.7 ? 'bgrn' : m.r2>.4 ? 'bg_' : 'br');
    }

    // Scenario cards
    [['b','bull'],['m','base'],['r','bear']].forEach(([k,s]) => {
      proj.forEach((p,i) => {
        setText('sc-'+k+(i+1),   fB(p[s]));
        setText('sc-'+k+(i+1)+'y', String(p.yr));
      });
    });

    // Forecast chart
    const allLbls = [...d.years, ...proj.map(p=>String(p.yr))];
    const actuals  = [...d.revByYear, null, null, null];
    const trend    = [...xs.map(x=>m.pred(x)), ...proj.map(p=>p.base)];
    const upper    = [...xs.map(x=>m.pred(x)+m.sigma), ...proj.map(p=>p.bull)];
    const lower    = [...xs.map(x=>Math.max(0,m.pred(x)-m.sigma)), ...proj.map(p=>p.bear)];

    mkChart('c-forecast', {
      type:'line',
      data:{ labels: allLbls, datasets:[
        { label:'Upper', data: upper.map(v=>+(v/1e9).toFixed(2)), borderColor:'transparent', backgroundColor:'rgba(192,57,43,0.10)', fill:'+1', tension:0.4, pointRadius:0 },
        { label:'Trend', data: trend.map(v=>+(v/1e9).toFixed(2)), borderColor:'rgba(192,57,43,0.55)', borderWidth:2, borderDash:[6,3], tension:0.4, pointRadius:0, fill:false },
        { label:'Lower', data: lower.map(v=>+(v/1e9).toFixed(2)), borderColor:'transparent', backgroundColor:'rgba(192,57,43,0.10)', fill:false, tension:0.4, pointRadius:0 },
        { label:'Actual', data: actuals.map(v=>v!=null?+(v/1e9).toFixed(2):null), borderColor:C.red, backgroundColor:'rgba(192,57,43,0.06)', fill:false, tension:0.4, borderWidth:2.5, pointBackgroundColor:C.red, pointRadius:4 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ display:true, position:'top', labels:{ font:{size:10}, boxWidth:9, boxHeight:9 } },
          tooltip:{ callbacks:{ label: c => c.dataset.label+': ₦'+c.parsed.y.toFixed(1)+'B' } }
        },
        scales:{
          x:{ grid:{ color:'rgba(0,0,0,0.04)' } },
          y:{ grid:{ color:'rgba(0,0,0,0.04)' }, ticks:{ callback: v=>'₦'+v+'B' } }
        }
      }
    });

    const fnEl = document.getElementById('forecast-note');
    if (fnEl) fnEl.textContent = 'OLS fitted on '+d.years.length+' years. R²='+(m.r2*100).toFixed(0)+'% variance explained. ±1σ shaded. Assumes no structural break.';
  }

  // ── Model 2: Collection Recovery ──────────────────────────────────────────
  function runRecovery(rows) {
    if (!rows || !rows.length) return;

    const RPROB = { 'Collected':0.99, 'Near Completion':0.92, 'Low Risk':0.78, 'Medium Risk':0.52, 'High Risk':0.22 };
    const RMTHS = { 'Collected':0,    'Near Completion':3,    'Low Risk':6,    'Medium Risk':12,   'High Risk':20   };
    const tiers = Object.keys(RPROB);
    const tData = {};

    tiers.forEach(t => {
      let out=0, exp=0, cnt=0;
      rows.forEach(r => {
        if (r.collectionRisk !== t || !(r._out > 0)) return;
        out += r._out;
        exp += r._out * RPROB[t];
        cnt++;
      });
      tData[t] = { out, exp, cnt };
    });

    // Unmapped rows: logistic curve on pctPaid
    let unmapExp = 0;
    rows.forEach(r => {
      if (r.collectionRisk || !(r._out > 0)) return;
      const p = (r._ppct || 0) / 100;
      unmapExp += r._out * Math.max(0.05, Math.min(0.99, 1/(1+Math.exp(-8*(p-0.5)))));
    });

    const totalRec = tiers.reduce((s,t)=>s+(tData[t]?.exp||0),0) + unmapExp;
    const atRisk   = (tData['High Risk']?.out||0) + (tData['Medium Risk']?.out||0)*0.5;

    setText('pr-rec',  fB(totalRec));
    setText('pr-risk', fB(atRisk));

    // 24-month cumulative recovery timeline
    let cum = 0;
    const resData = Array.from({length:24},(_,i)=>i+1).map(m => {
      tiers.forEach(t => {
        const mtc = RMTHS[t] ?? 12;
        if ((mtc===0&&m===1) || m===mtc) cum += tData[t]?.exp || 0;
      });
      return cum;
    });

    mkChart('c-recovery', {
      type:'line',
      data:{
        labels: Array.from({length:24},(_,i)=>'M'+(i+1)),
        datasets:[{
          label:'Cumulative Recovery',
          data: resData.map(v=>+(v/1e9).toFixed(2)),
          borderColor:C.green, backgroundColor:'rgba(39,174,96,0.08)',
          fill:true, tension:0.4, borderWidth:2.5, pointRadius:0
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ tooltip:{ callbacks:{ label: c=>'₦'+c.parsed.y.toFixed(1)+'B recovered' } } },
        scales:{
          x:{ grid:{ color:'rgba(0,0,0,0.04)' } },
          y:{ grid:{ color:'rgba(0,0,0,0.04)' }, ticks:{ callback: v=>'₦'+v+'B' } }
        }
      }
    });

    // Recovery waterfall bars
    const rwEl = document.getElementById('rec-waterfall');
    if (rwEl) {
      rwEl.innerHTML = '';
      const maxO = Math.max(...tiers.map(t=>tData[t]?.out||0)) || 1;
      const cls = { 'Collected':'bgrn','Near Completion':'bgrn','Low Risk':'bg_','Medium Risk':'bg_','High Risk':'br' };

      tiers.filter(t => tData[t]?.out > 0).forEach(t => {
        const d2    = tData[t];
        const pct2  = d2.out > 0 ? (d2.exp/d2.out*100).toFixed(0) : 0;
        rwEl.innerHTML += `
          <div class="sbar-row">
            <div class="sbar-lbl"><span class="badge ${cls[t]||'bg_'}">${t}</span></div>
            <div style="flex:1;position:relative;height:16px;background:#F0F0F4;border-radius:4px;overflow:hidden">
              <div style="position:absolute;left:0;top:0;height:100%;width:${(d2.exp/maxO*100).toFixed(0)}%;background:${C.green};border-radius:4px"></div>
              <div style="position:absolute;left:${(d2.exp/maxO*100).toFixed(0)}%;top:0;height:100%;width:${((d2.out-d2.exp)/maxO*100).toFixed(0)}%;background:rgba(192,57,43,0.3)"></div>
            </div>
            <div class="sbar-val">${fB(d2.exp)} recoverable (${pct2}%)</div>
          </div>`;
      });
    }
  }

  // ── Model 3: Demand Velocity ───────────────────────────────────────────────
  function runVelocity(analytics) {
    const d = analytics;
    if (!d || !d.years || d.years.length < 3) return;

    const ma3   = movAvg(d.unitsByYear, 3);
    const ma2   = movAvg(d.unitsByYear, 2);
    const slope = ma3.length > 1 ? ma3[ma3.length-1] - ma3[Math.max(0,ma3.length-3)] : 0;
    const trend = slope>2 ? 'Accelerating ▲' : slope<-2 ? 'Decelerating ▼' : 'Stable →';
    setText('pr-dem', trend);

    mkChart('c-mavg', {
      type:'bar',
      data:{ labels: d.years, datasets:[
        { label:'Annual Units', data:d.unitsByYear, backgroundColor:'rgba(192,57,43,0.15)', borderRadius:4, borderSkipped:false },
        { label:'3yr MA', data:ma3.map(v=>+v.toFixed(1)), type:'line', borderColor:C.red, backgroundColor:'transparent', borderWidth:2.5, tension:0.4, pointRadius:3 },
        { label:'2yr MA', data:ma2.map(v=>+v.toFixed(1)), type:'line', borderColor:C.blue, backgroundColor:'transparent', borderWidth:1.5, borderDash:[4,2], tension:0.4, pointRadius:0 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ display:true, position:'top', labels:{ font:{size:10}, boxWidth:9, boxHeight:9 } } },
        scales:{
          x:{ grid:{display:false} },
          y:{ grid:{ color:'rgba(0,0,0,0.04)' }, ticks:{ callback: v=>v+'u' } }
        }
      }
    });

    // Community velocity scores (from commYearMatrix — no row scanning)
    const velEl = document.getElementById('vel-bars');
    if (!velEl || !d.commYearMatrix || !d.communities) return;
    velEl.innerHTML = '';
    const n = d.years.length;

    const scores = d.communities.map(comm => {
      if (n < 4) return { comm, score:100 };
      // Use commYearMatrix revenue presence as proxy for activity
      const recent = d.years.slice(-2).reduce((s,y)=>s+((d.commYearMatrix[comm]?.[y]||0)>0?1:0),0)/2;
      const prior  = d.years.slice(-4,-2).reduce((s,y)=>s+((d.commYearMatrix[comm]?.[y]||0)>0?1:0),0)/2;
      return { comm, score: prior>0 ? Math.round((recent/prior)*100) : 100 };
    }).sort((a,b)=>b.score-a.score);

    scores.forEach(({comm,score}) => {
      const col = score>110 ? C.green : score>90 ? C.amber : C.red;
      const lbl = score>110 ? 'Accelerating' : score>90 ? 'Stable' : 'Slowing';
      velEl.innerHTML += `
        <div class="sbar-row">
          <div class="sbar-lbl">${comm}</div>
          <div class="sbar-wrap"><div class="sbar-fill" style="width:${Math.min(100,(score/150*100)).toFixed(0)}%;background:${col}"></div></div>
          <div class="sbar-val">${score} <span style="color:${col};font-size:9px">${lbl}</span></div>
        </div>`;
    });
  }

  // ── Model 4: Channel Productivity ─────────────────────────────────────────
  function runChannels(analytics) {
    const d = analytics;
    if (!d || !d.agentGroups || !d.agentGroups.length) return;

    const maxR = Math.max(...d.agentGrpRev) || 1;
    const maxU = Math.max(...d.agentGrpCnt) || 1;

    const scores = d.agentGroups.map((ag,i) => ({
      name:  ag,
      score: Math.round(0.6*(d.agentGrpRev[i]/maxR*100) + 0.4*(d.agentGrpCnt[i]/maxU*100)),
      rev:   d.agentGrpRev[i],
      units: d.agentGrpCnt[i],
    })).sort((a,b) => b.score-a.score);

    const el = document.getElementById('agent-scores');
    if (!el) return;
    el.innerHTML = '';
    scores.forEach((ag,i) => {
      const col = ag.score>70 ? C.green : ag.score>40 ? C.amber : C.red;
      el.innerHTML += `
        <div class="sbar-row">
          <div class="sbar-lbl"><span class="rn">${i+1}</span> ${ag.name.length>20?ag.name.slice(0,19)+'\u2026':ag.name}</div>
          <div class="sbar-wrap"><div class="sbar-fill" style="width:${ag.score}%;background:${col}"></div></div>
          <div class="sbar-val">${ag.score}/100 <span style="color:var(--text3)">${fB(ag.rev)}</span></div>
        </div>`;
    });
  }

  // ── Model 5: Strategic Insights ────────────────────────────────────────────
  function runInsights(analytics, rows) {
    const d = analytics;
    if (!d || !d.years || d.years.length < 2) return;

    const xs      = d.years.map(y => parseInt(y));
    const m       = ols(xs, d.revByYear);
    const lastYr  = xs[xs.length-1];
    const lastRev = d.revByYear[d.revByYear.length-1] || 0;
    const nextRev = Math.max(0, m.pred(lastYr+1));
    const growth  = lastRev>0 ? ((nextRev-lastRev)/lastRev*100).toFixed(0) : 0;

    // High risk receivables (single pass on rows)
    let hrOut=0, hrCnt=0;
    (rows||[]).forEach(r => {
      if (r.collectionRisk==='High Risk' && r._out>0) { hrOut+=r._out; hrCnt++; }
    });

    // Price-demand elasticity (from pre-aggregated arrays)
    const pd = (d.avgPriceByYear||[]).slice(1).map((v,i)=>v-(d.avgPriceByYear[i]||0));
    const vd = (d.unitsByYear||[]).slice(1).map((v,i)=>v-(d.unitsByYear[i]||0));
    const pcorr = pearson(pd, vd);

    // Community velocity (from commYearMatrix)
    const n = d.years.length;
    const velScores = (d.communities||[]).map(comm => {
      const rec = n>=4 ? d.years.slice(-2).reduce((s,y)=>s+(d.commYearMatrix[comm]?.[y]||0),0)/2 : 0;
      const pri = n>=4 ? d.years.slice(-4,-2).reduce((s,y)=>s+(d.commYearMatrix[comm]?.[y]||0),0)/2 : 1;
      return { comm, score: pri>0 ? Math.round((rec/pri)*100) : 100 };
    });
    const topVel = [...velScores].sort((a,b)=>b.score-a.score)[0];
    const botVel = [...velScores].sort((a,b)=>a.score-b.score)[0];

    const insights = [];

    if (growth > 10) {
      insights.push({ ico:'📈', type:'high', title:'Strong revenue growth projected', sub:`OLS model projects ${growth}% growth next year (${fB(nextRev)}). Capitalise by accelerating the launch pipeline.` });
    } else if (growth < 0) {
      insights.push({ ico:'⚠️', type:'low', title:'Revenue contraction signal', sub:`Model projects ${Math.abs(growth)}% decline. Review pricing, channel mix, and product pipeline.` });
    } else {
      insights.push({ ico:'📊', type:'med', title:'Steady revenue outlook', sub:`Projected growth of ${growth}% aligns with the historical trend. Focus on margin optimisation over volume.` });
    }

    if (hrOut > 5e8) {
      insights.push({ ico:'🔴', type:'low', title:`₦${(hrOut/1e9).toFixed(1)}B in high-risk receivables`, sub:`${hrCnt} units below 25% paid with ~22% recovery probability. Escalate to the collections task force immediately.` });
    }

    if (topVel && topVel.score > 110) {
      insights.push({ ico:'🏘️', type:'high', title:`${topVel.comm} is the fastest-growing community`, sub:`Velocity index ${topVel.score}. Prioritise inventory allocation and pricing power here for maximum return.` });
    }
    if (botVel && botVel.score < 80) {
      insights.push({ ico:'📉', type:'low', title:`${botVel.comm} showing demand softness`, sub:`Velocity index ${botVel.score}. Absorption is slowing. Review pricing, product mix, or channel activation in this community.` });
    }
    if (pcorr < -0.5) {
      insights.push({ ico:'💹', type:'med', title:'Price-sensitive demand detected', sub:`Pearson r=${pcorr.toFixed(2)}: volume drops when price rises. Value-add and payment plan flexibility will sustain absorption better than price increases.` });
    } else if (pcorr > 0.3) {
      insights.push({ ico:'🎯', type:'high', title:'Aspirational buyer base confirmed', sub:`Positive price-volume correlation (r=${pcorr.toFixed(2)}) signals buyers upgrade as prices rise. Premium positioning is sustainable.` });
    }

    const el = document.getElementById('insights-wrap');
    if (!el) return;
    el.innerHTML = '';
    insights.slice(0,5).forEach(ins => {
      const bg  = ins.type==='high'?'#EAFAF1':ins.type==='low'?'#FDECEA':'#FEF9E7';
      const bdr = ins.type==='high'?'#A9DFBF':ins.type==='low'?'#F5B7B1':'#FAD7A0';
      el.innerHTML += `
        <div style="background:${bg};border:1px solid ${bdr};border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start">
          <div style="font-size:18px;flex-shrink:0;margin-top:1px">${ins.ico}</div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:2px">${ins.title}</div>
            <div style="font-size:11px;color:var(--text2);line-height:1.45">${ins.sub}</div>
          </div>
        </div>`;
    });
  }

  // ── Schedule all 5 models via requestIdleCallback ─────────────────────────
  // requestIdleCallback fires only when the browser's main thread is genuinely
  // idle between frames. This guarantees zero UI freeze regardless of data size.
  // Falls back to setTimeout(100) in browsers that don't support rIC (rare).
  function schedule(rows) {
    const analytics = window._lastAnalytics;
    if (!analytics) return;

    const ric = window.requestIdleCallback
      || (cb => setTimeout(() => cb({ timeRemaining: () => 50 }), 100));

    ric(() => { try { runForecast(analytics);       } catch(e){ console.warn('[PI-28 M1]', e); } });
    ric(() => { try { runRecovery(rows);             } catch(e){ console.warn('[PI-28 M2]', e); } });
    ric(() => { try { runVelocity(analytics);        } catch(e){ console.warn('[PI-28 M3]', e); } });
    ric(() => { try { runChannels(analytics);        } catch(e){ console.warn('[PI-28 M4]', e); } });
    ric(() => { try { runInsights(analytics, rows);  } catch(e){ console.warn('[PI-28 M5]', e); } });
  }

  // ── Hook into the dashboard's data pipeline ───────────────────────────────
  // index 28 calls window.onPostSync() after every successful loadData().
  // We patch it here so models re-run after every sync, exactly as
  // dashboard-pi-engine.js patches syncWithGoogleSheet in index 29.
  function hook() {
    // Patch window.onPostSync (we'll define it in index 28's onAuthGateReady)
    const origPost = window.onPostSync;
    window.onPostSync = function(rows) {
      if (typeof origPost === 'function') origPost.apply(this, arguments);
      setTimeout(() => schedule(rows), 400); // small delay for DOM to settle
    };

    // Also patch loadData as a safety net in case onPostSync isn't called
    const origLoad = window.loadData;
    if (typeof origLoad === 'function') {
      window.loadData = async function() {
        const result = await origLoad.apply(this, arguments);
        setTimeout(() => schedule(window._lastAllRows || []), 600);
        return result;
      };
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { hook(); setTimeout(() => schedule(window._lastAllRows || []), 1200); });
  } else {
    hook();
    setTimeout(() => schedule(window._lastAllRows || []), 1200);
  }

  // Public API — allows manual trigger after a sync
  window._analytics28 = { run: schedule };

})();
