/* OptionEdge playground — four input modes, one result panel */
const $ = (s) => document.querySelector(s);
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
const NAMES = ["SELL", "HOLD", "BUY"];
const CLS = ["s", "h", "b"];

let lastCsv = "";      // last csv fed to the model (for the twist slider)
let twistTimer = null;

/* ---------------- nav meta ---------------- */
fetch("/api/state").then((r) => r.json()).then((st) => {
  if (!st.error) $("#generated").textContent = "BUILT " + st.generated;
}).catch(() => {});

/* ---------------- tabs ---------------- */
document.querySelectorAll(".pg-tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".pg-tab").forEach((x) => x.classList.remove("on"));
    document.querySelectorAll(".pg-pane").forEach((x) => x.classList.remove("on"));
    t.classList.add("on");
    document.querySelector(`.pg-pane[data-pane="${t.dataset.mode}"]`).classList.add("on");
  }));

/* ---------------- result panel ---------------- */
function renderResult(j, title) {
  $("#pgResultSec").style.display = "";
  $("#pgResultTitle").textContent = title;
  $("#pgImg").src = "data:image/png;base64," + j.chart_b64;

  const ov = $("#pgAttn");
  ov.innerHTML = "";
  const maxA = Math.max(...j.attention.flat()) || 1;
  j.attention.flat().forEach((w, ci) => {
    const i = document.createElement("i");
    const a = Math.pow(w / maxA, 0.7);
    i.style.background = `rgba(232,121,249,${(a * 0.55).toFixed(3)})`;
    i.style.borderColor = a > 0.5 ? "rgba(232,121,249,.8)" : "transparent";
    if (a > 0.85) i.style.boxShadow = "0 0 12px rgba(232,121,249,.8)";
    i.style.animationDelay = `${(ci % 8) * 120 + Math.floor(ci / 8) * 80}ms`;
    ov.appendChild(i);
  });

  const badge = $("#pgBadge");
  badge.textContent = j.signal;
  badge.className = "signal-badge " + j.signal.toLowerCase();
  $("#pgBars").innerHTML = j.probs.map((p, i) =>
    `<div class="pb ${CLS[i]}"><span>${NAMES[i]}</span><div class="bar"><i data-w="${(p * 100).toFixed(1)}"></i></div><span class="v">${pct(p, 0)}</span></div>`
  ).join("");
  requestAnimationFrame(() => document.querySelectorAll("#pgBars .bar i")
    .forEach((b) => (b.style.width = b.dataset.w + "%")));

  $("#pgMeta").textContent =
    `${j.date} · close ${Number(j.close).toLocaleString("en-IN")} · in-sample ViT`;
  if (j.next_ret_pct != null) {
    const rc = j.next_ret_pct >= 0 ? "pos" : "neg";
    const hit = j.signal === j.actual ? " ✓ called it" : "";
    $("#pgActual").innerHTML =
      `what actually happened next day: <b class="${rc}">${j.next_ret_pct >= 0 ? "+" : ""}${j.next_ret_pct}%</b> · actual label <b>${j.actual}</b>${hit}`;
  } else {
    $("#pgActual").textContent = "last session in the dataset — no next day yet";
  }
  const top = Math.max(...j.probs);
  $("#pgConf").textContent = `model conviction: ${(top * 100).toFixed(1)}% on ${j.signal} · max gap ${((Math.max(...j.probs) - Math.min(...j.probs)) * 100).toFixed(1)}pp`;
  document.getElementById("pgResultSec").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderResultCsv(j, title) {
  $("#pgResultSec").style.display = "";
  $("#pgResultTitle").textContent = title;
  $("#pgImg").src = j.png;
  const ov = $("#pgAttn");
  ov.innerHTML = "";
  const maxA = Math.max(...j.attn.flat()) || 1;
  j.attn.flat().forEach((w, ci) => {
    const i = document.createElement("i");
    const a = Math.pow(w / maxA, 0.7);
    i.style.background = `rgba(232,121,249,${(a * 0.55).toFixed(3)})`;
    i.style.borderColor = a > 0.5 ? "rgba(232,121,249,.8)" : "transparent";
    if (a > 0.85) i.style.boxShadow = "0 0 12px rgba(232,121,249,.8)";
    i.style.animationDelay = `${(ci % 8) * 120 + Math.floor(ci / 8) * 80}ms`;
    ov.appendChild(i);
  });
  const badge = $("#pgBadge");
  badge.textContent = j.signal;
  badge.className = "signal-badge " + j.signal.toLowerCase();
  $("#pgBars").innerHTML = j.probs.map((p, i) =>
    `<div class="pb ${CLS[i]}"><span>${NAMES[i]}</span><div class="bar"><i data-w="${(p * 100).toFixed(1)}"></i></div><span class="v">${pct(p, 0)}</span></div>`
  ).join("");
  requestAnimationFrame(() => document.querySelectorAll("#pgBars .bar i")
    .forEach((b) => (b.style.width = b.dataset.w + "%")));
  $("#pgMeta").textContent =
    `${j.date} · close ${Number(j.close).toLocaleString("en-IN")} · ${j.rows} rows · in-sample ViT`;
  $("#pgActual").textContent = "your own data — no ground truth, this is the open question";
  const top = Math.max(...j.probs);
  $("#pgConf").textContent = `model conviction: ${(top * 100).toFixed(1)}% on ${j.signal} · max gap ${((Math.max(...j.probs) - Math.min(...j.probs)) * 100).toFixed(1)}pp`;
}

function setPgStatus(msg, err = false) {
  const el = $("#pgStatus");
  el.textContent = msg;
  el.classList.toggle("err", err);
}

/* ---------------- mode: date ---------------- */
const pgDate = $("#pgDate");
pgDate.min = "2010-03-22";
pgDate.max = "2026-04-10";
pgDate.value = "2026-04-10";

async function runDate(dateStr, { retry = true } = {}) {
  try {
    const r = await fetch("/api/predict" + (dateStr ? `?date=${dateStr}` : ""));
    const j = await r.json();
    if (j.error) {
      if (retry && dateStr && Math.random() < 1) { // non-trading day -> try another
        return runDate(randomDate(), { retry: true });
      }
      setPgStatus("⚠ " + j.error, true);
      return;
    }
    renderResult(j, `session ${j.date}`);
    setPgStatus(`done — ${j.signal} @ ${j.date}`);
  } catch (e) {
    setPgStatus("⚠ " + e, true);
  }
}
function randomDate() {
  const a = new Date("2010-03-22").getTime();
  const b = new Date("2026-04-10").getTime();
  const d = new Date(a + Math.random() * (b - a));
  return d.toISOString().slice(0, 10);
}
$("#pgRunDate").addEventListener("click", () => runDate(pgDate.value));
pgDate.addEventListener("change", () => runDate(pgDate.value));
$("#pgLatest").addEventListener("click", () => { pgDate.value = pgDate.max; runDate(pgDate.value); });
$("#pgDice").addEventListener("click", () => {
  let d = randomDate();
  pgDate.value = d;
  runDate(d);
});

/* ---------------- mode: paste / upload ---------------- */
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

async function runCsv(csv, title = "your data") {
  lastCsv = csv;
  $("#pgTwist").value = 0;
  $("#pgTwistLbl").textContent = "±0.00%";
  setPgStatus("rendering your chart → running the ViT…");
  try {
    const r = await fetch("/api/predict", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });
    const j = await r.json();
    if (!j.ok) { setPgStatus("⚠ " + (j.error || "failed"), true); return; }
    renderResultCsv(j, title);
    setPgStatus(`done — ${j.signal} · S/H/B = ${j.probs.map((p) => (p * 100).toFixed(1)).join(" / ")}%`);
  } catch (e) {
    setPgStatus("⚠ " + e, true);
  }
}

$("#pgRunCsv").addEventListener("click", () => {
  const csv = $("#pgCsv").value.trim();
  if (!csv) { setPgStatus("paste some rows first (or hit load latest / upload)", true); return; }
  runCsv(csv, "your data");
});

$("#pgLoadLatest").addEventListener("click", async () => {
  setPgStatus("loading latest NIFTY sessions…");
  try {
    const j = await (await fetch("/api/latest?rows=60")).json();
    $("#pgCsv").value = j.csv;
    setPgStatus(`${j.rows} rows loaded (ends ${j.date}) — twist the slider or hit PREDICT`);
  } catch (e) {
    setPgStatus("⚠ " + e, true);
  }
});

$("#pgFile").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const rows = parseCsv(String(rd.result));
      $("#pgCsv").value = rows.map((r) => r.join(",")).join("\n");
      setPgStatus(`uploaded ${f.name}: ${rows.length} rows parsed — hit PREDICT`);
    } catch (err) {
      setPgStatus("⚠ could not parse " + f.name + ": " + err.message, true);
    }
  };
  rd.readAsText(f);
});

/* twist slider: modify the final row's close (and high), re-predict live */
$("#pgTwist").addEventListener("input", (e) => {
  const dp = +e.target.value / 100;
  $("#pgTwistLbl").textContent = `±${(dp >= 0 ? "+" : "") + (dp * 100).toFixed(2)}%`;
  const csv = $("#pgCsv").value.trim();
  if (!csv) { setPgStatus("load or paste data first, then twist", true); return; }
  clearTimeout(twistTimer);
  twistTimer = setTimeout(async () => {
    try {
      const rows = parseCsv(csv);
      const last = rows[rows.length - 1];
      const c0 = last[4];
      const c = +(c0 * (1 + dp)).toFixed(2);
      last[4] = c;
      if (c > last[2]) last[2] = +c.toFixed(2); // high must cover close
      if (c < last[3]) last[3] = +(c * 0.999).toFixed(2);
      await runCsv(rows.map((r) => r.join(",")).join("\n"), `your data · final close ${dp >= 0 ? "+" : ""}${(dp * 100).toFixed(2)}%`);
    } catch (err) {
      setPgStatus("⚠ " + err.message, true);
    }
  }, 350);
});

/* ---------------- mode: scenario ---------------- */
function genScenario(kind, days = 40, start = 24000) {
  const dates = [];
  const d = new Date("2026-04-10");
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
const SCEN_NAMES = { up: "📈 uptrend", down: "📉 downtrend", spike: "🌪 vol spike", chop: "📏 sideways chop", random: "🎰 random walk" };
document.querySelectorAll(".scen-btn").forEach((b) => b.addEventListener("click", () => {
  const kind = b.dataset.scen;
  const rows = genScenario(kind);
  const csv = rows.map((r) => r.join(",")).join("\n");
  $("#pgScenData").textContent = rows.slice(-5).map((r) => r.join(",")).join("\n");
  document.querySelector(".pg-details").open = true;
  runCsv(csv, `scenario ${SCEN_NAMES[kind]}`);
  document.querySelector(`.pg-pane[data-pane="paste"]`); // (csv stays in the textarea if user switches)
  $("#pgCsv").value = csv;
}));

/* ---------------- mode: batch ---------------- */
$("#pgFrom").min = "2010-03-22";
$("#pgFrom").max = "2026-04-10";
$("#pgTo").min = "2010-03-22";
$("#pgTo").max = "2026-04-10";
$("#pgFrom").value = "2024-01-01";
$("#pgTo").value = "2024-06-30";

$("#pgRunBatch").addEventListener("click", async () => {
  const out = $("#pgBatchOut");
  out.innerHTML = '<div class="dim mono">running the ViT on every session in range…</div>';
  try {
    const r = await fetch("/api/predict_range", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: $("#pgFrom").value, to: $("#pgTo").value }),
    });
    const j = await r.json();
    if (j.error) { out.innerHTML = `<div class="dim mono" style="color:#ff3b6b">⚠ ${j.error}</div>`; return; }
    const s = j.summary;
    const rowsHtml = j.days.map((d) => {
      const sig = d.signal.toLowerCase();
      const hit = d.actual ? (d.signal === d.actual ? ' class="bhit"' : "") : "";
      return `<tr${hit}><td>${d.date}</td>
        <td><span class="sig ${sig}">${d.signal}</span></td>
        <td class="mono">${(d.probs[0] * 100).toFixed(0)}/${(d.probs[1] * 100).toFixed(0)}/${(d.probs[2] * 100).toFixed(0)}</td>
        <td class="mono">${d.next_ret_pct != null ? (d.next_ret_pct >= 0 ? "+" : "") + d.next_ret_pct + "%" : "—"}</td>
        <td>${d.actual || "—"}</td></tr>`;
    }).join("");
    out.innerHTML = `
      <div class="pg-batch-cards mono">
        <div class="pg-bc"><b>${j.n}</b><span>sessions run</span></div>
        <div class="pg-bc"><b>${s.exact_hit_pct != null ? s.exact_hit_pct + "%" : "—"}</b><span>exact 3-class hit (vs actual label)</span></div>
        <div class="pg-bc"><b>${s.exact_hit != null ? s.exact_hit + "/" + s.graded : "—"}</b><span>correct / graded days</span></div>
      </div>
      <div class="table-wrap pg-batch-table"><table>
        <tr><th>DATE</th><th>ViT SIGNAL</th><th>P S/H/B %</th><th>NEXT DAY</th><th>ACTUAL</th></tr>
        ${rowsHtml}
      </table></div>
      <p class="dim pg-hint">green row = the ViT's call matched the actual next-day label. This is the honest OOS-style read:
      daily direction hovers around chance — the vol-expansion straddle (RESEARCH page) is where the real edge is.</p>`;
  } catch (e) {
    out.innerHTML = `<div class="dim mono" style="color:#ff3b6b">⚠ ${e}</div>`;
  }
});

/* ---------------- attention controls ---------------- */
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

/* first render: latest session, so the page never looks empty */
runDate(pgDate.value);
