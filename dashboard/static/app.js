/* OptionEdge — app shell (sidebar dashboard) + ViT terminal renderer */
const $ = (s) => document.querySelector(s);
const fmtINR = (v) => "₹" + Math.round(v).toLocaleString("en-IN");
const pct = (v, d = 2) => (v == null ? "—" : (v * 100).toFixed(d) + "%");
let STATE = null;
const charts = {};

/* ---------------- theme-aware chart colors ---------------- */
function C() {
  const light = (document.documentElement.dataset.theme || "dark") === "light";
  return light ? {
    axis: {
      axisLine: { lineStyle: { color: "rgba(15,23,42,.28)" } },
      axisLabel: { color: "#5b6784", fontFamily: "JetBrains Mono", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(15,23,42,.08)" } },
    },
    tip: {
      backgroundColor: "rgba(255,255,255,.97)",
      borderColor: "rgba(14,116,144,.35)",
      textStyle: { color: "#101828", fontFamily: "JetBrains Mono", fontSize: 11 },
    },
    legend: "#5b6784",
    heat: ["#be123c", "#fde8ef", "#ffffff", "#d3f3e7", "#047857"],
    thead: "#f1f5fb",
  } : {
    axis: {
      axisLine: { lineStyle: { color: "rgba(124,139,184,.35)" } },
      axisLabel: { color: "#7c8bb8", fontFamily: "JetBrains Mono", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(124,139,184,.12)" } },
    },
    tip: {
      backgroundColor: "rgba(7,11,24,.95)",
      borderColor: "rgba(34,211,238,.35)",
      textStyle: { color: "#dbe4ff", fontFamily: "JetBrains Mono", fontSize: 11 },
    },
    legend: "#7c8bb8",
    heat: ["#ff3b6b", "#2b1530", "#101830", "#0e3a2e", "#00ffa3"],
    thead: "#0a1024",
  };
}

function mkChart(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  if (charts[id]) charts[id].dispose();
  const c = echarts.init(el, null, { renderer: "canvas" });
  charts[id] = c;
  return c;
}
function destroyCharts() { Object.values(charts).forEach((c) => c.dispose()); }
window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));

function countUp(el, target, opts = {}) {
  const { dec = 0, suffix = "", prefix = "", dur = 1400 } = opts;
  const t0 = performance.now();
  function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const v = target * e;
    el.textContent = prefix + v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function drawdownSeries(equity) {
  let peak = -Infinity;
  return equity.map((p) => {
    peak = Math.max(peak, p[1]);
    return [p[0], +(((p[1] - peak) / peak) * 100).toFixed(2)];
  });
}

/* ---------------- theme toggle ---------------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("oe-theme", t); } catch (e) {}
  $("#themeLbl").textContent = t === "dark" ? "Light Mode" : "Dark Mode";
  $("#themeToggle .ic").textContent = t === "dark" ? "☀" : "🌙";
  if (STATE) { destroyCharts(); renderCharts(STATE); }
}
function initTheme() {
  let saved = "dark";
  try { saved = localStorage.getItem("oe-theme") || "dark"; } catch (e) {}
  setTheme(saved);
  $("#themeToggle").addEventListener("click", () => setTheme((document.documentElement.dataset.theme || "dark") === "dark" ? "light" : "dark"));
}

/* ---------------- sidebar nav / scroll-spy ---------------- */
const SEC_TITLES = {
  dashboard: ["Market Dashboard", "Live ViT attention · model scores per protocol"],
  attention: ["Live Attention", "Where the ViT is looking — last session"],
  predictions: ["Predictions", "Time machine · your data · scenarios · batch sweep"],
  vs: ["Benchmark", "OptionEdge vs the reference paper"],
  alpha: ["Alpha Straddle", "Vol-expansion strategy — the edge that survives"],
  backtest: ["Backtest", "Walk-forward OOS directional backtests"],
  research: ["Research", "How it's built — and what we refuse to fake"],
};
function initNav() {
  const links = [...document.querySelectorAll(".side-nav a")];
  const bySec = {};
  links.forEach((a) => {
    const sec = document.querySelector(a.getAttribute("href"));
    if (sec) bySec[sec.id] = a;
    a.addEventListener("click", () => links.forEach((l) => l.classList.remove("on")));
    a.addEventListener("click", () => a.classList.add("on"));
  });
  function setActive(id) {
    if (!bySec[id]) return;
    links.forEach((l) => l.classList.toggle("on", l === bySec[id]));
    const t = SEC_TITLES[id];
    if (t) { $("#pageTitle").textContent = t[0]; $("#pageSub").textContent = t[1]; }
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
  }, { rootMargin: "-25% 0px -65% 0px" });
  Object.keys(bySec).forEach((id) => io.observe(document.getElementById(id)));
  const st = $("#sideToggle"), sb = $("#sidebar");
  if (st && sb) st.addEventListener("click", () => sb.classList.toggle("open"));
}

/* ---------------- status ---------------- */
function setStatus(ok) {
  const dot = $("#sideDot"), txt = $("#sideStatusTxt"), sub = $("#sideStatusSub"), top = $("#topStatusTxt");
  dot.classList.toggle("off", !ok);
  txt.textContent = ok ? "Online" : "Offline";
  sub.textContent = ok ? `${STATE.meta.n_samples.toLocaleString("en-IN")} sessions · ViT live` : "state unavailable";
  top.textContent = ok ? "Online" : "Offline";
}

/* ---------------- KPI stat row (dashboard header) ---------------- */
function renderKpiRow(st) {
  const M = st.models, BT = st.backtests;
  const ens = M["Ensemble"], ensOOS = ens["walk-forward OOS"], ebt = BT["Ensemble"];
  const aBT = st.alpha.backtest;
  const best = Object.entries(M)
    .map(([n, m]) => [n, m["walk-forward OOS"].acc_updown])
    .sort((a, b) => b[1] - a[1])[0];
  const sig = st.attention.signal;
  const cards = [
    { l: "Sessions Tracked", type: "num", v: st.meta.n_samples, dec: 0, sub: `NIFTY 50 · ${st.meta.data_from.slice(2)} → ${st.meta.data_to.slice(2)}`, glow: "rgba(34,211,238,.3)" },
    { l: "Last Signal", type: "sig", v: sig, sub: `${st.attention.date} · close ${fmtINR(st.hero.close)}`, glow: sig === "BUY" ? "rgba(0,255,163,.25)" : sig === "SELL" ? "rgba(255,59,107,.25)" : "rgba(250,204,21,.25)" },
    { l: "Honest OOS Acc", type: "num", v: ensOOS.acc_updown * 100, dec: 1, suffix: "%", sub: `walk-forward up/down · base ${(ensOOS.base_rate_up * 100).toFixed(0)}%`, glow: "rgba(232,121,249,.28)" },
    { l: "OOS Sharpe", type: "num", v: ebt.sharpe, dec: 2, sub: `ensemble options P&L · win ${ebt.win_rate_pct}%`, glow: "rgba(34,211,238,.28)" },
    { l: "Top OOS Model", type: "txt", v: best[0], sub: `walk-fwd up/down ${(best[1] * 100).toFixed(1)}%`, glow: "rgba(250,204,21,.25)" },
    { l: "Alpha Straddle", type: "num", v: aBT.total_return_pct, dec: 1, prefix: "+", suffix: "%", sub: `OOS 2020→26 · Sharpe ${aBT.sharpe}`, glow: "rgba(0,255,163,.28)" },
    { l: "NIFTY Last Close", type: "num", v: st.hero.close, dec: 0, prefix: "₹", sub: st.hero.date, glow: "rgba(96,165,250,.28)" },
  ];
  $("#kpiRow").innerHTML = cards.map((c) => {
    const cls = c.type === "sig" ? c.v.toLowerCase() : "";
    const body = c.type === "txt"
      ? `<div class="k-val">${c.v}</div>`
      : `<div class="k-val ${cls}" data-v="${c.v}" data-dec="${c.dec}" data-s="${c.suffix || ""}" data-p="${c.prefix || ""}">0</div>`;
    return `<div class="kstat" style="--k-glow:${c.glow}"><div class="k-lbl">${c.l}</div>${body}<div class="k-sub">${c.sub}</div></div>`;
  }).join("");
  document.querySelectorAll("#kpiRow .k-val[data-v]").forEach((el) =>
    countUp(el, +el.dataset.v, { dec: +el.dataset.dec, suffix: el.dataset.s, prefix: el.dataset.p }));
}

/* ---------------- model roster table: filter / search / sort ---------------- */
const FAMS = { ViT: "deep", LSTM: "deep", XGBoost: "tree", RandomForest: "tree", Ensemble: "stack" };
const FAM_LBL = { deep: "Deep Learning", tree: "Trees", stack: "Stack" };
const rosterState = { fam: "all", q: "", sort: "name" };

function renderRoster() {
  if (!STATE) return;
  const M = STATE.models, BT = STATE.backtests;
  let rows = Object.entries(M).map(([n, m]) => {
    const bt = BT[n] || {};
    return {
      name: n, fam: FAMS[n] || "tree",
      ins: m["in-sample"].acc_3c, insUd: m["in-sample"].acc_updown,
      ps: m["paper-style"].acc_3c, psUd: m["paper-style"].acc_updown,
      oos: m["walk-forward OOS"].acc_3c, oosUd: m["walk-forward OOS"].acc_updown,
      auc: m["walk-forward OOS"].auc_updown,
      ret: bt.total_return_pct, sharpe: bt.sharpe, win: bt.win_rate_pct, trades: bt.n_trades,
    };
  });
  rows = rows.filter((r) =>
    (rosterState.fam === "all" || r.fam === rosterState.fam) &&
    r.name.toLowerCase().includes(rosterState.q));
  const key = {
    name: (r) => r.name, insample: (r) => r.ins, oos: (r) => r.oos,
    auc: (r) => r.auc, return: (r) => (r.ret == null ? -1e9 : r.ret), sharpe: (r) => (r.sharpe == null ? -1e9 : r.sharpe),
  }[rosterState.sort];
  rows.sort((a, b) => rosterState.sort === "name" ? a.name.localeCompare(b.name) : key(b) - key(a));
  $("#modelTbody").innerHTML = rows.length ? rows.map((r) => `
    <tr>
      <td><span class="m-name">${r.name}</span></td>
      <td><span class="m-chip ${r.fam}">${FAM_LBL[r.fam]}</span></td>
      <td>${pct(r.ins, 1)} <span class="dim">/</span> ${pct(r.insUd, 1)}</td>
      <td>${pct(r.ps, 1)} <span class="dim">/</span> ${pct(r.psUd, 1)}</td>
      <td class="oos-cell">${pct(r.oos, 1)} <span class="dim" style="color:var(--dim)">/</span> ${pct(r.oosUd, 1)}</td>
      <td>${r.auc.toFixed(2)}</td>
      <td>${r.ret != null ? r.ret.toFixed(0) + "%" : "—"}</td>
      <td>${r.sharpe != null ? r.sharpe : "—"}</td>
      <td>${r.win != null ? r.win + "%" : "—"}</td>
    </tr>`).join("")
    : `<tr class="empty-row"><td colspan="9">No models match your search.</td></tr>`;
  const n = rows.length;
  $("#modelSub").textContent =
    `${n} of ${Object.keys(M).length} models · format: 3-class acc / up-down acc · walk-fwd OOS = strictly out-of-sample yearly blocks`;
}
function initRosterControls() {
  document.querySelectorAll("#modelTabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll("#modelTabs .tab").forEach((x) => x.classList.remove("on"));
      t.classList.add("on");
      rosterState.fam = t.dataset.fam;
      renderRoster();
    }));
  $("#modelSearch").addEventListener("input", (e) => {
    rosterState.q = e.target.value.trim().toLowerCase();
    renderRoster();
  });
  $("#modelSort").addEventListener("change", (e) => {
    rosterState.sort = e.target.value;
    renderRoster();
  });
}

/* ---------------- refresh ---------------- */
function initRefresh() {
  const btn = $("#refreshBtn");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const r = await fetch("/api/state?bust=" + Date.now());
      STATE = await r.json();
      if (STATE.error) throw new Error(STATE.error);
      setStatus(true);
      renderAll(STATE);
    } catch (e) {
      setStatus(false);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ================= main render pipeline ================= */
function renderAll(st) {
  const M = st.models, BT = st.backtests;
  const ens = M["Ensemble"];

  /* method meta */
  $("#generated").textContent = "BUILT " + st.generated;
  $("#wfPeriod").textContent = st.oos.period;
  $("#mData").textContent = `NIFTY 50 daily OHLC, ${st.meta.data_from} → ${st.meta.data_to} (${st.meta.n_samples} days), ` +
    `${st.meta.n_features} engineered features: returns, RSI, MACD, Bollinger, realized vol & IV proxies, OI-style volume z-scores, calendar.`;
  $("#mLabel").textContent = st.meta.label_rule + ". A BUY/SELL day is exactly a day where a long ATM option makes money — labels are aligned to the trade, not to a coin flip.";
  $("#mBt").textContent = `BUY → long ATM call, SELL → long ATM put, 1-day hold, Black-Scholes premiums (IV from Parkinson vol), ` +
    `capital ${fmtINR(st.meta.capital)}, ₹${st.meta.brokerage}/trade, ${st.meta.slippage_pct}% slippage, 25% stake per trade.`;
  const v = st.meta.vit;
  $("#vitMeta").textContent = `D=${v.dim} · ${v.depth} blocks · ${v.heads} heads · ${v.patch}px patches · ${v.img}px chart · ${(v.params / 1e6).toFixed(2)}M params`;

  /* ticker */
  const tkItems = st.ticker.map((t) => {
    const up = t.ret.startsWith("+");
    return `<span class="tk">${t.d} <b>${t.close}</b> <span class="${up ? "up" : "dn"}">${t.ret}</span> · IV ${t.iv} · RSI ${t.rsi} · σ21 ${t.vol21}</span>`;
  }).join("");
  $("#ticker").innerHTML = tkItems + tkItems;

  /* hero: attention + signal */
  const A = st.attention;
  const maxA = Math.max(...A.grid.flat()) || 1;
  const ov = $("#attnOverlay");
  ov.innerHTML = "";
  A.grid.flat().forEach((w, ci) => {
    const i = document.createElement("i");
    const a = Math.pow(w / maxA, 0.7);
    i.style.background = `rgba(232,121,249,${(a * 0.55).toFixed(3)})`;
    i.style.borderColor = a > 0.5 ? "rgba(232,121,249,.8)" : "transparent";
    if (a > 0.85) i.style.boxShadow = "0 0 12px rgba(232,121,249,.8)";
    i.style.animationDelay = `${(ci % 8) * 120 + Math.floor(ci / 8) * 80}ms`;
    ov.appendChild(i);
  });
  const badge = $("#sigBadge");
  badge.textContent = A.signal;
  badge.className = "signal-badge " + A.signal.toLowerCase();
  $("#heroMeta").textContent = `${A.date} · close ${Number(st.hero.close).toLocaleString("en-IN")} · ViT in-sample model`;
  const names = ["SELL", "HOLD", "BUY"];
  const cls = ["s", "h", "b"];
  $("#probBars").innerHTML = A.probs.map((p, i) =>
    `<div class="pb ${cls[i]}"><span>${names[i]}</span><div class="bar"><i data-w="${(p * 100).toFixed(1)}"></i></div><span class="v">${pct(p, 0)}</span></div>`
  ).join("");
  requestAnimationFrame(() => document.querySelectorAll("#probBars .bar i").forEach((b) => (b.style.width = b.dataset.w + "%")));

  /* KPI rows */
  renderKpiRow(st);
  const kf = ens["walk-forward OOS"];
  const ebt = BT["Ensemble"];
  const kpis = [
    { l: "Walk-fwd OOS acc", v: kf.acc_updown * 100, dec: 1, s: "%", glow: "rgba(34,211,238,.3)", d: `up/down · base rate ${(kf.base_rate_up * 100).toFixed(0)}%` },
    { l: "OOS AUC", v: kf.auc_updown * 100, dec: 1, s: "", glow: "rgba(232,121,249,.3)", d: "rank quality" },
    { l: "In-sample acc", v: ens["in-sample"].acc_3c * 100, dec: 1, s: "%", glow: "rgba(0,255,163,.25)", d: "full-history fit" },
    { l: "OOS Sharpe", v: ebt.sharpe, dec: 2, s: "", glow: "rgba(34,211,238,.3)", d: "annualized, options P&L" },
    { l: "OOS Total Return", v: ebt.total_return_pct, dec: 1, s: "%", glow: "rgba(0,255,163,.3)", d: fmtINR(ebt.final_equity) + " final" },
    { l: "Max Drawdown", v: ebt.max_drawdown_pct, dec: 1, s: "%", glow: "rgba(255,59,107,.25)", d: "worst peak→trough" },
    { l: "Win Rate", v: ebt.win_rate_pct, dec: 1, s: "%", glow: "rgba(250,204,21,.25)", d: ebt.n_trades + " OOS trades" },
    { l: "Profit Factor", v: ebt.profit_factor, dec: 2, s: "", glow: "rgba(232,121,249,.25)", d: "gross win / gross loss" },
  ];
  $("#kpiGrid").innerHTML = kpis.map((k) =>
    `<div class="kpi" style="--kpi-glow:${k.glow}"><div class="k-num" data-v="${k.v}" data-dec="${k.dec}" data-s="${k.s}">0</div><div class="k-lbl">${k.l}</div><div class="k-delta">${k.d}</div></div>`
  ).join("");
  document.querySelectorAll("#kpiGrid .k-num").forEach((el) =>
    countUp(el, +el.dataset.v, { dec: +el.dataset.dec, suffix: el.dataset.s }));

  /* roster table */
  renderRoster();

  /* vs paper DOM */
  const paper = st.paper.models;
  $("#labelNote").textContent = st.label_design_check.note;
  countUp($("#paperLabelAcc"), st.label_design_check.paper_label_acc * 100, { dec: 1, suffix: "%" });
  countUp($("#majorityAcc"), st.label_design_check.majority_baseline * 100, { dec: 1, suffix: "%" });
  countUp($("#wfAcc"), kf.acc_updown * 100, { dec: 1, suffix: "%" });
  $("#protoTable").innerHTML =
    `<tr><th>MODEL</th><th>IN-SAMPLE</th><th>PAPER 80/20</th><th>WALK-FWD OOS</th></tr>` +
    Object.entries(M).map(([nm, m]) =>
      `<tr><td>${nm}</td><td>${pct(m["in-sample"].acc_3c, 1)} / ${pct(m["in-sample"].acc_updown, 1)}</td>
       <td>${pct(m["paper-style"].acc_3c, 1)} / ${pct(m["paper-style"].acc_updown, 1)}</td>
       <td style="color:var(--cyan);font-weight:700">${pct(m["walk-forward OOS"].acc_3c, 1)} / ${pct(m["walk-forward OOS"].acc_updown, 1)}</td></tr>`
    ).join("") +
    `<tr><td class="dim">format: 3-class acc / up-down acc</td><td></td><td></td><td></td></tr>`;

  /* alpha DOM */
  const A0 = st.alpha;
  const aOOS = A0["walk-forward OOS"];
  const aBT = A0.backtest;
  $("#alphaPeriod").textContent = A0.period + " · " + A0.hold_days + "-day hold · " + A0.stake;
  $("#alphaHow").innerHTML =
    `The XGBoost vol model (walk-forward AUC <b style="color:var(--mag)">${(aOOS.auc * 100).toFixed(1)}</b>) flags days where the next 5-day move is likely to
    <b>exceed the IV-implied range</b> — vol-expansion days. On those days we buy the ATM call <i>and</i> put
    (long straddle), hold to expiry, and collect the convex payoff: NIFTY's 5-day moves are fatter than
    Parkinson-IV pricing implies, and the model steers clear of dead-vol weeks.
    Payoff is convex — wins are big, losses capped at the premium.`;
  const aK = [
    { l: "OOS AUC", v: aOOS.auc * 100, dec: 1, s: "", d: `base rate ${(aOOS.base_rate * 100).toFixed(0)}%` },
    { l: "OOS Accuracy", v: aOOS.acc * 100, dec: 1, s: "%", d: `vs base ${(aOOS.base_rate * 100).toFixed(1)}%` },
    { l: "OOS Return", v: aBT.total_return_pct, dec: 1, s: "%", d: fmtINR(aBT.final_equity) + " final" },
    { l: "Sharpe", v: aBT.sharpe, dec: 2, s: "", d: "annualized" },
    { l: "Max Drawdown", v: aBT.max_drawdown_pct, dec: 1, s: "%", d: "peak → trough" },
    { l: "Win Rate", v: aBT.win_rate_pct, dec: 1, s: "%", d: "convex: losses capped" },
    { l: "Trades", v: aBT.n_trades, dec: 0, s: "", d: A0.hold_days + "-day holds" },
    { l: "Avg P&L / Trade", v: aBT.avg_pnl, dec: 0, s: "", prefix: "₹", d: "per straddle" },
  ];
  $("#alphaKpis").innerHTML = aK.map((k) =>
    `<div class="kpi" style="--kpi-glow:rgba(232,121,249,.28)"><div class="k-num" data-v="${k.v}" data-dec="${k.dec}" data-s="${k.s}" data-p="${k.prefix || ""}">0</div><div class="k-lbl">${k.l}</div><div class="k-delta">${k.d}</div></div>`
  ).join("");
  document.querySelectorAll("#alphaKpis .k-num").forEach((el) =>
    countUp(el, +el.dataset.v, { dec: +el.dataset.dec, suffix: el.dataset.s, prefix: el.dataset.p }));
  $("#alphaTrades").innerHTML =
    `<tr><th>ENTRY DATE</th><th>NIFTY</th><th>P(vol expansion)</th><th>PREMIUM IN</th><th>PREMIUM OUT</th><th>5-DAY STRADDLE P&L</th></tr>` +
    A0.trades.slice().reverse().map((t) => {
      const rc = t.ret_pct >= 0 ? "pos" : "neg";
      return `<tr><td>${t.d}</td><td>${Number(t.close).toLocaleString("en-IN")}</td>
        <td>${t.prob.toFixed(2)}<span class="minibar" style="width:${t.prob * 46}px;background:#e879f9"></span></td>
        <td>₹${t.prem_in}</td><td>₹${t.prem_out}</td>
        <td class="pct ${rc}">${t.ret_pct >= 0 ? "+" : ""}${t.ret_pct}%</td></tr>`;
    }).join("");

  /* trades table */
  const tr = st.oos.trades.slice().reverse();
  const maxP = 0.95;
  $("#tradesTable").innerHTML =
    `<tr><th>DATE</th><th>NIFTY</th><th>P(SELL)</th><th>P(HOLD)</th><th>P(BUY)</th><th>SIGNAL</th><th>OPTION</th><th>ENTRY</th><th>EXIT</th><th>RET</th></tr>` +
    tr.map((t) => {
      const bar = (p, c) => `<span class="minibar" style="width:${(p / maxP) * 46}px;background:${c}"></span>${p.toFixed(2)}`;
      const rc = t.ret_pct >= 0 ? "pos" : "neg";
      return `<tr><td>${t.d}</td><td>${Number(t.close).toLocaleString("en-IN")}</td>
        <td>${bar(t.p_sell, "rgba(255,59,107,.7)")}</td><td>${bar(t.p_hold, "rgba(250,204,21,.7)")}</td><td>${bar(t.p_buy, "rgba(0,255,163,.7)")}</td>
        <td><span class="sig ${t.signal.toLowerCase()}">${t.signal}</span></td><td>${t.opt}</td>
        <td>${t.entry.toFixed(1)}</td><td>${t.exit.toFixed(1)}</td>
        <td class="pct ${rc}">${t.ret_pct >= 0 ? "+" : ""}${t.ret_pct}%</td></tr>`;
    }).join("");
}

/* ================= charts (theme-aware) ================= */
function renderCharts(st) {
  const st2 = C();
  const AXIS = st2.axis, TOOLTIP = st2.tip;
  const M = st.models, BT = st.backtests;
  const paper = st.paper.models;

  /* vs paper */
  const vs = mkChart("chartVsPaper");
  if (vs) {
    const models = ["XGBoost", "RandomForest", "LSTM", "ViT (new)", "Ensemble (new)"];
    const paperAcc = { XGBoost: paper.XGBoost.acc, RandomForest: paper.RandomForest.acc, LSTM: paper.LSTM.acc };
    const ourIns = {
      XGBoost: M["XGBoost"]["in-sample"].acc_3c * 100,
      RandomForest: M["RandomForest"]["in-sample"].acc_3c * 100,
      "LSTM": M["LSTM"]["in-sample"].acc_3c * 100,
      "ViT (new)": M["ViT"]["in-sample"].acc_3c * 100,
      "Ensemble (new)": M["Ensemble"]["in-sample"].acc_3c * 100,
    };
    vs.setOption({
      backgroundColor: "transparent",
      tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => x + "%" },
      legend: { textStyle: { color: st2.legend, fontSize: 10 }, top: 0 },
      grid: { left: 46, right: 16, top: 42, bottom: 30 },
      xAxis: { type: "category", data: models, ...AXIS, axisLabel: { ...AXIS.axisLabel, fontSize: 9.5 } },
      yAxis: { type: "value", min: 40, max: 100, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: "{value}%" } },
      series: [
        {
          name: "Paper (claimed)", type: "bar", barWidth: 14,
          data: models.map((m) => (m in paperAcc ? paperAcc[m] : null)),
          itemStyle: { color: "rgba(124,139,184,.4)", borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", color: st2.legend, fontSize: 9, fontFamily: "JetBrains Mono" },
        },
        {
          name: "OptionEdge (in-sample)", type: "bar", barWidth: 14,
          data: models.map((m) => +(ourIns[m].toFixed(1))),
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#22d3ee" }, { offset: 1, color: "rgba(34,211,238,.25)" }]),
          },
          label: { show: true, position: "top", color: "#0891b2", fontSize: 9.5, fontFamily: "JetBrains Mono", fontWeight: 700 },
        },
      ],
    });
  }

  /* alpha equity */
  const ac = mkChart("chartAlpha");
  if (ac) {
    const A0 = st.alpha, ae = A0.equity;
    const aPalette = {
      "Alpha straddle": "#e879f9", "Straddle every 5d": "#7c8bb8",
      "IV-median rule": "#facc15", "Buy&Hold (same period)": "#60a5fa",
    };
    ac.setOption({
      backgroundColor: "transparent",
      tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => fmtINR(x) },
      legend: { textStyle: { color: st2.legend, fontSize: 10 }, top: 0, data: Object.keys(ae) },
      grid: { left: 70, right: 20, top: 40, bottom: 40 },
      xAxis: { type: "category", data: ae["Alpha straddle"].map((p) => p[0]), ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
      yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v) => (v / 1000).toFixed(0) + "k" } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: "rgba(232,121,249,.25)", backgroundColor: "rgba(10,15,32,.4)", fillerColor: "rgba(232,121,249,.12)" }],
      series: Object.entries(ae).map(([nm, pts]) => ({
        name: nm, type: "line", data: pts, showSymbol: false, smooth: 0.2,
        lineStyle: { width: nm === "Alpha straddle" ? 3 : 1.5, color: aPalette[nm] },
        itemStyle: { color: aPalette[nm] },
        areaStyle: nm === "Alpha straddle" ? {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(232,121,249,.22)" }, { offset: 1, color: "rgba(232,121,249,0)" }])
        } : undefined,
        z: nm === "Alpha straddle" ? 10 : 4,
      })),
    });
  }

  /* alpha per-year */
  const ay = mkChart("chartAlphaYear");
  if (ay) {
    const A0 = st.alpha;
    ay.setOption({
      backgroundColor: "transparent",
      tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => (x * 100).toFixed(1) + "%" },
      legend: { textStyle: { color: st2.legend, fontSize: 9 }, top: 0 },
      grid: { left: 44, right: 12, top: 34, bottom: 24 },
      xAxis: { type: "category", data: A0.per_year.map((r) => r.year), ...AXIS },
      yAxis: { type: "value", min: 0.35, max: 0.7, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v) => (v * 100).toFixed(0) + "%" } },
      series: [
        { name: "base rate", type: "line", data: A0.per_year.map((r) => r.base_rate), lineStyle: { type: "dashed", color: "#7c8bb8" }, itemStyle: { color: "#7c8bb8" }, showSymbol: false },
        { name: "model acc", type: "bar", data: A0.per_year.map((r) => r.acc), barWidth: 16,
          itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#e879f9" }, { offset: 1, color: "rgba(232,121,249,.25)" }]), borderRadius: [4, 4, 0, 0] } },
      ],
    });
  }

  /* OOS equity */
  const eqc = mkChart("chartEquity");
  if (eqc) {
    const eq = st.oos.equity;
    const palette = {
      "Ensemble": "#22d3ee", "ViT": "#e879f9", "LSTM": "#facc15",
      "XGBoost": "#00ffa3", "RandomForest": "#60a5fa",
      "Buy&Hold NIFTY": "#7c8bb8", "RSI momentum": "#fb923c",
    };
    eqc.setOption({
      backgroundColor: "transparent",
      tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => fmtINR(x) },
      legend: { textStyle: { color: st2.legend, fontSize: 10 }, top: 0, data: Object.keys(eq) },
      grid: { left: 70, right: 20, top: 40, bottom: 40 },
      xAxis: { type: "category", data: eq["Ensemble"].map((p) => p[0]), ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
      yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v) => (v / 1000).toFixed(0) + "k" } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: "rgba(34,211,238,.2)", backgroundColor: "rgba(10,15,32,.4)", fillerColor: "rgba(34,211,238,.12)" }],
      series: Object.entries(eq).map(([nm, pts]) => ({
        name: nm, type: "line", data: pts, showSymbol: false, smooth: 0.2,
        lineStyle: { width: nm === "Ensemble" ? 3 : 1.5, color: palette[nm] },
        itemStyle: { color: palette[nm] },
        areaStyle: nm === "Ensemble" ? {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(34,211,238,.22)" }, { offset: 1, color: "rgba(34,211,238,0)" }])
        } : undefined,
        z: nm === "Ensemble" ? 10 : 4,
      })),
    });
  }

  /* drawdown */
  const ddc = mkChart("chartDD");
  if (ddc) {
    const eq = st.oos.equity;
    ddc.setOption({
      backgroundColor: "transparent",
      title: { text: "Ensemble drawdown %", textStyle: { color: st2.legend, fontSize: 11, fontFamily: "Orbitron" }, left: 8, top: 4 },
      tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => x + "%" },
      grid: { left: 60, right: 20, top: 34, bottom: 24 },
      xAxis: { type: "category", data: eq["Ensemble"].map((p) => p[0]), ...AXIS, axisLabel: { show: false } },
      yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: "{value}%" } },
      series: [{
        type: "line", data: drawdownSeries(eq["Ensemble"]), showSymbol: false,
        lineStyle: { width: 1.2, color: "#ff3b6b" }, itemStyle: { color: "#ff3b6b" },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: "rgba(255,59,107,.05)" }, { offset: 1, color: "rgba(255,59,107,.3)" }]) },
      }],
    });
  }

  /* monthly heatmap */
  const mh = mkChart("chartMonthly");
  if (mh) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const heat = st.monthly_pnl.map(([mo, val]) => [mo - 1, 0, val]);
    mh.setOption({
      backgroundColor: "transparent",
      tooltip: { ...TOOLTIP, formatter: (p) => months[p.value[0]] + ": " + p.value[2] + "%" },
      grid: { left: 44, right: 16, top: 16, bottom: 30 },
      xAxis: { type: "category", data: months, ...AXIS, splitArea: { show: false } },
      yAxis: { type: "category", data: ["OOS"], ...AXIS },
      visualMap: {
        min: -30, max: 30, calculable: false, orient: "horizontal", left: "center", bottom: 0,
        textStyle: { color: st2.legend, fontSize: 9 },
        inRange: { color: st2.heat },
      },
      series: [{ type: "heatmap", data: heat, label: { show: true, color: (document.documentElement.dataset.theme || "dark") === "light" ? "#101828" : "#dbe4ff", fontSize: 9, fontFamily: "JetBrains Mono", formatter: (p) => p.value[2] + "%" }, itemStyle: { borderColor: (document.documentElement.dataset.theme || "dark") === "light" ? "#ffffff" : "#04060e", borderWidth: 2, borderRadius: 3 } }],
    });
  }

  /* feature importance */
  const fc = mkChart("chartFeatures");
  if (fc) {
    const fi = [...st.feature_importance].sort((a, b) => a[1] - b[1]).slice(0, 14);
    fc.setOption({
      backgroundColor: "transparent",
      tooltip: { ...TOOLTIP, valueFormatter: (x) => (x * 100).toFixed(2) + "%" },
      grid: { left: 108, right: 40, top: 10, bottom: 20 },
      xAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (x) => (x * 100).toFixed(0) + "%" } },
      yAxis: { type: "category", data: fi.map((f) => f[0]), ...AXIS, axisLabel: { ...AXIS.axisLabel, fontSize: 9.5 } },
      series: [{
        type: "bar", data: fi.map((f) => +f[1].toFixed(4)), barWidth: 10,
        itemStyle: {
          borderRadius: [0, 5, 5, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "rgba(232,121,249,.25)" }, { offset: 1, color: "#e879f9" }]),
        },
        label: { show: true, position: "right", color: "#c026d3", fontSize: 9, fontFamily: "JetBrains Mono" },
      }],
    });
  }
}

/* ================= ViT time machine (interactive) ================= */
function initTimeMachine(st) {
  const pd = $("#predictDate");
  pd.min = st.meta.data_from;
  pd.max = st.meta.data_to;
  pd.value = st.meta.data_to;

  function renderPredictAttn(grid) {
    const ov = $("#predictAttn");
    ov.innerHTML = "";
    const maxA = Math.max(...grid.flat()) || 1;
    grid.flat().forEach((w, ci) => {
      const i = document.createElement("i");
      const a = Math.pow(w / maxA, 0.7);
      i.style.background = `rgba(232,121,249,${(a * 0.55).toFixed(3)})`;
      i.style.borderColor = a > 0.5 ? "rgba(232,121,249,.8)" : "transparent";
      i.style.animationDelay = `${(ci % 8) * 120 + Math.floor(ci / 8) * 80}ms`;
      ov.appendChild(i);
    });
  }

  async function runPredict(dateStr) {
    const btn = $("#predictBtn");
    btn.disabled = true;
    btn.textContent = "RUNNING…";
    try {
      const r = await fetch("/api/predict" + (dateStr ? `?date=${dateStr}` : ""));
      const p = await r.json();
      if (p.error) {
        $("#predictPh").style.display = "grid";
        $("#predictPh").textContent = "⚠ " + p.error;
        return;
      }
      $("#predictPh").style.display = "none";
      $("#predictWrap").classList.remove("empty");
      $("#predictImg").src = "data:image/png;base64," + p.chart_b64;
      renderPredictAttn(p.attention);
      const badge = $("#predictBadge");
      badge.textContent = p.signal;
      badge.className = "signal-badge mini " + p.signal.toLowerCase();
      const names = ["SELL", "HOLD", "BUY"];
      const cls = ["s", "h", "b"];
      $("#predictBars").innerHTML = p.probs.map((v, i) =>
        `<div class="pb ${cls[i]}"><span>${names[i]}</span><div class="bar"><i data-w="${(v * 100).toFixed(1)}"></i></div><span class="v">${(v * 100).toFixed(1)}%</span></div>`
      ).join("");
      requestAnimationFrame(() => document.querySelectorAll("#predictBars .bar i")
        .forEach((b) => (b.style.width = b.dataset.w + "%")));
      $("#predictMeta").textContent =
        `${p.date} · close ${Number(p.close).toLocaleString("en-IN")} · in-sample ViT (D${st.meta.vit.dim} × ${st.meta.vit.depth} blocks)`;
      if (p.next_ret_pct != null) {
        const rc = p.next_ret_pct >= 0 ? "pos" : "neg";
        $("#predictActual").innerHTML =
          `what actually happened: next day <b class="${rc}">${p.next_ret_pct >= 0 ? "+" : ""}${p.next_ret_pct}%</b> · actual label <b>${p.actual}</b>`;
      } else {
        $("#predictActual").textContent = "last session in the dataset — no next day yet";
      }
    } catch (e) {
      $("#predictPh").style.display = "grid";
      $("#predictPh").textContent = "⚠ " + e;
    } finally {
      btn.disabled = false;
      btn.textContent = "RUN ViT →";
    }
  }

  $("#predictBtn").addEventListener("click", () => runPredict(pd.value));
  pd.addEventListener("change", () => runPredict(pd.value));
  runPredict(pd.value); // pre-fill with the latest session
}

/* ================= predictions: 4 input modes ================= */
let lastCsv = "";
let twistTimer = null;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines[0] && lines[0].toLowerCase().startsWith("date,")) lines.shift();
  const rows = [];
  for (const ln of lines) {
    const p = ln.split(",").map((x) => x.trim());
    if (p.length < 5) throw new Error("row needs date,open,high,low,close: " + ln);
    rows.push([p[0], +p[1], +p[2], +p[3], +p[4]]);
  }
  return rows;
}

function attnInto(ov, grid) {
  ov.innerHTML = "";
  const maxA = Math.max(...grid.flat()) || 1;
  grid.flat().forEach((w, ci) => {
    const i = document.createElement("i");
    const a = Math.pow(w / maxA, 0.7);
    i.style.background = `rgba(232,121,249,${(a * 0.55).toFixed(3)})`;
    i.style.borderColor = a > 0.5 ? "rgba(232,121,249,.8)" : "transparent";
    if (a > 0.85) i.style.boxShadow = "0 0 12px rgba(232,121,249,.8)";
    i.style.animationDelay = `${(ci % 8) * 120 + Math.floor(ci / 8) * 80}ms`;
    ov.appendChild(i);
  });
}

function barsInto(sel, probs) {
  const names = ["SELL", "HOLD", "BUY"];
  const cls = ["s", "h", "b"];
  $(sel).innerHTML = probs.map((p, i) =>
    `<div class="pb ${cls[i]}"><span>${names[i]}</span><div class="bar"><i data-w="${(p * 100).toFixed(1)}"></i></div><span class="v">${pct(p, 0)}</span></div>`
  ).join("");
  requestAnimationFrame(() => document.querySelectorAll(sel + " .bar i")
    .forEach((b) => (b.style.width = b.dataset.w + "%")));
}

function conviction(probs, signal) {
  const top = Math.max(...probs);
  return `model conviction: ${(top * 100).toFixed(1)}% on ${signal} · max gap ${((Math.max(...probs) - Math.min(...probs)) * 100).toFixed(1)}pp`;
}

/* shared result panel (your data / scenarios) */
function renderResult(j, title) {
  $("#pgResultSec").style.display = "";
  $("#pgResultTitle").textContent = title;
  $("#pgImg").src = "data:image/png;base64," + j.chart_b64;
  attnInto($("#pgAttn"), j.attention);
  const badge = $("#pgBadge");
  badge.textContent = j.signal;
  badge.className = "signal-badge " + j.signal.toLowerCase();
  barsInto("#pgBars", j.probs);
  $("#pgMeta").textContent = `${j.date} · close ${Number(j.close).toLocaleString("en-IN")} · in-sample ViT`;
  if (j.next_ret_pct != null) {
    const rc = j.next_ret_pct >= 0 ? "pos" : "neg";
    const hit = j.signal === j.actual ? " ✓ called it" : "";
    $("#pgActual").innerHTML =
      `what actually happened next day: <b class="${rc}">${j.next_ret_pct >= 0 ? "+" : ""}${j.next_ret_pct}%</b> · actual label <b>${j.actual}</b>${hit}`;
  } else {
    $("#pgActual").textContent = "last session in the dataset — no next day yet";
  }
  $("#pgConf").textContent = conviction(j.probs, j.signal);
}

function renderResultCsv(j, title) {
  $("#pgResultSec").style.display = "";
  $("#pgResultTitle").textContent = title;
  $("#pgImg").src = j.png;
  attnInto($("#pgAttn"), j.attn);
  const badge = $("#pgBadge");
  badge.textContent = j.signal;
  badge.className = "signal-badge " + j.signal.toLowerCase();
  barsInto("#pgBars", j.probs);
  $("#pgMeta").textContent = `${j.date} · close ${Number(j.close).toLocaleString("en-IN")} · ${j.rows} rows · in-sample ViT`;
  $("#pgActual").textContent = "your own data — no ground truth, this is the open question";
  $("#pgConf").textContent = conviction(j.probs, j.signal);
}

function initPredictModes() {
  /* tabs */
  document.querySelectorAll("#predTabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll("#predTabs .tab").forEach((x) => x.classList.remove("on"));
      document.querySelectorAll(".pred-pane").forEach((x) => x.classList.remove("on"));
      t.classList.add("on");
      document.querySelector(`.pred-pane[data-pane="${t.dataset.pred}"]`).classList.add("on");
    }));

  const predStatusEl = $("#predStatus");
  function predStatus(msg, err = false) {
    predStatusEl.textContent = msg;
    predStatusEl.classList.toggle("err", err);
  }

  /* --- your data: paste / upload / load --- */
  async function runCsv(csv, title = "your data") {
    lastCsv = csv;
    $("#predTwist").value = 0;
    $("#predTwistLbl").textContent = "±0.00%";
    predStatus("rendering your chart → running the ViT…");
    try {
      const r = await fetch("/api/predict", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const j = await r.json();
      if (!j.ok) { predStatus(j.error || "prediction failed", true); return; }
      renderResultCsv(j, title);
      predStatus(`done — ${j.signal} · S/H/B = ${j.probs.map((v) => (v * 100).toFixed(1)).join(" / ")}%`);
    } catch (e) {
      predStatus("request failed: " + e, true);
    }
  }
  $("#predGoBtn").addEventListener("click", () => {
    const csv = $("#predCsv").value.trim();
    if (!csv) { predStatus("paste some rows first (or load latest / upload)", true); return; }
    runCsv(csv, "your data");
  });
  $("#predLoadBtn").addEventListener("click", async () => {
    predStatus("loading latest NIFTY sessions…");
    try {
      const j = await (await fetch("/api/latest?rows=60")).json();
      $("#predCsv").value = j.csv;
      predStatus(`${j.rows} rows loaded (ends ${j.date}) — twist the slider or hit PREDICT`);
    } catch (e) {
      predStatus("could not load latest data: " + e, true);
    }
  });
  $("#predFileBtn").addEventListener("click", () => $("#predFile").click());
  $("#predFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const rows = parseCsv(String(rd.result));
        $("#predCsv").value = rows.map((r) => r.join(",")).join("\n");
        predStatus(`uploaded ${f.name}: ${rows.length} rows parsed — hit PREDICT`);
      } catch (err) {
        predStatus("⚠ could not parse " + f.name + ": " + err.message, true);
      }
    };
    rd.readAsText(f);
  });

  /* what-if twist: reprice final close ±2%, re-run live */
  $("#predTwist").addEventListener("input", (e) => {
    const dp = +e.target.value / 100;
    $("#predTwistLbl").textContent = `±${(dp >= 0 ? "+" : "") + (dp * 100).toFixed(2)}%`;
    const csv = $("#predCsv").value.trim();
    if (!csv) { predStatus("load or paste data first, then twist", true); return; }
    clearTimeout(twistTimer);
    twistTimer = setTimeout(async () => {
      try {
        const rows = parseCsv(csv);
        const last = rows[rows.length - 1];
        const c0 = last[4];
        const c = +(c0 * (1 + dp)).toFixed(2);
        last[4] = c;
        if (c > last[2]) last[2] = +c.toFixed(2);
        if (c < last[3]) last[3] = +(c * 0.999).toFixed(2);
        await runCsv(rows.map((r) => r.join(",")).join("\n"),
          `your data · final close ${dp >= 0 ? "+" : ""}${(dp * 100).toFixed(2)}%`);
      } catch (err) {
        predStatus("⚠ " + err.message, true);
      }
    }, 350);
  });

  /* --- scenarios --- */
  function genScenario(kind, days = 40, start = 24000) {
    const dates = [];
    const d = new Date(STATE.meta.data_to);
    while (dates.length < days) {
      const w = d.getDay();
      if (w !== 0 && w !== 6) dates.push(new Date(d));
      d.setDate(d.getDate() - 1);
    }
    dates.reverse();
    let c = start;
    const rows = [];
    for (let i = 0; i < days; i++) {
      let drift = 0, vol = 0.006;
      if (kind === "up") drift = 0.004;
      else if (kind === "down") drift = -0.004;
      else if (kind === "spike") { if (i > days - 8) { drift = Math.random() > 0.5 ? 0.02 : -0.02; vol = 0.016; } }
      else if (kind === "chop") { drift = i % 2 ? 0.0018 : -0.0018; vol = 0.0025; }
      else if (kind === "random") vol = 0.008;
      const r = drift + (Math.random() * 2 - 1) * vol;
      const o = c, cl = c * (1 + r);
      const hi = Math.max(o, cl) * (1 + Math.random() * 0.003);
      const lo = Math.min(o, cl) * (1 - Math.random() * 0.003);
      rows.push([dates[i].toISOString().slice(0, 10), +o.toFixed(1), +hi.toFixed(1), +lo.toFixed(1), +cl.toFixed(1)]);
      c = cl;
    }
    return rows;
  }
  const SCEN_NAMES = { up: "steady uptrend", down: "steady downtrend", spike: "vol spike", chop: "sideways chop", random: "random walk" };
  document.querySelectorAll("#scenGrid .scen-btn").forEach((b) => b.addEventListener("click", () => {
    const kind = b.dataset.scen;
    const rows = genScenario(kind);
    const csv = rows.map((r) => r.join(",")).join("\n");
    $("#scenData").textContent = rows.slice(-5).map((r) => r.join(",")).join("\n");
    document.querySelector(".pg-details").open = true;
    $("#predCsv").value = csv;
    runCsv(csv, `scenario · ${SCEN_NAMES[kind]}`);
  }));

  /* --- batch sweep --- */
  const bf = $("#batchFrom"), bt = $("#batchTo");
  bf.min = bt.min = STATE.meta.data_from;
  bf.max = bt.max = STATE.meta.data_to;
  bf.value = "2024-01-01";
  bt.value = "2024-01-31";
  $("#batchRun").addEventListener("click", async () => {
    const out = $("#batchOut");
    out.innerHTML = '<div class="dim mono" style="padding:10px">running the ViT on every session in range…</div>';
    try {
      const r = await fetch("/api/predict_range", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: bf.value, to: bt.value }),
      });
      const j = await r.json();
      if (j.error) { out.innerHTML = `<div class="dim mono" style="color:var(--red);padding:10px">⚠ ${j.error}</div>`; return; }
      const s = j.summary;
      const rowsHtml = j.days.map((d) => {
        const sig = d.signal.toLowerCase();
        const hit = d.actual ? (d.signal === d.actual ? ' class="bhit"' : "") : "";
        return `<tr${hit}><td>${d.date}</td>
          <td><span class="sig ${sig}">${d.signal}</span></td>
          <td>${(d.probs[0] * 100).toFixed(0)}/${(d.probs[1] * 100).toFixed(0)}/${(d.probs[2] * 100).toFixed(0)}</td>
          <td>${d.next_ret_pct != null ? (d.next_ret_pct >= 0 ? "+" : "") + d.next_ret_pct + "%" : "—"}</td>
          <td>${d.actual || "—"}</td></tr>`;
      }).join("");
      out.innerHTML = `
        <div class="batch-cards">
          <div class="bcard"><b>${j.n}</b><span>sessions run</span></div>
          <div class="bcard"><b>${s.exact_hit_pct != null ? s.exact_hit_pct + "%" : "—"}</b><span>exact 3-class hit rate</span></div>
          <div class="bcard"><b>${s.exact_hit != null ? s.exact_hit + "/" + s.graded : "—"}</b><span>correct / graded days</span></div>
        </div>
        <div class="table-wrap batch-table"><table>
          <tr><th>DATE</th><th>ViT SIGNAL</th><th>P S/H/B %</th><th>NEXT DAY</th><th>ACTUAL</th></tr>
          ${rowsHtml}
        </table></div>
        <p class="dim" style="margin-top:12px;font-size:12.5px">green row = the ViT's call matched the actual next-day label. This is the honest read:
        daily direction hovers around chance — the vol-expansion straddle (ALPHA STRADDLE section) is where the real edge is.</p>`;
    } catch (e) {
      out.innerHTML = `<div class="dim mono" style="color:var(--red);padding:10px">⚠ ${e}</div>`;
    }
  });

  /* attention controls on the shared result panel */
  $("#pgAttnOn").addEventListener("change", (e) => {
    $("#pgAttn").style.opacity = e.target.checked ? "1" : "0";
  });
  $("#pgAttnOp").addEventListener("input", (e) => {
    const v = e.target.value / 100;
    document.querySelectorAll("#pgAttn i").forEach((i) => {
      const bg = i.style.background;
      if (!bg) return;
      const m = bg.match(/rgba\(232,121,249,([\d.]+)/);
      if (m) i.style.background = `rgba(232,121,249,${(parseFloat(m[1]) * (v / 0.55)).toFixed(3)})`;
    });
  });
}

/* ================= boot ================= */
async function boot() {
  initTheme();
  initNav();
  initRosterControls();
  initRefresh();
  /* deep links: /predict, /backtest, /alpha, /research → scroll to section */
  const secByPath = { "/predict": "predictions", "/playground": "predictions", "/backtest": "backtest", "/alpha": "alpha", "/research": "research" };
  const deepSec = secByPath[location.pathname];

  /* scroll reveal */
  const io = new IntersectionObserver((entries) =>
    entries.forEach((e) => e.isIntersecting && e.target.classList.add("revealed")),
    { threshold: 0.05 });
  document.querySelectorAll(".pane").forEach((s) => io.observe(s));

  try {
    STATE = await (await fetch("/api/state")).json();
    if (STATE.error) throw new Error(STATE.error);
    setStatus(true);
    renderAll(STATE);
    renderCharts(STATE);
    initTimeMachine(STATE);
    initPredictModes();
    if (deepSec) setTimeout(() => document.getElementById(deepSec)?.scrollIntoView({ behavior: "smooth" }), 350);
  } catch (e) {
    setStatus(false);
    $("#kpiRow").innerHTML =
      `<div class="kstat"><div class="k-lbl">Status</div><div class="k-val dn">Offline</div><div class="k-sub">${e.message || "state unavailable"}</div></div>`;
  }
}
boot();
