// READ-ONLY dashboard: no database writes anywhere in this file.
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const fmt = (v, d = 2) => (num(v) === null ? "--" : v.toFixed(d));
const nowS = () => Date.now() / 1000;
const tIST = (s) => num(s) === null || s <= 0 ? "--" :
  new Date(s * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" });
const placeholder = Object.values(firebaseConfig).some((v) => /YOUR_/.test(String(v)));

let live = {}, device = {}, hist = [], liveSeries = [];
let sortKey = "timestamp", sortDir = -1, demoTimer = null, fbUnsubs = [], liveChart, histChart;

/* ---------- UI helpers ---------- */
function showErr(msg) { const e = $("err"); e.textContent = msg || ""; e.hidden = !msg; }
function setBadge(el, cls, text, title = "") { el.className = "badge " + cls; el.textContent = text; el.title = title; }

function renderLive() {
  const adc = num(live.mq6_adc);
  $("adc").textContent = adc === null ? "--" : adc;
  $("adcBar").style.width = adc === null ? "0%" : Math.min(100, adc / 4095 * 100) + "%";
  $("pinV").textContent = fmt(live.mq6_voltage, 3);
  $("aoV").textContent = fmt(live.mq6_ao_voltage, 3);

  const gs = typeof live.gas_status === "string" && live.gas_status ? live.gas_status : null;
  const map = { NORMAL: "ok", WARNING: "warn", CRITICAL: "bad" };
  setBadge($("gas"), (gs && map[gs.toUpperCase()]) || "grey", gs ?? "--",
    "Severity classification is not implemented yet");

  const fr = live.flame_raw;
  $("flameRaw").textContent = fr === 0 || fr === 1 ? fr : "--";
  $("flame").textContent = typeof live.flame_detected === "boolean"
    ? (live.flame_detected ? "IR signal detected" : "No IR signal") : "--";

  $("lu").textContent = tIST(live.last_updated);

  const r = num(device.wifi_rssi);
  $("rssi").textContent = r === null ? "--" : r;
  $("rssiL").textContent = r === null ? "--" : r > -60 ? "Good" : r >= -75 ? "Fair" : "Weak";
}

function renderDevice() {
  const last = num(device.last_updated), age = last ? nowS() - last : null;
  const online = device.online === true && age !== null && age < 20;
  setBadge($("dev"), online ? "ok" : "bad", online ? "Device: ONLINE" : "Device: OFFLINE / STALE");
  $("ago").textContent = last ? `${Math.max(0, Math.round(age))} s ago · last seen ${tIST(last)}` : "No data yet";
}
setInterval(renderDevice, 1000);

/* ---------- Charts ---------- */
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function makeCharts() {
  const base = { responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { labels: { color: css("--fg") } } },
    scales: { x: { ticks: { color: css("--mut"), maxTicksLimit: 8 } }, y: { title: { display: true, text: "ADC counts", color: css("--mut") }, ticks: { color: css("--mut") } } } };
  liveChart = new Chart($("liveChart"), { type: "line",
    data: { labels: [], datasets: [{ label: "mq6_adc", data: [], borderColor: css("--ac"), pointRadius: 0, tension: .2 }] }, options: base });
  const opts = { ...base, scales: { ...base.scales } };
  opts.scales.y1 = { position: "right", min: -0.1, max: 1.1, title: { display: true, text: "flame_raw", color: css("--mut") },
    ticks: { color: css("--mut"), stepSize: 1 }, grid: { drawOnChartArea: false } };
  histChart = new Chart($("histChart"), { type: "line",
    data: { labels: [], datasets: [
      { label: "mq6_adc", data: [], borderColor: css("--ac"), pointRadius: 2, tension: .2 },
      { label: "flame_raw", data: [], borderColor: css("--warn"), stepped: true, pointRadius: 0, yAxisID: "y1" }] }, options: opts });
}
function pushLive(d) {
  const a = num(d.mq6_adc); if (a === null) return;
  const t = num(d.last_updated) ? new Date(d.last_updated * 1000) : new Date();
  liveSeries.push([t.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }), a]);
  if (liveSeries.length > 60) liveSeries.shift();
  liveChart.data.labels = liveSeries.map((p) => p[0]);
  liveChart.data.datasets[0].data = liveSeries.map((p) => p[1]);
  liveChart.update();
}

/* ---------- History: chart, stats, table, CSV ---------- */
function renderHistory() {
  const n = +$("n").value, rows = hist.slice(-n);
  histChart.data.labels = rows.map((r) => new Date(r.timestamp * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  histChart.data.datasets[0].data = rows.map((r) => num(r.mq6_adc));
  histChart.data.datasets[1].data = rows.map((r) => num(r.flame_raw));
  histChart.update();

  const v = rows.map((r) => num(r.mq6_adc)).filter((x) => x !== null).sort((a, b) => a - b);
  const c = v.length, mean = c ? v.reduce((a, b) => a + b, 0) / c : null;
  const med = c ? (c % 2 ? v[(c - 1) / 2] : (v[c / 2 - 1] + v[c / 2]) / 2) : null;
  const sd = c > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (c - 1)) : null; // sample SD
  $("stats").innerHTML = "";
  [["Count", c], ["Min", v[0]], ["Max", v[c - 1]], ["Mean", fmt(mean)], ["Median", fmt(med, 1)], ["Std dev", fmt(sd)]].forEach(([k, x]) => {
    const d = document.createElement("div"); d.innerHTML = `${k}<b></b>`; d.querySelector("b").textContent = x ?? "--"; $("stats").append(d);
  });

  const sorted = [...rows].sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
  });
  const tb = $("tbl").tBodies[0]; tb.innerHTML = "";
  sorted.forEach((r) => {
    const tr = tb.insertRow();
    [tIST(r.timestamp), r.mq6_adc ?? "--", fmt(r.mq6_voltage, 3), fmt(r.mq6_ao_voltage, 3), r.flame_raw ?? "--", r.gas_status ?? "--"]
      .forEach((x) => (tr.insertCell().textContent = x));
  });
}
$("n").onchange = renderHistory;
document.querySelectorAll("th[data-k]").forEach((th) => (th.onclick = () => {
  sortDir = sortKey === th.dataset.k ? -sortDir : -1; sortKey = th.dataset.k; renderHistory();
}));
$("csv").onclick = () => {
  const cols = ["timestamp", "mq6_adc", "mq6_voltage", "mq6_ao_voltage", "flame_raw", "flame_detected", "gas_status"];
  const rows = hist.slice(-+$("n").value);
  const esc = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "lpg_history.csv"; a.click(); URL.revokeObjectURL(a.href);
};

/* ---------- Data sources ---------- */
function stopAll() { clearInterval(demoTimer); fbUnsubs.forEach((f) => f()); fbUnsubs = []; }
function reset() { live = {}; device = {}; hist = []; liveSeries = []; pushLive({}); renderLive(); renderDevice(); renderHistory(); }

function startDemo() {
  stopAll(); reset(); showErr(""); setBadge($("conn"), "grey", "Demo data (no Firebase)");
  const sample = (t) => { const adc = 20 + Math.round(Math.random() * 10);
    return { mq6_adc: adc, mq6_voltage: adc * 3.3 / 4095, mq6_ao_voltage: adc * 3.3 / 4095 * 25 / 15,
      flame_raw: 1, flame_detected: false, gas_status: "UNCLASSIFIED" }; };
  const t0 = Math.floor(nowS());
  hist = Array.from({ length: 100 }, (_, i) => ({ ...sample(), timestamp: t0 - (99 - i) * 60 }));
  const tick = () => { const t = Math.floor(nowS()); live = { ...sample(), last_updated: t };
    device = { online: true, last_updated: t, wifi_rssi: -55 - Math.round(Math.random() * 15) };
    renderLive(); renderDevice(); pushLive(live); };
  tick(); renderHistory(); demoTimer = setInterval(tick, 5000);
}
async function ensureLogin(auth, signIn, onAuthStateChanged) {
  // wait for any saved session to restore
  await new Promise((r) => { const u = onAuthStateChanged(auth, () => { u(); r(); }); });
  while (!auth.currentUser) {
    $("login").hidden = false;
    await new Promise((r) => { $("login").onsubmit = (e) => { e.preventDefault(); r(); }; });
    try { await signIn(auth, $("em").value, $("pw").value); }
    catch (e) { showErr("Login failed: " + e.message); }
  }
  $("login").hidden = true; showErr("");
}
async function startFirebase() {
  stopAll(); reset(); showErr("");
  try {
    const V = "10.14.1", B = `https://www.gstatic.com/firebasejs/${V}/`;
    const { initializeApp, getApps } = await import(B + "firebase-app.js");
    const { getDatabase, ref, onValue, query, orderByChild, limitToLast } = await import(B + "firebase-database.js");
    const { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } = await import(B + "firebase-auth.js");

    const app = getApps()[0] || initializeApp(firebaseConfig), db = getDatabase(app);
    const auth = getAuth(app);

    // Show the login form unless a saved session exists
    await ensureLogin(auth, signInWithEmailAndPassword, onAuthStateChanged);

    // Show who is signed in, so a wrong account is easy to spot
    $("who").textContent = `${auth.currentUser.email || "anonymous"} · UID ${auth.currentUser.uid}`;
    $("out").hidden = false;
    $("out").onclick = async () => { await signOut(auth); location.reload(); };

    const fail = (what) => (e) => showErr(`Cannot read ${what}: ${e.message}. Check that you are signed in as the reader account and that the rules are published.`);

    fbUnsubs.push(onValue(ref(db, ".info/connected"), (s) =>
      setBadge($("conn"), s.val() ? "ok" : "bad", s.val() ? "Firebase: connected" : "Firebase: disconnected")));
    fbUnsubs.push(onValue(ref(db, "LPG_Monitor/live"), (s) => { live = s.val() || {}; renderLive(); pushLive(live); }, fail("/LPG_Monitor/live")));
    fbUnsubs.push(onValue(ref(db, "LPG_Monitor/device"), (s) => { device = s.val() || {}; renderLive(); renderDevice(); }, fail("/LPG_Monitor/device")));
    fbUnsubs.push(onValue(query(ref(db, "LPG_Monitor/history"), orderByChild("timestamp"), limitToLast(100)), (s) => {
      const arr = []; s.forEach((c) => { const v = c.val(); if (v && num(v.timestamp) !== null) arr.push(v); });
      hist = arr.sort((a, b) => a.timestamp - b.timestamp); renderHistory();
    }, fail("/LPG_Monitor/history")));
  } catch (e) { showErr("Firebase failed to start: " + e.message); }
}

/* ---------- Init ---------- */
makeCharts();
$("demo").onchange = () => ($("demo").checked ? startDemo() : startFirebase());
if (placeholder) { $("demo").checked = true; startDemo(); showErr("firebase-config.js still has placeholders — showing demo data."); }
else startFirebase();