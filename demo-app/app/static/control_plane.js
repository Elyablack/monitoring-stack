(function () {
  const THEME_KEY = "demoapp_theme";
  const themes = ["terminal", "light"];
  const REFRESH_INTERVAL_MS = 30000;
  const VALID_WINDOWS = ["1h", "6h", "24h"];

  const state = {
    window: "24h",
    auto: true,
    timers: {
      refresh: null,
      clock: null,
      status: null,
    },
  };

  function $(sel) {
    return document.querySelector(sel);
  }

  function $all(sel) {
    return Array.from(document.querySelectorAll(sel));
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

  function flashBtn(btn) {
    if (!btn) return;
    btn.classList.add("flash");
    clearTimeout(btn._flashT);
    btn._flashT = setTimeout(() => btn.classList.remove("flash"), 160);
  }

  function themeIcon(theme) {
    return theme === "light" ? "☀️" : "🌙";
  }

  function applyTheme(themeValue) {
    const theme = themes.includes(themeValue) ? themeValue : "terminal";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);

    const icon = $("#pl-theme-icon");
    if (icon) icon.textContent = themeIcon(theme);

    const btn = $("#pl-theme-btn");
    if (btn) btn.setAttribute("aria-label", `Theme: ${theme}. Click to toggle.`);
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "terminal";
    applyTheme(cur === "terminal" ? "light" : "terminal");
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

  function ensurePowerline() {
    let pl = $(".powerline");
    if (!pl) {
      const top = $(".topbar") || document.body;
      pl = el("div", "powerline");
      top.appendChild(pl);
    }

    function seg(id, html) {
      const s = el("div", "seg");
      s.id = id;
      s.innerHTML = html;
      return s;
    }

    if (!$("#pl-seg-app")) {
      pl.appendChild(seg("pl-seg-app", `<span class="k">app</span><span class="v" id="pl-app">demo-app</span>`));
      pl.appendChild(seg("pl-seg-env", `<span class="k">env</span><span class="v" id="pl-env">prod</span>`));
      pl.appendChild(seg("pl-seg-status", `<span class="dot" id="pl-dot"></span><span class="k">runner</span><span class="v" id="pl-status">?</span>`));
      pl.appendChild(seg("pl-seg-time", `<span class="k">time</span><span class="v" id="pl-time">--:--:--</span>`));
    }

    if (!$("#pl-theme-btn")) ensureThemeButton(pl);
  }

  function initFromDom() {
    const appName = document.documentElement.getAttribute("data-app") || null;
    const env = document.documentElement.getAttribute("data-env") || null;
    if (appName && $("#pl-app")) $("#pl-app").textContent = appName;
    if (env && $("#pl-env")) $("#pl-env").textContent = env;
  }

  function setClock() {
    const node = $("#pl-time");
    if (!node) return;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    node.textContent = `${hh}:${mm}:${ss}`;
  }

  async function pingRunner() {
    try {
      const r = await fetch("/api/control-plane/healthz", { cache: "no-store" });
      const txt = await r.text();
      let json = {};
      try {
        json = JSON.parse(txt);
      } catch {
        json = {};
      }
      return { ok: r.ok, json };
    } catch {
      return { ok: false, json: {} };
    }
  }

  function setRunnerStatus(ok) {
    const dot = $("#pl-dot");
    const seg = $("#pl-seg-status");
    const val = $("#pl-status");
    if (!dot || !seg || !val) return;

    dot.classList.remove("ok", "warn", "bad");
    seg.classList.remove("ok", "warn", "bad");

    if (ok) {
      dot.classList.add("ok");
      seg.classList.add("ok");
      val.textContent = "OK";
    } else {
      dot.classList.add("bad");
      seg.classList.add("bad");
      val.textContent = "DOWN";
    }
  }

  async function refreshRunnerStatus() {
    const res = await pingRunner();
    setRunnerStatus(Boolean(res.ok && res.json?.ok));
  }

  function hotkeys() {
    window.addEventListener("keydown", (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "t" || e.key === "T") toggleTheme();
    });
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

  function clampWindow(raw) {
    return VALID_WINDOWS.includes(raw) ? raw : "24h";
  }

  function setWindow(windowValue) {
    state.window = clampWindow(windowValue);
    $all(".btn-window").forEach((btn) => {
      btn.classList.toggle("primary", btn.dataset.window === state.window);
    });
  }

  function formatAge(age) {
    if (age === null || age === undefined || age === "") return "unknown";
    const n = Number(age);
    if (!Number.isFinite(n)) return "unknown";
    if (n < 60) return `${n}s ago`;
    if (n < 3600) return `${Math.floor(n / 60)}m ago`;
    if (n < 86400) return `${Math.floor(n / 3600)}h ago`;
    return `${Math.floor(n / 86400)}d ago`;
  }

  function safeText(value, fallback = "—") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
  }

  function formatCounts(counts) {
    const parts = Object.entries(counts || {});
    if (!parts.length) return "—";
    return parts
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
  }

  function renderSummaryMessage(levelLabel, message, sub, level) {
    const wrap = el("div", "cp-summary-message");
    const pill = el("div", `cp-summary-pill ${level}`, levelLabel);
    const textWrap = el("div", "cp-summary-message-text");
    const title = el("div", "cp-summary-message-title", message);
    const subtitle = el("div", "cp-summary-message-sub", sub);
    textWrap.appendChild(title);
    textWrap.appendChild(subtitle);
    wrap.appendChild(pill);
    wrap.appendChild(textWrap);
    return wrap;
  }

  function renderStatBox(label, value) {
    const box = el("div", "cp-summary-box");
    box.appendChild(el("div", "cp-summary-box-label", label));
    box.appendChild(el("div", "cp-summary-box-value", value));
    return box;
  }

  function renderMetaBox(title, lines) {
    const box = el("div", "cp-summary-meta-box");
    box.appendChild(el("div", "cp-summary-meta-title", title));
    const body = el("div", "cp-summary-meta-body");
    lines.forEach((line) => body.appendChild(el("div", "cp-summary-line", line)));
    box.appendChild(body);
    return box;
  }

  function renderLastBox(title, payload, fields) {
    const box = el("div", "cp-summary-last-box");
    box.appendChild(el("div", "cp-summary-last-title", title));

    const body = el("div", "cp-summary-last-body");
    if (!payload) {
      body.appendChild(el("div", "cp-summary-line", "—"));
      box.appendChild(body);
      return box;
    }

    fields.forEach(([label, key]) => {
      let value = payload[key];
      if (key.endsWith("_age_s")) value = formatAge(value);
      body.appendChild(el("div", "cp-summary-line", `${label}=${safeText(value)}`));
    });

    box.appendChild(body);
    return box;
  }

  function renderSummaryCard(payload) {
    const host = $("#summary-out");
    if (!host) return;

    if (!payload || !payload.ok) {
      host.innerHTML = "";
      host.appendChild(renderSummaryMessage("DEGRADED", "Runner summary is unavailable.", payload?.error || "Unknown error.", "degraded"));
      return;
    }

    const human = payload.human_status || {};
    const totals = payload.totals || {};
    const queue = payload.queue || {};
    const runner = payload.runner || {};
    const taskCounts = payload.task_status_counts || {};
    const runCounts = payload.run_status_counts || {};

    const totalFailures = Number(totals.failures || 0);
    const recentFailures = Number(totals.recent_failures || human.recent_failures || 0);
    const olderFailures = Math.max(0, totalFailures - recentFailures);

    const level = String(human.level || "healthy").toLowerCase();
    const levelLabel =
      level === "warning" ? "WARNING" :
      level === "degraded" ? "DEGRADED" :
      level === "idle" ? "IDLE" :
      level === "info" ? "INFO" :
      "HEALTHY";

    let lead = safeText(human.message, "No summary message.");
    let sub = `Last activity: ${safeText(human.last_activity_human, "unknown")}. Queue: ${safeText(queue.state, "unknown")}.`;

    if (level === "info" && olderFailures > 0) {
      lead = "Recent pipeline activity is healthy.";
      sub = `${olderFailures} older failure(s) remain in the selected ${payload.window} window. Last activity: ${safeText(human.last_activity_human, "unknown")}. Queue: ${safeText(queue.state, "unknown")}.`;
    }

    host.innerHTML = "";
    host.appendChild(renderSummaryMessage(levelLabel, lead, sub, level));

    const grid = el("div", "cp-summary-stats");
    grid.appendChild(renderStatBox("decisions", safeText(totals.decisions, "0")));
    grid.appendChild(renderStatBox("tasks", safeText(totals.tasks, "0")));
    grid.appendChild(renderStatBox("runs", safeText(totals.runs, "0")));
    grid.appendChild(renderStatBox("recent failures", String(recentFailures)));
    host.appendChild(grid);

    const metaGrid = el("div", "cp-summary-meta-grid");
    metaGrid.appendChild(renderMetaBox("runner", [
      `service=${safeText(runner.service, "action-runner")}`,
      `status=${safeText(runner.status, "unknown")}`,
      `rules_loaded=${safeText(runner.rules_loaded, "0")}`,
    ]));

    metaGrid.appendChild(renderMetaBox("queue + window", [
      `window=${safeText(payload.window, state.window)}`,
      `queue=${safeText(queue.state, "unknown")}`,
      `depth=${queue.depth === null || queue.depth === undefined ? "unknown" : safeText(queue.depth)}`,
    ]));

    metaGrid.appendChild(renderMetaBox("status counts", [
      `tasks: ${formatCounts(taskCounts)}`,
      `runs: ${formatCounts(runCounts)}`,
      `older_failures=${olderFailures}`,
    ]));
    host.appendChild(metaGrid);

    const footGrid = el("div", "cp-summary-foot-grid");
    footGrid.appendChild(renderLastBox("last decision", payload.last_decision, [
      ["id", "id"],
      ["type", "decision"],
      ["alert", "alertname"],
      ["severity", "severity"],
      ["when", "created_age_s"],
    ]));
    footGrid.appendChild(renderLastBox("last task", payload.last_task, [
      ["id", "id"],
      ["type", "task_type"],
      ["status", "status"],
      ["priority", "priority"],
      ["when", "created_age_s"],
    ]));
    footGrid.appendChild(renderLastBox("last run", payload.last_run, [
      ["id", "id"],
      ["action", "action"],
      ["status", "status"],
      ["trigger", "trigger_type"],
      ["when", "started_age_s"],
    ]));
    host.appendChild(footGrid);
  }

  function formatDecisionLine(item) {
    return [
      `id=${safeText(item.id)}`,
      `type=${safeText(item.decision)}`,
      `severity=${safeText(item.severity)}`,
      `alert=${safeText(item.alertname)}`,
      `when=${formatAge(item.created_age_s)}`,
    ].join("  ");
  }

  function formatTaskLine(item) {
    return [
      `id=${safeText(item.id)}`,
      `type=${safeText(item.task_type)}`,
      `status=${safeText(item.status)}`,
      `prio=${safeText(item.priority)}`,
      `decision_id=${safeText(item.decision_id, "--")}`,
      `when=${formatAge(item.created_age_s)}`,
    ].join("  ");
  }

  function formatRunLine(item) {
    return [
      `id=${safeText(item.id)}`,
      `action=${safeText(item.action)}`,
      `status=${safeText(item.status)}`,
      `trigger=${safeText(item.trigger_type)}`,
      `when=${formatAge(item.started_age_s)}`,
    ].join("  ");
  }

  function renderList(preId, items, emptyText, formatter) {
    const pre = $(preId);
    if (!pre) return;
    if (!Array.isArray(items) || !items.length) {
      pre.textContent = emptyText;
      return;
    }
    pre.textContent = items.map(formatter).join("\n");
  }

  function renderOutcomes(summaryPayload, tasksPayload, runsPayload) {
    const pre = $("#outcomes-out");
    if (!pre) return;

    if (!summaryPayload?.ok) {
      pre.textContent = "summary unavailable";
      return;
    }

    const totalFailures = Number(summaryPayload?.totals?.failures || 0);
    const recentFailures = Number(summaryPayload?.totals?.recent_failures || summaryPayload?.human_status?.recent_failures || 0);
    const olderFailures = Math.max(0, totalFailures - recentFailures);
    const lines = [];

    lines.push(`level=${safeText(summaryPayload?.human_status?.level, "unknown")}`);
    lines.push(`message=${safeText(summaryPayload?.human_status?.message, "unknown")}`);
    lines.push(`recent_failures=${recentFailures}`);
    lines.push(`older_failures=${olderFailures}`);
    lines.push(`queue_state=${safeText(summaryPayload?.queue?.state, "unknown")}`);
    lines.push(`queue_depth=${summaryPayload?.queue?.depth === null || summaryPayload?.queue?.depth === undefined ? "unknown" : safeText(summaryPayload.queue.depth)}`);

    const failedTasks = (tasksPayload?.tasks || []).filter((item) => String(item.status || "").toLowerCase() === "failed");
    const failedRuns = (runsPayload?.runs || []).filter((item) => String(item.status || "").toLowerCase() === "failed");

    if (failedTasks.length) {
      lines.push("");
      lines.push("failed_tasks:");
      failedTasks.slice(0, 5).forEach((item) => lines.push(`- ${formatTaskLine(item)}`));
    }

    if (failedRuns.length) {
      lines.push("");
      lines.push("failed_runs:");
      failedRuns.slice(0, 5).forEach((item) => lines.push(`- ${formatRunLine(item)}`));
    }

    if (!failedTasks.length && !failedRuns.length) {
      lines.push("");
      lines.push("No recent task or run failures in the selected window.");
    }

    pre.textContent = lines.join("\n");
  }

  async function refreshAll(opts = {}) {
    const silent = opts.silent === true;

    const decisionFilter = $("#decision-filter")?.value || "all";
    const taskFilter = $("#task-filter")?.value || "all";
    const runFilter = $("#run-filter")?.value || "all";

    const [summaryRes, decisionsRes, tasksRes, runsRes] = await Promise.all([
      fetchJson(`/api/control-plane/summary?window=${encodeURIComponent(state.window)}`),
      fetchJson(`/api/control-plane/decisions?window=${encodeURIComponent(state.window)}&decision_type=${encodeURIComponent(decisionFilter)}&limit=50`),
      fetchJson(`/api/control-plane/tasks?window=${encodeURIComponent(state.window)}&task_status=${encodeURIComponent(taskFilter)}&limit=50`),
      fetchJson(`/api/control-plane/runs?window=${encodeURIComponent(state.window)}&run_status=${encodeURIComponent(runFilter)}&limit=50`),
    ]);

    renderSummaryCard(summaryRes.json);
    renderList("#decisions-out", decisionsRes.json?.decisions || [], "No recent decisions in the selected window.", formatDecisionLine);
    renderList("#tasks-out", tasksRes.json?.tasks || [], "No recent tasks in the selected window.", formatTaskLine);
    renderList("#runs-out", runsRes.json?.runs || [], "No recent runs in the selected window.", formatRunLine);
    renderOutcomes(summaryRes.json, tasksRes.json, runsRes.json);

    if (!silent) toast("refreshed");
    await refreshRunnerStatus();
  }

  function restartAutoRefresh() {
    if (state.timers.refresh) clearInterval(state.timers.refresh);
    state.timers.refresh = state.auto ? setInterval(() => refreshAll({ silent: true }), REFRESH_INTERVAL_MS) : null;
  }

  function setAutoButton(on) {
    const btn = $("#btn-auto");
    if (!btn) return;
    btn.textContent = on ? "auto: on" : "auto: off";
    btn.classList.toggle("primary", on);
  }

  function wireControls() {
    const btnRefresh = $("#btn-refresh-all");
    const btnAuto = $("#btn-auto");

    if (btnRefresh) {
      btnRefresh.addEventListener("click", async () => {
        flashBtn(btnRefresh);
        await refreshAll();
      });
    }

    if (btnAuto) {
      btnAuto.addEventListener("click", async () => {
        flashBtn(btnAuto);
        state.auto = !state.auto;
        setAutoButton(state.auto);
        restartAutoRefresh();
        if (state.auto) await refreshAll({ silent: true });
      });
    }

    $all(".btn-window").forEach((btn) => {
      btn.addEventListener("click", async () => {
        flashBtn(btn);
        setWindow(btn.dataset.window || "24h");
        await refreshAll();
      });
    });

    $("#decision-filter")?.addEventListener("change", async () => refreshAll({ silent: true }));
    $("#task-filter")?.addEventListener("change", async () => refreshAll({ silent: true }));
    $("#run-filter")?.addEventListener("change", async () => refreshAll({ silent: true }));
  }

  function injectSummaryStyles() {
    if ($("#cp-summary-inline-styles")) return;

    const style = document.createElement("style");
    style.id = "cp-summary-inline-styles";
    style.textContent = `
      .cp-summary-message {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 14px;
        align-items: start;
        margin-bottom: 18px;
      }

      .cp-summary-pill {
        min-width: 110px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--border);
        font-family: var(--mono);
        font-size: 1rem;
        font-weight: 900;
        text-align: center;
        letter-spacing: 0.04em;
      }

      .cp-summary-pill.healthy {
        border-color: color-mix(in srgb, var(--ok) 40%, var(--border));
        background: color-mix(in srgb, var(--ok) 10%, var(--panel));
      }

      .cp-summary-pill.info {
        border-color: color-mix(in srgb, #4c8bf5 40%, var(--border));
        background: color-mix(in srgb, #4c8bf5 10%, var(--panel));
      }

      .cp-summary-pill.warning {
        border-color: color-mix(in srgb, var(--warn) 50%, var(--border));
        background: color-mix(in srgb, var(--warn) 10%, var(--panel));
      }

      .cp-summary-pill.degraded {
        border-color: color-mix(in srgb, var(--danger) 50%, var(--border));
        background: color-mix(in srgb, var(--danger) 10%, var(--panel));
      }

      .cp-summary-pill.idle {
        border-color: var(--border);
        background: color-mix(in srgb, var(--panel) 90%, transparent);
      }

      .cp-summary-message-title {
        font-family: var(--mono);
        font-size: 1.08rem;
        font-weight: 800;
        line-height: 1.35;
        margin-bottom: 8px;
      }

      .cp-summary-message-sub {
        font-family: var(--mono);
        font-size: 0.98rem;
        line-height: 1.35;
        color: var(--muted);
      }

      .cp-summary-stats,
      .cp-summary-meta-grid,
      .cp-summary-foot-grid {
        display: grid;
        gap: 14px;
        margin-top: 14px;
      }

      .cp-summary-stats {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .cp-summary-meta-grid,
      .cp-summary-foot-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .cp-summary-box,
      .cp-summary-meta-box,
      .cp-summary-last-box {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 16px;
        background: color-mix(in srgb, var(--panel) 92%, transparent);
      }

      .cp-summary-box-label,
      .cp-summary-meta-title {
        font-family: var(--mono);
        font-size: 0.94rem;
        color: var(--muted);
        margin-bottom: 10px;
      }

      .cp-summary-box-value {
        font-family: var(--mono);
        font-size: 2rem;
        font-weight: 900;
        line-height: 1;
      }

      .cp-summary-last-title {
        font-family: var(--mono);
        font-size: 1rem;
        font-weight: 900;
        margin-bottom: 10px;
      }

      .cp-summary-meta-body,
      .cp-summary-last-body {
        display: grid;
        gap: 6px;
      }

      .cp-summary-line {
        font-family: var(--mono);
        font-size: 0.98rem;
        line-height: 1.35;
        word-break: break-word;
      }

      @media (max-width: 1180px) {
        .cp-summary-stats,
        .cp-summary-meta-grid,
        .cp-summary-foot-grid {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 760px) {
        .cp-summary-message {
          grid-template-columns: 1fr;
        }

        .cp-summary-stats,
        .cp-summary-meta-grid,
        .cp-summary-foot-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    ensurePowerline();
    injectSummaryStyles();

    const savedTheme = localStorage.getItem(THEME_KEY);
    applyTheme(savedTheme || "terminal");

    initFromDom();
    hotkeys();
    wireControls();
    setWindow(state.window);
    setAutoButton(state.auto);

    setClock();
    await refreshRunnerStatus();
    await refreshAll({ silent: true });

    state.timers.clock = setInterval(setClock, 1000);
    state.timers.status = setInterval(refreshRunnerStatus, 5000);
    restartAutoRefresh();
  });
})();