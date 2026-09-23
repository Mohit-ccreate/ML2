/* OptionEdge terminal renderer */
const $ = (s) => document.querySelector(s);
const fmtINR = (v) => "₹" + Math.round(v).toLocaleString("en-IN");
const pct = (v, d = 2) => (v == null ? "—" : (v * 100).toFixed(d) + "%");
const charts = {};

const AXIS = {
  axisLine: { lineStyle: { color: "rgba(124,139,184,.35)" } },
  axisLabel: { color: "#7c8bb8", fontFamily: "JetBrains Mono", fontSize: 10 },
  splitLine: { lineStyle: { color: "rgba(124,139,184,.12)" } },
};
const TOOLTIP = {
  backgroundColor: "rgba(7,11,24,.95)",
  borderColor: "rgba(34,211,238,.35)",
  textStyle: { color: "#dbe4ff", fontFamily: "JetBrains Mono", fontSize: 11 },
};

function mkChart(id) {
  const el = document.getElementById(id);
  const c = echarts.init(el, null, { renderer: "canvas" });
  charts[id] = c;
  return c;
}
window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));

function countUp(el, target, opts = {}) {
  const { dec = 0, suffix = "", prefix = "", dur = 1400 } = opts;
  const t0 = performance.now();
  const from = 0;
  function step(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const v = from + (target - from) * e;
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

async function main() {
  const st = await (await fetch("/api/state")).json();
  if (st.error) {
    document.body.innerHTML = `<div style="padding:80px;text-align:center;font-family:monospace;color:#ff3b6b">${st.error}</div>`;
    return;
  }
  const M = st.models, BT = st.backtests;
  const ens = M["Ensemble"];

  /* ---------------- nav + method meta ---------------- */
  $("#generated").textContent = "BUILT " + st.generated;
  $("#wfPeriod").textContent = st.oos.period;
  $("#mData").textContent = `NIFTY 50 daily OHLC, ${st.meta.data_from} → ${st.meta.data_to} (${st.meta.n_samples} days), ` +
    `${st.meta.n_features} engineered features: returns, RSI, MACD, Bollinger, realized vol & IV proxies, OI-style volume z-scores, calendar.`;
  $("#mLabel").textContent = st.meta.label_rule + ". A BUY/SELL day is exactly a day where a long ATM option makes money — labels are aligned to the trade, not to a coin flip.";
  $("#mBt").textContent = `BUY → long ATM call, SELL → long ATM put, 1-day hold, Black-Scholes premiums (IV from Parkinson vol), ` +
    `capital ${fmtINR(st.meta.capital)}, ₹${st.meta.brokerage}/trade, ${st.meta.slippage_pct}% slippage, 25% stake per trade.`;
  const v = st.meta.vit;
  $("#vitMeta").textContent = `D=${v.dim} · ${v.depth} blocks · ${v.heads} heads · ${v.patch}px patches · ${v.img}px chart · ${(v.params / 1e6).toFixed(2)}M params`;

  /* ---------------- ticker ---------------- */
  const tkItems = st.ticker.map((t) => {
    const up = t.ret.startsWith("+");
    return `<span class="tk">${t.d} <b>${t.close}</b> <span class="${up ? "up" : "dn"}">${t.ret}</span> · IV ${t.iv} · RSI ${t.rsi} · σ21 ${t.vol21}</span>`;
  }).join("");
  $("#ticker").innerHTML = tkItems + tkItems;

  /* ---------------- hero: attention + signal ---------------- */
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
  requestAnimationFrame(() => document.querySelectorAll(".pb .bar i").forEach((b) => (b.style.width = b.dataset.w + "%")));

  /* ---------------- ViT time machine (interactive predict) ---------------- */
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

  /* ---------------- predict: your own OHLC data ---------------- */
  const predStatusEl = $("#predStatus");
  function predStatus(msg, err = false) {
    predStatusEl.textContent = msg;
    predStatusEl.classList.toggle("err", err);
  }
  async function runPredictCsv() {
    const csv = $("#predCsv").value.trim();
    if (!csv) { predStatus("paste some OHLC rows first (or hit “load latest 60d”)", true); return; }
    const btn = $("#predGoBtn");
    btn.disabled = true;
    predStatus("rendering your chart → running the ViT…");
    try {
      const r = await fetch("/api/predict", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const j = await r.json();
      if (!j.ok) { predStatus(j.error || "prediction failed", true); return; }
      const img = $("#predImg");
      img.src = j.png;
      img.style.display = "block";
      const ov = $("#predAttn");
      ov.innerHTML = "";
      const maxA = Math.max(...j.attn.flat()) || 1;
      j.attn.flat().forEach((w, ci) => {
        const i = document.createElement("i");
        const a = Math.pow(w / maxA, 0.7);
        i.style.background = `rgba(232,121,249,${(a * 0.55).toFixed(3)})`;
        i.style.borderColor = a > 0.5 ? "rgba(232,121,249,.8)" : "transparent";
        i.style.animationDelay = `${(ci % 8) * 120 + Math.floor(ci / 8) * 80}ms`;
        ov.appendChild(i);
      });
      const badge = $("#predBadge");
      badge.textContent = j.signal;
      badge.className = "signal-badge " + j.signal.toLowerCase();
      const names = ["SELL", "HOLD", "BUY"];
      const cls = ["s", "h", "b"];
      $("#predBars").innerHTML = j.probs.map((v, i) =>
        `<div class="pb ${cls[i]}"><span>${names[i]}</span><div class="bar"><i data-w="${(v * 100).toFixed(1)}"></i></div><span class="v">${(v * 100).toFixed(0)}%</span></div>`
      ).join("");
      requestAnimationFrame(() => document.querySelectorAll("#predBars .bar i")
        .forEach((b) => (b.style.width = b.dataset.w + "%")));
      $("#predMeta").textContent =
        `${j.date} · close ${Number(j.close).toLocaleString("en-IN")} · ${j.rows} rows · in-sample ViT`;
      predStatus(`signal ${j.signal} — S/H/B = ${j.probs.map((v) => (v * 100).toFixed(1)).join(" / ")}%`);
    } catch (e) {
      predStatus("request failed: " + e, true);
    } finally {
      btn.disabled = false;
    }
  }
  $("#predGoBtn").addEventListener("click", runPredictCsv);
  $("#predLoadBtn").addEventListener("click", async () => {
    predStatus("loading latest NIFTY sessions…");
    try {
      const j = await (await fetch("/api/latest?rows=60")).json();
      $("#predCsv").value = j.csv;
      predStatus(`${j.rows} rows loaded (ends ${j.date}) — hit PREDICT`);
    } catch (e) {
      predStatus("could not load latest data: " + e, true);
    }
  });

  /* ---------------- KPIs ---------------- */
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
  document.querySelectorAll(".kpi .k-num").forEach((el) =>
    countUp(el, +el.dataset.v, { dec: +el.dataset.dec, suffix: el.dataset.s }));

  /* ---------------- vs paper ---------------- */
  const paper = st.paper.models;
  const vs = mkChart("chartVsPaper");
  const models = ["XGBoost", "RandomForest", "LSTM", "ViT (new)", "Ensemble (new)"];
  const paperAcc = { XGBoost: paper.XGBoost.acc, RandomForest: paper.RandomForest.acc, LSTM: paper.LSTM.acc };
  const ourIns = {
    XGBoost: M["XGBoost"]["in-sample"].acc_3c * 100,
    RandomForest: M["RandomForest"]["in-sample"].acc_3c * 100,
    "LSTM": M["LSTM"]["in-sample"].acc_3c * 100,
    "ViT (new)": M["ViT"]["in-sample"].acc_3c * 100,
    "Ensemble (new)": ens["in-sample"].acc_3c * 100,
  };
  vs.setOption({
    backgroundColor: "transparent",
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => x + "%" },
    legend: { textStyle: { color: "#7c8bb8", fontSize: 10 }, top: 0 },
    grid: { left: 46, right: 16, top: 42, bottom: 30 },
    xAxis: { type: "category", data: models, ...AXIS, axisLabel: { ...AXIS.axisLabel, fontSize: 9.5 } },
    yAxis: { type: "value", min: 40, max: 100, ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: "{value}%" } },
    series: [
      {
        name: "Paper (claimed)", type: "bar", barWidth: 14,
        data: models.map((m) => (m in paperAcc ? paperAcc[m] : null)),
        itemStyle: { color: "rgba(124,139,184,.4)", borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: "#7c8bb8", fontSize: 9, fontFamily: "JetBrains Mono" },
      },
      {
        name: "OptionEdge (in-sample)", type: "bar", barWidth: 14,
        data: models.map((m) => +(ourIns[m].toFixed(1))),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "#22d3ee" }, { offset: 1, color: "rgba(34,211,238,.25)" }]),
        },
        label: { show: true, position: "top", color: "#22d3ee", fontSize: 9.5, fontFamily: "JetBrains Mono", fontWeight: 700 },
      },
    ],
  });

  $("#labelNote").textContent = st.label_design_check.note;
  countUp($("#paperLabelAcc"), st.label_design_check.paper_label_acc * 100, { dec: 1, suffix: "%" });
  countUp($("#majorityAcc"), st.label_design_check.majority_baseline * 100, { dec: 1, suffix: "%" });
  countUp($("#wfAcc"), kf.acc_updown * 100, { dec: 1, suffix: "%" });

  $("#protoTable").innerHTML =
    `<tr><th>MODEL</th><th>IN-SAMPLE</th><th>PAPER 80/20</th><th>WALK-FWD OOS</th></tr>` +
    Object.entries(M).map(([nm, m]) =>
      `<tr><td>${nm}</td><td>${pct(m["in-sample"].acc_3c, 1)} / ${pct(m["in-sample"].acc_updown, 1)}</td>
       <td>${pct(m["paper-style"].acc_3c, 1)} / ${pct(m["paper-style"].acc_updown, 1)}</td>
       <td style="color:#22d3ee;font-weight:700">${pct(m["walk-forward OOS"].acc_3c, 1)} / ${pct(m["walk-forward OOS"].acc_updown, 1)}</td></tr>`
    ).join("") +
    `<tr><td class="dim">format: 3-class acc / up-down acc</td><td></td><td></td><td></td></tr>`;

  /* ---------------- ALPHA (vol-expansion straddle) ---------------- */
  const A0 = st.alpha;
  const aOOS = A0["walk-forward OOS"];
  const aBT = A0.backtest;
  $("#alphaPeriod").textContent = A0.period + " · " + A0.hold_days + "-day hold · " + A0.stake;
  $("#alphaHow").innerHTML =
    `The XGBoost vol model (walk-forward AUC <b style="color:#e879f9">${(aOOS.auc*100).toFixed(1)}</b>) flags days where the next 5-day move is likely to
    <b>exceed the IV-implied range</b> — vol-expansion days. On those days we buy the ATM call <i>and</i> put
    (long straddle), hold to expiry, and collect the convex payoff: NIFTY's 5-day moves are fatter than
    Parkinson-IV pricing implies (mean ratio ${(1.066*100-100).toFixed(1)}% above implied), and the model steers clear of dead-vol weeks.
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

  const ae = A0.equity;
  const ac = mkChart("chartAlpha");
  const aPalette = {
    "Alpha straddle": "#e879f9", "Straddle every 5d": "#7c8bb8",
    "IV-median rule": "#facc15", "Buy&Hold (same period)": "#60a5fa",
  };
  ac.setOption({
    backgroundColor: "transparent",
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => fmtINR(x) },
    legend: { textStyle: { color: "#7c8bb8", fontSize: 10 }, top: 0, data: Object.keys(ae) },
    grid: { left: 70, right: 20, top: 40, bottom: 40 },
    xAxis: { type: "category", data: ae["Alpha straddle"].map((p) => p[0]), ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v) => (v / 1000).toFixed(0) + "k" } },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: "rgba(232,121,249,.25)", backgroundColor: "rgba(7,11,24,.4)", fillerColor: "rgba(232,121,249,.12)" }],
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

  const ay = mkChart("chartAlphaYear");
  ay.setOption({
    backgroundColor: "transparent",
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => (x * 100).toFixed(1) + "%" },
    legend: { textStyle: { color: "#7c8bb8", fontSize: 9 }, top: 0 },
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

  $("#alphaTrades").innerHTML =
    `<tr><th>ENTRY DATE</th><th>NIFTY</th><th>P(vol expansion)</th><th>PREMIUM IN</th><th>PREMIUM OUT</th><th>5-DAY STRADDLE P&L</th></tr>` +
    A0.trades.slice().reverse().map((t) => {
      const rc = t.ret_pct >= 0 ? "pos" : "neg";
      return `<tr><td>${t.d}</td><td>${Number(t.close).toLocaleString("en-IN")}</td>
        <td>${t.prob.toFixed(2)}<span class="minibar" style="width:${t.prob * 46}px;background:#e879f9"></span></td>
        <td>₹${t.prem_in}</td><td>₹${t.prem_out}</td>
        <td class="pct ${rc}">${t.ret_pct >= 0 ? "+" : ""}${t.ret_pct}%</td></tr>`;
    }).join("");

  /* ---------------- equity ---------------- */
  const eq = st.oos.equity;
  const eqc = mkChart("chartEquity");
  const palette = {
    "Ensemble": "#22d3ee", "ViT": "#e879f9", "LSTM": "#facc15",
    "XGBoost": "#00ffa3", "RandomForest": "#60a5fa",
    "Buy&Hold NIFTY": "#7c8bb8", "RSI momentum": "#fb923c",
  };
  eqc.setOption({
    backgroundColor: "transparent",
    tooltip: { ...TOOLTIP, trigger: "axis", valueFormatter: (x) => fmtINR(x) },
    legend: { textStyle: { color: "#7c8bb8", fontSize: 10 }, top: 0, data: Object.keys(eq) },
    grid: { left: 70, right: 20, top: 40, bottom: 40 },
    xAxis: { type: "category", data: eq["Ensemble"].map((p) => p[0]), ...AXIS, axisLabel: { ...AXIS.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v) => (v / 1000).toFixed(0) + "k" } },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 16, bottom: 6, borderColor: "rgba(34,211,238,.2)", backgroundColor: "rgba(7,11,24,.4)", fillerColor: "rgba(34,211,238,.12)" }],
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

  const ddc = mkChart("chartDD");
  ddc.setOption({
    backgroundColor: "transparent",
    title: { text: "Ensemble drawdown %", textStyle: { color: "#7c8bb8", fontSize: 11, fontFamily: "Orbitron" }, left: 8, top: 4 },
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

  /* ---------------- model cards ---------------- */
  const descs = {
    "ViT": "From-scratch Vision Transformer reading 64×64 candlestick charts. The chart IS the model input.",
    "LSTM": "20-day feature sequences — the reference paper's flagship model, reproduced.",
    "XGBoost": "Gradient-boosted trees on 29 engineered features — the paper's runner-up, reproduced.",
    "RandomForest": "Bagged decision trees — the paper's third model, reproduced.",
    "Ensemble": "Logistic stack of ViT + LSTM + XGBoost probability heads. Fitted on train-side only.",
  };
  const paperBy = { "XGBoost": "XGBoost", "RandomForest": "RandomForest", "LSTM": "LSTM" };
  $("#modelGrid").innerHTML = Object.entries(M).map(([nm, m]) => {
    const bt = BT[nm] || {};
    const paperKey = paperBy[nm];
    const delta = paperKey ? (m["walk-forward OOS"].acc_updown * 100) - paper[paperKey].acc : null;
    const chip = paperKey
      ? (delta >= 0
        ? `<div class="vs-chip">OOS vs paper ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}</div>`
        : `<div class="vs-chip bad">OOS vs paper ${delta.toFixed(1)}</div>`)
      : `<div class="vs-chip">NEW — not in paper</div>`;
    return `<div class="mcard">${chip}
      <div class="mc-name">${nm}<span class="mc-badge">${nm === "ViT" ? v.params / 1e6 + "M PARAMS" : nm === "LSTM" ? "SEQ 20×29" : "29 FEATURES"}</span></div>
      <div class="mc-desc">${descs[nm]}</div>
      <div class="mc-rows">
        <div class="mc-row"><span class="l">in-sample acc</span><span class="v">${pct(m["in-sample"].acc_3c, 1)} · ud ${pct(m["in-sample"].acc_updown, 1)}</span></div>
        <div class="mc-row"><span class="l">paper 80/20 acc</span><span class="v">${pct(m["paper-style"].acc_3c, 1)} · ud ${pct(m["paper-style"].acc_updown, 1)}</span></div>
        <div class="mc-row"><span class="l">walk-fwd OOS acc</span><span class="v" style="color:#22d3ee">${pct(m["walk-forward OOS"].acc_3c, 1)} · ud ${pct(m["walk-forward OOS"].acc_updown, 1)}</span></div>
      </div>
      <div class="mc-bt">
        <div><span>final equity</span>${fmtINR(bt.final_equity || 0)}</div>
        <div><span>return</span>${bt.total_return_pct != null ? bt.total_return_pct + "%" : "—"}</div>
        <div><span>sharpe</span>${bt.sharpe != null ? bt.sharpe : "—"}</div>
        <div><span>max DD</span>${bt.max_drawdown_pct != null ? bt.max_drawdown_pct + "%" : "—"}</div>
        <div><span>win rate</span>${bt.win_rate_pct != null ? bt.win_rate_pct + "%" : "—"}</div>
        <div><span>trades</span>${bt.n_trades != null ? bt.n_trades : "—"}</div>
      </div></div>`;
  }).join("");
  $("#modelSub").textContent = `all numbers walk-forward OOS unless labelled · ${st.meta.n_samples} days · 3-class labels`;

  /* ---------------- monthly heatmap ---------------- */
  const mh = mkChart("chartMonthly");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const heat = st.monthly_pnl.map(([mo, val]) => [mo - 1, 0, val]);
  mh.setOption({
    backgroundColor: "transparent",
    tooltip: { ...TOOLTIP, formatter: (p) => months[p.value[0]] + ": " + p.value[2] + "%" },
    grid: { left: 44, right: 16, top: 16, bottom: 30 },
    xAxis: { type: "category", data: months, ...AXIS, splitArea: { show: false } },
    yAxis: { type: "category", data: ["OOS"], ...AXIS },
    visualMap: {
      min: -30, max: 30, calculable: false, orient: "horizontal", left: "center", bottom: 0,
      textStyle: { color: "#7c8bb8", fontSize: 9 },
      inRange: { color: ["#ff3b6b", "#2b1530", "#101830", "#0e3a2e", "#00ffa3"] },
    },
    series: [{ type: "heatmap", data: heat, label: { show: true, color: "#dbe4ff", fontSize: 9, fontFamily: "JetBrains Mono", formatter: (p) => p.value[2] + "%" }, itemStyle: { borderColor: "#04060e", borderWidth: 2, borderRadius: 3 } }],
  });

  /* ---------------- feature importance ---------------- */
  const fc = mkChart("chartFeatures");
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
      label: { show: true, position: "right", color: "#e879f9", fontSize: 9, fontFamily: "JetBrains Mono" },
    }],
  });

  /* ---------------- trades table ---------------- */
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

/* scroll-reveal */
const io = new IntersectionObserver((entries) =>
  entries.forEach((e) => e.isIntersecting && e.target.classList.add("revealed")),
  { threshold: 0.08 });
document.querySelectorAll(".section").forEach((s) => io.observe(s));

main();
