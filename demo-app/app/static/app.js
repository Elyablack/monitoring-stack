(function () {
  const THEME_KEY = "demoapp_theme";
  const THEMES = ["terminal", "light"];

  const ALERT_NAME_ERROR = "DemoAppButtonError503";
  const ALERT_NAME_SLOW = "DemoAppButtonSlow";

  const ALERTS_AUTO_INTERVAL_MS = 5000;
  const LOGS_AUTO_INTERVAL_MS = 5000;
  const STATUS_REFRESH_INTERVAL_MS = 3000;
  const SCENARIO_TIMEOUT_MS = 90000;

  const state = {
    alertsAuto: true,
    logsAuto: true,
    logsMode: "buttons",
    alertsTimer: null,
    logsTimer: null,
    scenario: {
      running: false,
      cancelled: false,
      kind: null,
      startedAtMs: null,
      finishedAtMs: null,
      sent: 0,
      errors: 0,
      slow: 0,
      detectedAlerts: new Set(),
      timeoutTimer: null,
      phase: "idle",
    },
    latestAlertsPayload: null,
    latestLogsPayload: null,
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
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
    toast._tmr = setTimeout(() => t.classList.remove("on"), 1000);
  }

  function themeIcon(theme) {
    return theme === "light" ? "☀️" : "🌙";
  }

  function applyTheme(themeRaw) {
    const theme = THEMES.includes(themeRaw) ? themeRaw : "terminal";
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
    btn.addEventListener("click", toggleTheme);
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
    const next = (cur ? `${cur}\n` : "") + `[${ts}] ${line}`;
    const lines = next.split("\n").slice(-160);
    pre.textContent = `${lines.join("\n")}\n`;
    pre.scrollTop = pre.scrollHeight;
  }

  function curlFor(path) {
    return `curl -fsS '${window.location.origin}${path}'`;
  }

  async function hit(path, opts = {}) {
    const method = opts.method || "GET";
    appendEvent(`REQUEST ${method} ${path}`);
    try {
      const r = await fetch(path, { method, cache: "no-store" });
      const txt = await r.text();
      appendEvent(`RESPONSE ${r.status} ${txt.trim().slice(0, 250)}`);
      return { ok: r.ok, status: r.status, body: txt };
    } catch (e) {
      appendEvent(`ERROR ${String(e)}`);
      return { ok: false, status: 0, body: "" };
    }
  }

  async function fetchJson(path) {
    const r = await fetch(path, { cache: "no-store" });
    const txt = await r.text();
    try {
      return { ok: r.ok, status: r.status, json: JSON.parse(txt) };
    } catch {
      return { ok: false, status: r.status, json: { ok: false, error: "bad json", raw: txt.slice(0, 500) } };
    }
  }

  function fmtAlerts(payload) {
    if (!payload || !payload.ok) return `error: ${payload?.error || "unknown"}`;
    const alerts = payload.alerts || [];
    const active = alerts.filter((a) => a.status === "active").length;
    const suppressed = alerts.filter((a) => a.status === "suppressed").length;
    const unprocessed = alerts.filter((a) => a.status === "unprocessed").length;

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
    const entries = payload.entries || [];
    const byEvent = payload.summary?.by_event ? JSON.stringify(payload.summary.by_event) : "{}";
    const head = `count=${payload.count ?? entries.length} events=${byEvent}`;
    const lines = entries.map(summarizeLogEntry);
    return [head, "", ...lines].join("\n");
  }

  function setAutoBtn(btn, on) {
    if (!btn) return;
    btn.textContent = on ? "auto: on" : "auto: off";
    btn.classList.toggle("primary", on);
  }

  function setLogsModeBtns() {
    const btnButtons = $("#btn-logs-buttons");
    if (btnButtons) btnButtons.classList.toggle("primary", state.logsMode === "buttons");
  }

  function updateObsSummary(payloadAlerts, payloadLogs) {
    const alertCount = $("#obs-alert-count");
    const alertMeta = $("#obs-alert-meta");
    const logCount = $("#obs-log-count");
    const logMeta = $("#obs-log-meta");

    if (payloadAlerts?.ok) {
      const alerts = payloadAlerts.alerts || [];
      const active = alerts.filter((a) => a.status === "active").length;
      const suppressed = alerts.filter((a) => a.status === "suppressed").length;
      const unprocessed = alerts.filter((a) => a.status === "unprocessed").length;

      if (alertCount) alertCount.textContent = String(alerts.length);
      if (alertMeta) alertMeta.textContent = `active=${active} suppressed=${suppressed} unprocessed=${unprocessed}`;
    }

    if (payloadLogs?.ok) {
      const count = payloadLogs.count ?? 0;
      const events = payloadLogs.summary?.by_event ? JSON.stringify(payloadLogs.summary.by_event) : "{}";
      if (logCount) logCount.textContent = String(count);
      if (logMeta) logMeta.textContent = `events=${events}`;
    }
  }

  function getScenarioSettings() {
    const slowPrimary = $("#slow-ms");
    const slowSecondary = $("#slow-ms-settings");
    const burstCountInput = $("#burst-count");
    const burstIntervalInput = $("#burst-interval");

    const slowMs = Number((slowSecondary?.value || slowPrimary?.value || "1200").trim());
    const burstCount = Number((burstCountInput?.value || "18").trim());
    const burstIntervalMs = Number((burstIntervalInput?.value || "350").trim());

    return {
      slowMs: Number.isFinite(slowMs) ? Math.max(0, Math.min(30000, slowMs)) : 1200,
      burstCount: Number.isFinite(burstCount) ? Math.max(1, Math.min(200, burstCount)) : 18,
      burstIntervalMs: Number.isFinite(burstIntervalMs) ? Math.max(50, Math.min(5000, burstIntervalMs)) : 350,
    };
  }

  function syncSlowInputs(sourceId) {
    const a = $("#slow-ms");
    const b = $("#slow-ms-settings");
    if (!a || !b) return;
    if (sourceId === "slow-ms") {
      b.value = a.value;
    } else if (sourceId === "slow-ms-settings") {
      a.value = b.value;
    }
  }

  function scenarioExpectations(kind) {
    if (kind === "5xx") {
      return { labels: [ALERT_NAME_ERROR], fast: ALERT_NAME_ERROR, slow: null };
    }
    if (kind === "slow") {
      return { labels: [ALERT_NAME_SLOW], fast: ALERT_NAME_SLOW, slow: null };
    }
    if (kind === "combined") {
      return { labels: [ALERT_NAME_ERROR, ALERT_NAME_SLOW], fast: ALERT_NAME_ERROR, slow: ALERT_NAME_SLOW };
    }
    return { labels: [], fast: null, slow: null };
  }

  function resetScenarioState(kind = null) {
    clearTimeout(state.scenario.timeoutTimer);
    state.scenario.running = false;
    state.scenario.cancelled = false;
    state.scenario.kind = kind;
    state.scenario.startedAtMs = null;
    state.scenario.finishedAtMs = null;
    state.scenario.sent = 0;
    state.scenario.errors = 0;
    state.scenario.slow = 0;
    state.scenario.detectedAlerts = new Set();
    state.scenario.timeoutTimer = null;
    state.scenario.phase = "idle";
  }

  function setScenarioStatusVisual(level, title, subtitle, alertState) {
    const pill = $("#scenario-pill");
    const titleNode = $("#scenario-title");
    const subtitleNode = $("#scenario-subtitle");
    const alertStateNode = $("#scenario-alert-state");

    if (pill) {
      pill.textContent = level.toUpperCase();
      pill.style.borderColor = "var(--border)";
      pill.style.background = "color-mix(in srgb, var(--panel) 92%, transparent)";
      pill.style.color = "var(--text)";

      if (level === "ok") {
        pill.style.borderColor = "color-mix(in srgb, var(--ok) 35%, var(--border))";
        pill.style.background = "color-mix(in srgb, var(--ok) 10%, var(--panel))";
      } else if (level === "warning") {
        pill.style.borderColor = "color-mix(in srgb, var(--warn) 40%, var(--border))";
        pill.style.background = "color-mix(in srgb, var(--warn) 10%, var(--panel))";
      } else if (level === "info") {
        pill.style.borderColor = "color-mix(in srgb, #4c8bf5 40%, var(--border))";
        pill.style.background = "color-mix(in srgb, #4c8bf5 10%, var(--panel))";
      } else if (level === "running") {
        pill.style.borderColor = "color-mix(in srgb, var(--primary) 40%, var(--border))";
        pill.style.background = "color-mix(in srgb, var(--primary) 10%, var(--panel))";
      }
    }

    if (titleNode) titleNode.textContent = title;
    if (subtitleNode) subtitleNode.textContent = subtitle;
    if (alertStateNode) alertStateNode.textContent = alertState;
  }

  function updateScenarioSummary() {
    const sent = $("#scenario-sent");
    const errors = $("#scenario-errors");
    const slow = $("#scenario-slow");

    if (sent) sent.textContent = String(state.scenario.sent);
    if (errors) errors.textContent = String(state.scenario.errors);
    if (slow) slow.textContent = String(state.scenario.slow);

    const kind = state.scenario.kind;
    const detected = Array.from(state.scenario.detectedAlerts);
    const expectations = scenarioExpectations(kind);

    if (!kind || state.scenario.phase === "idle") {
      setScenarioStatusVisual(
        "idle",
        "Pick a scenario to generate alert-friendly traffic.",
        "Fast demo alerts should appear first. Longer demo alerts depend on sustained Prometheus rule windows.",
        "idle",
      );
      return;
    }

    if (state.scenario.phase === "running") {
      const label = kind === "5xx" ? "5xx" : kind === "slow" ? "latency" : "combined";
      setScenarioStatusVisual(
        "running",
        `Running ${label} demo traffic.`,
        "Requests are being sent now. Alerts and logs will update automatically.",
        "running",
      );
      return;
    }

    if (state.scenario.phase === "waiting") {
      if (kind === "5xx") {
        setScenarioStatusVisual(
          "info",
          "Waiting for demo 5xx alert detection.",
          "Traffic finished. Alertmanager may need a short evaluation delay before the alert becomes visible.",
          detected.length > 0 ? `detected:${detected.join(",")}` : "watching",
        );
        return;
      }

      if (kind === "slow") {
        setScenarioStatusVisual(
          "info",
          "Waiting for demo latency alert detection.",
          "Slow requests were sent. Prometheus may still be evaluating the latency demo alert.",
          detected.length > 0 ? `detected:${detected.join(",")}` : "watching",
        );
        return;
      }

      setScenarioStatusVisual(
        "info",
        "Waiting for combined demo alerts.",
        "Combined traffic finished. Fast alert should appear first, then the slower latency-oriented demo alert if the rule window is satisfied.",
        detected.length > 0 ? `detected:${detected.join(",")}` : "watching",
      );
      return;
    }

    if (state.scenario.phase === "detected") {
      if (kind === "combined") {
        const hasFast = detected.includes(expectations.fast);
        const hasSlow = detected.includes(expectations.slow);
        if (hasFast && hasSlow) {
          setScenarioStatusVisual(
            "ok",
            "Combined demo alerts detected.",
            "Both demo alerts are visible in Alertmanager.",
            `detected:${detected.join(",")}`,
          );
          return;
        }
        if (hasFast) {
          setScenarioStatusVisual(
            "info",
            "Fast demo alert detected. Waiting for the longer demo alert window.",
            "The traffic worked. Prometheus still needs more evaluation time for the longer demo rule.",
            `detected:${detected.join(",")}`,
          );
          return;
        }
      }

      setScenarioStatusVisual(
        "ok",
        "Demo alert detected.",
        "The scenario reached Alertmanager successfully.",
        `detected:${detected.join(",")}`,
      );
      return;
    }

    if (state.scenario.phase === "timeout") {
      if (kind === "combined" && detected.includes(expectations.fast) && !detected.includes(expectations.slow)) {
        setScenarioStatusVisual(
          "warning",
          "Fast demo alert was detected, but the longer demo alert is not visible yet.",
          "The scenario succeeded, but the longer rule still needs more time or lighter thresholds.",
          "partial-timeout",
        );
        return;
      }

      setScenarioStatusVisual(
        "warning",
        "Scenario finished, but no matching demo alert is visible yet.",
        "Refresh alerts and check Prometheus evaluation timing or rule thresholds.",
        "timeout",
      );
    }
  }

  function scenarioIsSatisfied(kind, alertsPayload) {
    if (!alertsPayload?.ok) return false;

    const names = new Set(
      (alertsPayload.alerts || [])
        .filter((a) => a.status === "active")
        .map((a) => String(a.alertname || "").trim())
        .filter(Boolean),
    );

    const expectations = scenarioExpectations(kind);
    expectations.labels.forEach((name) => {
      if (names.has(name)) state.scenario.detectedAlerts.add(name);
    });

    if (kind === "combined") {
      return expectations.labels.every((name) => state.scenario.detectedAlerts.has(name));
    }

    return expectations.labels.some((name) => state.scenario.detectedAlerts.has(name));
  }

  function scenarioHasPartialSuccess(kind) {
    if (kind !== "combined") return false;
    return state.scenario.detectedAlerts.has(ALERT_NAME_ERROR) || state.scenario.detectedAlerts.has(ALERT_NAME_SLOW);
  }

  function finishScenarioPhase(kind, phase) {
    if (state.scenario.kind !== kind) return;
    state.scenario.running = false;
    state.scenario.finishedAtMs = Date.now();
    state.scenario.phase = phase;
    updateScenarioSummary();
  }

  async function refreshAlerts() {
    const alertsOut = $("#alerts-out");
    const r = await fetchJson("/_obs/alerts");
    state.latestAlertsPayload = r.json;
    if (alertsOut) alertsOut.textContent = fmtAlerts(r.json);
    updateObsSummary(state.latestAlertsPayload, state.latestLogsPayload);
    appendEvent(`OBS alerts refresh -> ${r.ok ? "ok" : "err"} (${r.status})`);

    if (state.scenario.kind && (state.scenario.phase === "waiting" || state.scenario.phase === "detected")) {
      const satisfied = scenarioIsSatisfied(state.scenario.kind, r.json);
      if (satisfied) {
        clearTimeout(state.scenario.timeoutTimer);
        state.scenario.phase = "detected";
        updateScenarioSummary();
      } else if (scenarioHasPartialSuccess(state.scenario.kind)) {
        state.scenario.phase = "detected";
        updateScenarioSummary();
      }
    }
  }

  async function refreshLogs() {
    const logsOut = $("#logs-out");
    const r = await fetchJson(`/_obs/logs?mode=${encodeURIComponent(state.logsMode)}&limit=80`);
    state.latestLogsPayload = r.json;
    if (logsOut) logsOut.textContent = fmtLogs(r.json);
    updateObsSummary(state.latestAlertsPayload, state.latestLogsPayload);
    appendEvent(`OBS logs refresh -> ${r.ok ? "ok" : "err"} (${r.status})`);
  }

  function startAlertsAutoLoop() {
    if (state.alertsTimer) clearInterval(state.alertsTimer);
    state.alertsTimer = state.alertsAuto ? setInterval(refreshAlerts, ALERTS_AUTO_INTERVAL_MS) : null;
  }

  function startLogsAutoLoop() {
    if (state.logsTimer) clearInterval(state.logsTimer);
    state.logsTimer = state.logsAuto ? setInterval(refreshLogs, LOGS_AUTO_INTERVAL_MS) : null;
  }

  async function runSingle503() {
    const r = await hit("/error?code=503");
    if (r.status === 429) toast("rate limited");
    return r;
  }

  async function runSingleSlow() {
    const { slowMs } = getScenarioSettings();
    const r = await hit(`/slow?ms=${encodeURIComponent(String(slowMs))}`);
    if (r.status === 429) toast("rate limited");
    return r;
  }

  async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setScenarioButtonsDisabled(disabled) {
    const ids = [
      "btn-503",
      "btn-slow-scenario",
      "btn-combined",
      "btn-single-slow",
      "btn-single-503",
    ];
    ids.forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.disabled = disabled;
    });
    const stop = $("#btn-stop");
    if (stop) stop.disabled = !disabled;
  }

  async function runScenario(kind) {
    if (state.scenario.running) {
      toast("scenario already running");
      return;
    }

    const { burstCount, burstIntervalMs } = getScenarioSettings();

    resetScenarioState(kind);
    state.scenario.running = true;
    state.scenario.phase = "running";
    state.scenario.startedAtMs = Date.now();
    setScenarioButtonsDisabled(true);
    updateScenarioSummary();

    appendEvent(`SCENARIO start kind=${kind} count=${burstCount} interval_ms=${burstIntervalMs}`);

    try {
      for (let i = 1; i <= burstCount; i += 1) {
        if (state.scenario.cancelled) {
          appendEvent(`SCENARIO cancelled kind=${kind} after=${state.scenario.sent}`);
          finishScenarioPhase(kind, "idle");
          return;
        }

        let r;
        if (kind === "5xx") {
          r = await hit("/error?code=503");
          state.scenario.sent += 1;
          if (r.status === 503) state.scenario.errors += 1;
          appendEvent(`SCENARIO 503 #${i} -> ${r.status}`);
        } else if (kind === "slow") {
          const { slowMs } = getScenarioSettings();
          r = await hit(`/slow?ms=${encodeURIComponent(String(slowMs))}`);
          state.scenario.sent += 1;
          if (r.ok) state.scenario.slow += 1;
          appendEvent(`SCENARIO slow #${i} -> ${r.status} (${slowMs}ms)`);
        } else {
          const { slowMs } = getScenarioSettings();
          if (i % 2 === 1) {
            r = await hit("/error?code=503");
            state.scenario.sent += 1;
            if (r.status === 503) state.scenario.errors += 1;
            appendEvent(`SCENARIO combined error #${i} -> ${r.status}`);
          } else {
            r = await hit(`/slow?ms=${encodeURIComponent(String(slowMs))}`);
            state.scenario.sent += 1;
            if (r.ok) state.scenario.slow += 1;
            appendEvent(`SCENARIO combined slow #${i} -> ${r.status} (${slowMs}ms)`);
          }
        }

        updateScenarioSummary();

        if (i < burstCount) {
          await delay(burstIntervalMs);
        }
      }

      appendEvent(
        `SCENARIO end kind=${kind} sent=${state.scenario.sent} errors=${state.scenario.errors} slow=${state.scenario.slow}`,
      );

      finishScenarioPhase(kind, "waiting");

      state.scenario.timeoutTimer = setTimeout(() => {
        if (state.scenario.kind !== kind) return;
        if (state.scenario.phase === "detected" && scenarioHasPartialSuccess(kind)) {
          state.scenario.phase = "timeout";
          updateScenarioSummary();
          return;
        }
        if (state.scenario.phase !== "detected") {
          state.scenario.phase = "timeout";
          updateScenarioSummary();
        }
      }, SCENARIO_TIMEOUT_MS);

      await refreshLogs();
      await refreshAlerts();
    } finally {
      state.scenario.running = false;
      setScenarioButtonsDisabled(false);
    }
  }

  function stopScenario() {
    if (!state.scenario.kind && !state.scenario.running) {
      resetScenarioState(null);
      updateScenarioSummary();
      return;
    }

    state.scenario.cancelled = true;
    clearTimeout(state.scenario.timeoutTimer);
    if (!state.scenario.running) {
      resetScenarioState(null);
      updateScenarioSummary();
      setScenarioButtonsDisabled(false);
      appendEvent("SCENARIO stop");
    }
  }

  function wireQuickActions() {
    const btn503 = $("#btn-503");
    const btnSlowScenario = $("#btn-slow-scenario");
    const btnCombined = $("#btn-combined");
    const btnStop = $("#btn-stop");

    const btnSingleSlow = $("#btn-single-slow");
    const btnSingle503 = $("#btn-single-503");
    const btnMetrics = $("#btn-metrics");
    const btnCopy = $("#btn-copy");

    const slowInput = $("#slow-ms");
    const slowSettingsInput = $("#slow-ms-settings");

    if (slowInput) {
      slowInput.addEventListener("input", () => syncSlowInputs("slow-ms"));
      slowInput.addEventListener("change", () => syncSlowInputs("slow-ms"));
    }

    if (slowSettingsInput) {
      slowSettingsInput.addEventListener("input", () => syncSlowInputs("slow-ms-settings"));
      slowSettingsInput.addEventListener("change", () => syncSlowInputs("slow-ms-settings"));
    }

    if (btn503) {
      btn503.addEventListener("click", async () => {
        flashBtn(btn503);
        await runScenario("5xx");
      });
    }

    if (btnSlowScenario) {
      btnSlowScenario.addEventListener("click", async () => {
        flashBtn(btnSlowScenario);
        await runScenario("slow");
      });
    }

    if (btnCombined) {
      btnCombined.addEventListener("click", async () => {
        flashBtn(btnCombined);
        await runScenario("combined");
      });
    }

    if (btnStop) {
      btnStop.addEventListener("click", () => {
        flashBtn(btnStop);
        stopScenario();
      });
    }

    if (btnSingleSlow) {
      btnSingleSlow.addEventListener("click", async () => {
        flashBtn(btnSingleSlow);
        await runSingleSlow();
        await refreshLogs();
        await refreshAlerts();
      });
    }

    if (btnSingle503) {
      btnSingle503.addEventListener("click", async () => {
        flashBtn(btnSingle503);
        await runSingle503();
        await refreshLogs();
        await refreshAlerts();
      });
    }

    if (btnMetrics) {
      btnMetrics.addEventListener("click", () => {
        flashBtn(btnMetrics);
        window.open("/metrics", "_blank", "noopener,noreferrer");
        appendEvent("OPEN /metrics (new tab)");
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        flashBtn(btnCopy);
        const { slowMs } = getScenarioSettings();
        const script = [
          curlFor("/healthz"),
          curlFor("/metrics"),
          curlFor(`/slow?ms=${slowMs}`),
          curlFor("/error?code=503"),
          curlFor("/_obs/alerts"),
          curlFor("/_obs/logs?mode=buttons&limit=20"),
        ].join("\n") + "\n";
        await navigator.clipboard.writeText(script);
        toast("copied curl script");
      });
    }

    setScenarioButtonsDisabled(false);
  }

  function hotkeys() {
    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "t" || e.key === "T") toggleTheme();
    });
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

  async function refreshStatusLoop() {
    setTime();
    setStatus(await pingHealthz());
    setInterval(async () => {
      setTime();
      setStatus(await pingHealthz());
    }, STATUS_REFRESH_INTERVAL_MS);
  }

  function initFromDom() {
    const appName = document.documentElement.getAttribute("data-app") || $("#app-name")?.textContent || null;
    const env = document.documentElement.getAttribute("data-env") || null;
    if (appName && $("#pl-app")) $("#pl-app").textContent = appName;
    if (env && $("#pl-env")) $("#pl-env").textContent = env;
  }

  function wireObs() {
    const btnAlerts = $("#btn-alerts");
    const btnAlertsAuto = $("#btn-alerts-auto");
    const btnLogsButtons = $("#btn-logs-buttons");
    const btnLogs = $("#btn-logs");
    const btnLogsAuto = $("#btn-logs-auto");

    if (btnAlerts) {
      btnAlerts.addEventListener("click", async () => {
        flashBtn(btnAlerts);
        await refreshAlerts();
      });
    }

    if (btnAlertsAuto) {
      btnAlertsAuto.addEventListener("click", async () => {
        flashBtn(btnAlertsAuto);
        state.alertsAuto = !state.alertsAuto;
        setAutoBtn(btnAlertsAuto, state.alertsAuto);
        startAlertsAutoLoop();
        if (state.alertsAuto) await refreshAlerts();
      });
    }

    if (btnLogsButtons) {
      btnLogsButtons.addEventListener("click", async () => {
        flashBtn(btnLogsButtons);
        state.logsMode = "buttons";
        setLogsModeBtns();
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
        state.logsAuto = !state.logsAuto;
        setAutoBtn(btnLogsAuto, state.logsAuto);
        startLogsAutoLoop();
        if (state.logsAuto) await refreshLogs();
      });
    }

    setLogsModeBtns();
    setAutoBtn(btnAlertsAuto, state.alertsAuto);
    setAutoBtn(btnLogsAuto, state.logsAuto);

    startAlertsAutoLoop();
    startLogsAutoLoop();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    ensurePowerlineAndTheme();

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || "terminal");

    initFromDom();
    hotkeys();
    wireQuickActions();
    wireObs();
    resetScenarioState(null);
    updateScenarioSummary();

    await refreshStatusLoop();
    await refreshAlerts();
    await refreshLogs();

    appendEvent("ready");
  });
})();
