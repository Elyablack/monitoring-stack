(function () {
  const THEME_KEY = "demoapp_theme";
  const themes = ["terminal", "light"];

  const ALERTS_AUTO_INTERVAL_MS = 30000;
  const LOGS_AUTO_INTERVAL_MS = 30000;

  const FAST_ALERT_WAIT_MS = 30000;
  const FAST_ALERT_WAIT_STEP_MS = 2000;

  const LONG_DEMO_WATCH_MS = 90000;
  const LONG_DEMO_WATCH_STEP_MS = 3000;

  const scenarioState = {
    running: false,
    stopRequested: false,
    mode: "idle",
    sent: 0,
    errors: 0,
    slow: 0,
    alertState: "waiting",
    fastAlertNames: [],
    longAlertNames: [],
    startedAtMs: null,
    runId: 0,
  };

  const obsState = {
    logsMode: "buttons",
    refreshAlerts: null,
    refreshLogs: null,
    lastLogsPayload: null,
    lastAlertsPayload: null,
  };

  function $(sel) {
    return document.querySelector(sel);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function toast(msg) {
    let t = $(".toast");
    if (!t) {
      t = el("div", "toast");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast._tmr);
    toast._tmr = setTimeout(() => t.classList.remove("on"), 900);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nowMs() {
    return Date.now();
  }

  function parseTsToMs(ts) {
    if (!ts) return null;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function currentScenarioCutoffMs() {
    return scenarioState.startedAtMs;
  }

  function themeIcon(theme) {
    return theme === "light" ? "☀️" : "🌙";
  }

  function applyTheme(t) {
    const theme = themes.includes(t) ? t : "terminal";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);

    const icon = $("#pl-theme-icon");
    if (icon) icon.textContent = themeIcon(theme);

    const btn = $("#pl-theme-btn");
    if (btn) btn.setAttribute("aria-label", `Theme: ${theme}. Click to toggle.`);
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "terminal";
    const next = cur === "terminal" ? "light" : "terminal";
    applyTheme(next);
    toast(`theme=${next}`);
  }

  function ensureThemeButton(host) {
    const btn = el("button", "seg seg-btn");
    btn.id = "pl-theme-btn";
    btn.type = "button";
    btn.title = "Toggle theme (t)";
    btn.innerHTML = `<span class="theme-icon v" id="pl-theme-icon">🌙</span>`;
    btn.addEventListener("click", () => toggleTheme());
    host.appendChild(btn);
  }

  function flashBtn(btn) {
    if (!btn) return;
    btn.classList.add("flash");
    clearTimeout(btn._flashT);
    btn._flashT = setTimeout(() => btn.classList.remove("flash"), 160);
  }

  async function pingHealthz() {
    try {
      const r = await fetch("/healthz", { cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  }

  function setStatus(ok) {
    const dot = $("#pl-dot");
    const v = $("#pl-status");
    const seg = $("#pl-seg-status");
    if (!dot || !v || !seg) return;

    dot.classList.remove("ok", "bad", "warn");
    seg.classList.remove("ok", "bad", "warn");

    if (ok) {
      dot.classList.add("ok");
      seg.classList.add("ok");
      v.textContent = "ONLINE";
    } else {
      dot.classList.add("bad");
      seg.classList.add("bad");
      v.textContent = "OFFLINE";
    }
  }

  function setTime() {
    const n = $("#pl-time");
    if (!n) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    n.textContent = `${hh}:${mm}:${ss}`;
  }

  function appendEvent(line) {
    const pre = $("#output");
    if (!pre) return;
    const now = new Date();
    const ts = now.toISOString().replace("T", " ").replace("Z", "");
    const cur = pre.textContent.trimEnd();
    const next = (cur ? cur + "\n" : "") + `[${ts}] ${line}`;
    const lines = next.split("\n").slice(-180);
    pre.textContent = lines.join("\n") + "\n";
    pre.scrollTop = pre.scrollHeight;
  }

  function curlFor(path) {
    const base = window.location.origin;
    return `curl -fsS '${base}${path}'`;
  }

  async function hit(path, opts = {}) {
    const method = opts.method || "GET";
    const silent = opts.silent === true;

    if (!silent) appendEvent(`REQUEST ${method} ${path}`);

    try {
      const r = await fetch(path, { method, cache: "no-store" });
      const txt = await r.text();

      if (!silent) appendEvent(`RESPONSE ${r.status} ${txt.trim().slice(0, 250)}`);

      return {
        ok: r.ok,
        status: r.status,
        body: txt,
        retryAfter: Number(r.headers.get("retry-after") || "0"),
      };
    } catch (e) {
      if (!silent) appendEvent(`ERROR ${String(e)}`);
      return { ok: false, status: 0, body: "", retryAfter: 0 };
    }
  }

  async function fetchJson(path) {
    try {
      const r = await fetch(path, { cache: "no-store" });
      const txt = await r.text();
      try {
        return { ok: r.ok, status: r.status, json: JSON.parse(txt) };
      } catch {
        return {
          ok: false,
          status: r.status,
          json: { ok: false, error: "bad json", raw: txt.slice(0, 500) },
        };
      }
    } catch {
      return { ok: false, status: 0, json: { ok: false, error: "network error" } };
    }
  }

  function ensurePowerlineAndTheme() {
    let pl = $(".powerline");
    if (!pl) {
      const top = $(".topbar") || document.body;
      pl = el("div", "powerline");
      top.appendChild(pl);
    }

    function seg(id, innerHtml) {
      const s = el("div", "seg");
      s.id = id;
      s.innerHTML = innerHtml;
      return s;
    }

    if (!$("#pl-seg-app")) {
      pl.appendChild(seg("pl-seg-app", `<span class="k">app</span><span class="v" id="pl-app">demo-app</span>`));
      pl.appendChild(seg("pl-seg-env", `<span class="k">env</span><span class="v" id="pl-env">prod</span>`));
      pl.appendChild(seg("pl-seg-status", `<span class="dot" id="pl-dot"></span><span class="k">status</span><span class="v" id="pl-status">?</span>`));
      pl.appendChild(seg("pl-seg-time", `<span class="k">time</span><span class="v" id="pl-time">--:--:--</span>`));
    }

    if (!$("#pl-theme-btn")) ensureThemeButton(pl);
  }

  function initFromDom() {
    const appName = document.documentElement.getAttribute("data-app") || $("#app-name")?.textContent || null;
    const env = document.documentElement.getAttribute("data-env") || null;
    if (appName && $("#pl-app")) $("#pl-app").textContent = appName;
    if (env && $("#pl-env")) $("#pl-env").textContent = env;
  }

  function summarizeAlertMatch(alerts, names) {
    const wanted = new Set(names || []);
    const active = (alerts || []).filter((a) => wanted.has(a.alertname));
    return active.length ? active[0] : null;
  }

  function shortAlertState(value) {
    if (!value) return "waiting";
    if (value.startsWith("detected-fast:")) return "demo-fast";
    if (value.startsWith("detected-long:")) return "demo-live";
    return value;
  }

  function updateScenarioStatus(level, message, sub) {
    const pill = $("#demo-level");
    const messageEl = $("#demo-message");
    const subEl = $("#demo-sub");

    if (pill) {
      pill.className = `demo-status-pill ${level}`;
      pill.textContent = level.toUpperCase();
    }
    if (messageEl) messageEl.textContent = message;
    if (subEl) subEl.textContent = sub || "";
  }

  function renderScenarioStats() {
    const sent = $("#stat-sent");
    const errors = $("#stat-errors");
    const slow = $("#stat-slow");
    const alert = $("#stat-alert");

    if (sent) sent.textContent = String(scenarioState.sent);
    if (errors) errors.textContent = String(scenarioState.errors);
    if (slow) slow.textContent = String(scenarioState.slow);
    if (alert) alert.textContent = shortAlertState(scenarioState.alertState);
  }

  function resetScenarioCounters(mode, fastAlertNames, longAlertNames) {
    scenarioState.running = true;
    scenarioState.stopRequested = false;
    scenarioState.mode = mode;
    scenarioState.sent = 0;
    scenarioState.errors = 0;
    scenarioState.slow = 0;
    scenarioState.alertState = "waiting";
    scenarioState.fastAlertNames = fastAlertNames || [];
    scenarioState.longAlertNames = longAlertNames || [];
    scenarioState.startedAtMs = nowMs();
    scenarioState.runId += 1;
    renderScenarioStats();
  }

  function stopScenario(opts = {}) {
    scenarioState.stopRequested = true;
    scenarioState.running = false;
    scenarioState.mode = "idle";
    scenarioState.alertState = "stopped";
    renderScenarioStats();

    if (!opts.quiet) {
      updateScenarioStatus("idle", "Scenario stopped.", "You can start another demo scenario.");
      appendEvent("SCENARIO stopped");
    }
  }

  async function ensureScenarioSlot() {
    if (!scenarioState.running) return;
    appendEvent("SCENARIO interrupt previous run");
    stopScenario({ quiet: true });
    await sleep(50);
  }

  function filterEntriesForScenario(entries) {
    const cutoff = currentScenarioCutoffMs();
    if (!Array.isArray(entries)) return [];
    if (!cutoff) return entries;

    return entries.filter((entry) => {
      const tsMs = parseTsToMs(entry.ts);
      if (!tsMs) return false;
      return tsMs >= cutoff - 1000;
    });
  }

  function summarizeEntries(entries) {
    const byEvent = {};
    for (const entry of entries) {
      const ev = entry?.event || "unknown";
      byEvent[ev] = (byEvent[ev] || 0) + 1;
    }
    return byEvent;
  }

  async function refreshObsNow(opts = {}) {
    const refreshAlerts = obsState.refreshAlerts;
    const refreshLogs = obsState.refreshLogs;

    if (typeof refreshAlerts === "function") {
      await refreshAlerts({ silent: opts.silent === true });
    }
    if (typeof refreshLogs === "function") {
      await refreshLogs({ silent: opts.silent === true });
    }
  }

  async function checkScenarioAlerts() {
    const r = await fetchJson("/_obs/alerts");
    if (!r.ok || !r.json?.ok) return null;

    const fastMatch = summarizeAlertMatch(r.json.alerts || [], scenarioState.fastAlertNames);
    const longMatch = summarizeAlertMatch(r.json.alerts || [], scenarioState.longAlertNames);

    return { fastMatch, longMatch, payload: r.json };
  }

  async function waitForFastAlert(runId) {
    const started = Date.now();

    while (
      !scenarioState.stopRequested &&
      scenarioState.runId === runId &&
      Date.now() - started < FAST_ALERT_WAIT_MS
    ) {
      const alertCheck = await checkScenarioAlerts();

      if (alertCheck?.fastMatch) {
        scenarioState.alertState = `detected-fast:${alertCheck.fastMatch.alertname}`;
        renderScenarioStats();
        updateScenarioStatus(
          "info",
          `Fast demo alert detected: ${alertCheck.fastMatch.alertname}`,
          "Traffic reached Alertmanager. Now waiting for the longer demo rule window."
        );
        appendEvent(`SCENARIO fast demo alert detected -> ${alertCheck.fastMatch.alertname}`);
        await refreshObsNow({ silent: true });
        return true;
      }

      scenarioState.alertState = "waiting";
      renderScenarioStats();
      updateScenarioStatus(
        "info",
        "Scenario finished. Waiting for the fast demo alert to appear.",
        "Prometheus and Alertmanager may need a few extra evaluation seconds before the alert becomes visible."
      );

      await refreshObsNow({ silent: true });
      await sleep(FAST_ALERT_WAIT_STEP_MS);
    }

    return false;
  }

  async function watchLongDemoWindow(runId) {
    const started = Date.now();

    while (
      !scenarioState.stopRequested &&
      scenarioState.runId === runId &&
      Date.now() - started < LONG_DEMO_WATCH_MS
    ) {
      const alertCheck = await checkScenarioAlerts();

      if (alertCheck?.longMatch) {
        scenarioState.alertState = `detected-long:${alertCheck.longMatch.alertname}`;
        renderScenarioStats();
        updateScenarioStatus(
          "ok",
          `Longer demo alert detected: ${alertCheck.longMatch.alertname}`,
          "The scenario reached the longer demo rule window, not only the instant button alert."
        );
        appendEvent(`SCENARIO longer demo alert detected -> ${alertCheck.longMatch.alertname}`);
        await refreshObsNow({ silent: true });
        return;
      }

      scenarioState.alertState = "watching";
      renderScenarioStats();
      updateScenarioStatus(
        "info",
        "Fast demo alert detected. Waiting for the longer demo alert window.",
        "The traffic worked. Prometheus still needs more evaluation time for the longer demo rule."
      );

      await refreshObsNow({ silent: true });
      await sleep(LONG_DEMO_WATCH_STEP_MS);
    }

    if (!scenarioState.stopRequested && scenarioState.runId === runId) {
      scenarioState.alertState = "timeout";
      renderScenarioStats();
      updateScenarioStatus(
        "warning",
        "Fast demo alert was detected, but the longer demo alert is not visible yet.",
        "The scenario succeeded, but the longer rule still needs more time or lighter thresholds."
      );
      await refreshObsNow({ silent: true });
    }
  }

  async function runBurst(kind) {
    await ensureScenarioSlot();

    const msInput = $("#slow-ms");
    const burstInput = $("#burst-count");
    const intervalInput = $("#burst-interval");

    const slowMs = Math.max(0, Math.min(30000, Number(msInput?.value || "1200") || 1200));
    const burstCount = Math.max(1, Math.min(240, Number(burstInput?.value || "18") || 18));
    const intervalMs = Math.max(50, Math.min(10000, Number(intervalInput?.value || "350") || 350));

    if (msInput) msInput.value = String(slowMs);
    if (burstInput) burstInput.value = String(burstCount);
    if (intervalInput) intervalInput.value = String(intervalMs);

    const fastAlertNames =
      kind === "5xx"
        ? ["DemoAppButtonError503"]
        : kind === "latency"
          ? ["DemoAppButtonSlow"]
          : ["DemoAppButtonError503", "DemoAppButtonSlow"];

    const longAlertNames =
      kind === "5xx"
        ? ["DemoAppHigh5xxRate"]
        : kind === "latency"
          ? ["DemoAppHighP95Latency"]
          : ["DemoAppHigh5xxRate", "DemoAppHighP95Latency"];

    resetScenarioCounters(kind, fastAlertNames, longAlertNames);
    const runId = scenarioState.runId;

    updateScenarioStatus(
      "running",
      `Running ${kind} scenario.`,
      `burst=${burstCount} interval=${intervalMs}ms slow_ms=${slowMs}`
    );
    appendEvent(`SCENARIO start kind=${kind} burst=${burstCount} interval_ms=${intervalMs} slow_ms=${slowMs}`);

    try {
      for (let i = 0; i < burstCount; i += 1) {
        if (scenarioState.stopRequested || scenarioState.runId !== runId) break;

        if (kind === "5xx" || kind === "both") {
          const r = await hit("/error?code=503", { silent: true });
          scenarioState.sent += 1;
          if (r.status === 503) scenarioState.errors += 1;
          appendEvent(`SCENARIO 503 #${scenarioState.errors} -> ${r.status}`);

          if (r.status === 429) {
            scenarioState.alertState = "cooldown";
            renderScenarioStats();
            updateScenarioStatus(
              "warning",
              "Scenario hit rate limit.",
              `retry-after=${r.retryAfter || "unknown"}s. Increase RATE_LIMIT or slow down the burst.`
            );
            await refreshObsNow({ silent: true });
            break;
          }
        }

        if ((kind === "latency" || kind === "both") && !scenarioState.stopRequested && scenarioState.runId === runId) {
          const r = await hit(`/slow?ms=${encodeURIComponent(String(slowMs))}`, { silent: true });
          scenarioState.sent += 1;
          if (r.status === 200) scenarioState.slow += 1;
          appendEvent(`SCENARIO slow #${scenarioState.slow} -> ${r.status} (${slowMs}ms)`);

          if (r.status === 429) {
            scenarioState.alertState = "cooldown";
            renderScenarioStats();
            updateScenarioStatus(
              "warning",
              "Scenario hit rate limit.",
              `retry-after=${r.retryAfter || "unknown"}s. Increase RATE_LIMIT or slow down the burst.`
            );
            await refreshObsNow({ silent: true });
            break;
          }
        }

        renderScenarioStats();

        if (i < burstCount - 1) {
          await sleep(intervalMs);
        }
      }

      if (!scenarioState.stopRequested && scenarioState.runId === runId) {
        await refreshObsNow({ silent: true });
        const fastFound = await waitForFastAlert(runId);

        if (fastFound && !scenarioState.stopRequested && scenarioState.runId === runId) {
          await watchLongDemoWindow(runId);
        } else if (!fastFound && !scenarioState.stopRequested && scenarioState.runId === runId) {
          scenarioState.alertState = "timeout";
          renderScenarioStats();
          updateScenarioStatus(
            "warning",
            "Scenario finished, but the fast demo alert did not appear in time.",
            "Refresh alerts and check Prometheus evaluation timing or make the scenario burst stronger."
          );
          await refreshObsNow({ silent: true });
        }
      }
    } finally {
      if (!scenarioState.stopRequested && scenarioState.runId === runId) {
        scenarioState.running = false;
        scenarioState.mode = "idle";
      }
      appendEvent(`SCENARIO end kind=${kind} sent=${scenarioState.sent} errors=${scenarioState.errors} slow=${scenarioState.slow}`);
    }
  }

  function wireQuickActions() {
    const btn503 = $("#btn-503");
    const btnSlow = $("#btn-slow");
    const btnMetrics = $("#btn-metrics");
    const btnCopy = $("#btn-copy");
    const btnScenario5xx = $("#btn-scenario-5xx");
    const btnScenarioLatency = $("#btn-scenario-latency");
    const btnScenarioBoth = $("#btn-scenario-both");
    const btnScenarioStop = $("#btn-scenario-stop");
    const msInput = $("#slow-ms");

    if (btn503) {
      btn503.addEventListener("click", async () => {
        flashBtn(btn503);
        const r = await hit("/error?code=503");
        if (r.status === 429) toast("rate limited");
      });
    }

    if (btnSlow) {
      btnSlow.addEventListener("click", async () => {
        flashBtn(btnSlow);
        const ms = msInput ? Number(msInput.value || "1200") : 1200;
        const safe = Number.isFinite(ms) ? Math.max(0, Math.min(ms, 30000)) : 1200;
        if (msInput) msInput.value = String(safe);
        const r = await hit(`/slow?ms=${encodeURIComponent(String(safe))}`);
        if (r.status === 429) toast("rate limited");
      });
    }

    if (btnScenario5xx) {
      btnScenario5xx.addEventListener("click", async () => {
        flashBtn(btnScenario5xx);
        await runBurst("5xx");
      });
    }

    if (btnScenarioLatency) {
      btnScenarioLatency.addEventListener("click", async () => {
        flashBtn(btnScenarioLatency);
        await runBurst("latency");
      });
    }

    if (btnScenarioBoth) {
      btnScenarioBoth.addEventListener("click", async () => {
        flashBtn(btnScenarioBoth);
        await runBurst("both");
      });
    }

    if (btnScenarioStop) {
      btnScenarioStop.addEventListener("click", () => {
        flashBtn(btnScenarioStop);
        stopScenario();
      });
    }

    if (btnMetrics) {
      btnMetrics.addEventListener("click", async () => {
        flashBtn(btnMetrics);
        window.open("/metrics", "_blank", "noopener,noreferrer");
        appendEvent("OPEN /metrics (new tab)");
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        flashBtn(btnCopy);
        const ms = msInput ? Number(msInput.value || "1200") : 1200;
        const safe = Number.isFinite(ms) ? Math.max(0, Math.min(ms, 30000)) : 1200;
        const script = [
          curlFor("/healthz"),
          curlFor("/metrics"),
          curlFor(`/slow?ms=${safe}`),
          curlFor("/error?code=503"),
          curlFor("/_obs/alerts"),
          curlFor("/_obs/logs?mode=buttons&limit=20"),
        ].join("\n") + "\n";
        await navigator.clipboard.writeText(script);
        toast("copied curl script");
      });
    }
  }

  function hotkeys() {
    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "t" || e.key === "T") toggleTheme();
    });
  }

  async function refreshStatusLoop() {
    setTime();
    setStatus(await pingHealthz());
    setInterval(async () => {
      setTime();
      setStatus(await pingHealthz());
    }, 3000);
  }

  function fmtAlerts(payload) {
    if (!payload || !payload.ok) return `error: ${payload?.error || "unknown"}`;

    obsState.lastAlertsPayload = payload;

    const alerts = payload.alerts || [];
    const active = alerts.filter((a) => a.status === "active").length;
    const suppressed = alerts.filter((a) => a.status === "suppressed").length;
    const unprocessed = alerts.filter((a) => a.status === "unprocessed").length;

    const summaryCount = $("#alerts-summary-count");
    const summarySub = $("#alerts-summary-sub");

    if (summaryCount) summaryCount.textContent = String(alerts.length);
    if (summarySub) summarySub.textContent = `active=${active} suppressed=${suppressed} unprocessed=${unprocessed}`;

    const head = `count=${alerts.length} active=${active} suppressed=${suppressed} unprocessed=${unprocessed}`;
    const lines = alerts.slice(0, 80).map((a) => {
      const sev = a.severity || "-";
      const name = a.alertname || "-";
      const instn = a.instance_name || "-";
      const inst = a.instance || "-";
      const st = a.status || "-";
      return `${st.padEnd(11)} sev=${String(sev).padEnd(8)} ${name}  ${instn}  ${inst}`;
    });

    return [head, "", ...lines].join("\n");
  }

  function summarizeLogEntry(e) {
    const ts = (e.ts || "").replace("T", " ").replace("Z", "");
    const ev = e.event || "-";

    if (ev === "forced_slow") {
      const ms = e.ms ?? "-";
      const ip = e.client_ip ?? "-";
      return `${ts}  forced_slow ms=${ms} ip=${ip}`;
    }

    if (ev === "forced_error") {
      const code = e.code ?? "-";
      const msg = e.msg ?? "";
      return `${ts}  forced_error code=${code} ${msg}`.trim();
    }

    if (ev === "http_request") {
      const st = String(e.status ?? "-").padEnd(3);
      const ms = String(e.duration_ms ?? "-").padStart(4);
      const m = (e.method || "-").padEnd(4);
      const p = e.path || "-";
      const ip = e.client_ip || "-";
      return `${ts}  ${st}  ${ms}ms  ${m} ${p}  ip=${ip}`;
    }

    return `${ts}  ${ev}  ${(e.raw || "").slice(0, 200)}`;
  }

  function fmtLogs(payload) {
    if (!payload || !payload.ok) return `error: ${payload?.error || "unknown"}`;

    obsState.lastLogsPayload = payload;

    const allEntries = payload.entries || [];
    const entries = filterEntriesForScenario(allEntries);
    const byEvent = summarizeEntries(entries);

    const summaryCount = $("#logs-summary-count");
    const summarySub = $("#logs-summary-sub");

    if (summaryCount) summaryCount.textContent = String(entries.length);
    if (summarySub) summarySub.textContent = `events=${JSON.stringify(byEvent)}`;

    const head = `count=${entries.length} events=${JSON.stringify(byEvent)}`;
    const lines = entries.map(summarizeLogEntry);
    return [head, "", ...lines].join("\n");
  }

  function wireObs() {
    const alertsOut = $("#alerts-out");
    const logsOut = $("#logs-out");

    const btnAlerts = $("#btn-alerts");
    const btnAlertsAuto = $("#btn-alerts-auto");

    const btnLogsButtons = $("#btn-logs-buttons");
    const btnLogs = $("#btn-logs");
    const btnLogsAuto = $("#btn-logs-auto");

    let alertsAuto = true;
    let logsAuto = true;
    let tAlerts = null;
    let tLogs = null;

    async function refreshAlerts(opts = {}) {
      if (!alertsOut) return;
      const r = await fetchJson("/_obs/alerts");
      alertsOut.textContent = fmtAlerts(r.json);
      if (!opts.silent) appendEvent(`OBS alerts refresh -> ${r.ok ? "ok" : "err"} (${r.status})`);
    }

    async function refreshLogs(opts = {}) {
      if (!logsOut) return;
      const r = await fetchJson(`/_obs/logs?mode=${encodeURIComponent(obsState.logsMode)}&limit=80`);
      logsOut.textContent = fmtLogs(r.json);
      if (!opts.silent) appendEvent(`OBS logs refresh -> ${r.ok ? "ok" : "err"} (${r.status})`);
    }

    obsState.refreshAlerts = refreshAlerts;
    obsState.refreshLogs = refreshLogs;

    function setAutoBtn(btn, on) {
      if (!btn) return;
      btn.textContent = on ? "auto: on" : "auto: off";
      btn.classList.toggle("primary", on);
    }

    function setModeBtns() {
      if (btnLogsButtons) btnLogsButtons.classList.toggle("primary", obsState.logsMode === "buttons");
    }

    if (btnAlerts) {
      btnAlerts.addEventListener("click", async () => {
        flashBtn(btnAlerts);
        await refreshAlerts();
      });
    }

    if (btnAlertsAuto) {
      btnAlertsAuto.addEventListener("click", async () => {
        flashBtn(btnAlertsAuto);
        alertsAuto = !alertsAuto;
        setAutoBtn(btnAlertsAuto, alertsAuto);
        if (tAlerts) clearInterval(tAlerts);
        tAlerts = alertsAuto ? setInterval(() => refreshAlerts({ silent: true }), ALERTS_AUTO_INTERVAL_MS) : null;
        if (alertsAuto) await refreshAlerts();
      });
    }

    if (btnLogsButtons) {
      btnLogsButtons.addEventListener("click", async () => {
        flashBtn(btnLogsButtons);
        obsState.logsMode = "buttons";
        setModeBtns();
        await refreshLogs();
      });
    }

    if (btnLogs) {
      btnLogs.addEventListener("click", async () => {
        flashBtn(btnLogs);
        await refreshLogs();
      });
    }

    if (btnLogsAuto) {
      btnLogsAuto.addEventListener("click", async () => {
        flashBtn(btnLogsAuto);
        logsAuto = !logsAuto;
        setAutoBtn(btnLogsAuto, logsAuto);
        if (tLogs) clearInterval(tLogs);
        tLogs = logsAuto ? setInterval(() => refreshLogs({ silent: true }), LOGS_AUTO_INTERVAL_MS) : null;
        if (logsAuto) await refreshLogs();
      });
    }

    setModeBtns();
    setAutoBtn(btnAlertsAuto, alertsAuto);
    setAutoBtn(btnLogsAuto, logsAuto);

    refreshAlerts();
    refreshLogs();

    if (alertsAuto) tAlerts = setInterval(() => refreshAlerts({ silent: true }), ALERTS_AUTO_INTERVAL_MS);
    if (logsAuto) tLogs = setInterval(() => refreshLogs({ silent: true }), LOGS_AUTO_INTERVAL_MS);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    ensurePowerlineAndTheme();

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || "terminal");

    initFromDom();
    hotkeys();
    wireQuickActions();
    wireObs();
    renderScenarioStats();

    updateScenarioStatus(
      "idle",
      "Pick a scenario to generate alert-friendly traffic.",
      "Fast demo alerts should appear first. Longer demo alerts need a wider Prometheus window."
    );

    await refreshStatusLoop();
    appendEvent("ready");
  });
})();
