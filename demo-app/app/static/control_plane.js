(function () {
  const THEME_KEY = "demoapp_theme";
  const themes = ["terminal", "light"];
  const AUTO_INTERVAL_MS = 15000;
  const DEFAULT_WINDOW = "24h";
  const DEFAULT_LIMIT = 20;

  const state = {
    window: DEFAULT_WINDOW,
    decisionType: "all",
    taskStatus: "all",
    runStatus: "all",
    auto: true,
    timer: null,
  };

  function $(sel) { return document.querySelector(sel); }

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

  function ensurePowerlineAndTheme() {
    let pl = $(".powerline");
    if (!pl) {
      const top = $(".topbar") || document.body;
      pl = el("div", "powerline");
      top.appendChild(pl);
    }
    if (!$("#pl-theme-btn")) ensureThemeButton(pl);
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

  function setRunnerStatus(ok, text) {
    const dot = $("#pl-dot");
    const v = $("#pl-status");
    const seg = $("#pl-seg-status");
    if (!dot || !v || !seg) return;

    dot.classList.remove("ok", "bad", "warn");
    seg.classList.remove("ok", "bad", "warn");

    if (ok) {
      dot.classList.add("ok");
      seg.classList.add("ok");
      v.textContent = String(text || "ONLINE").toUpperCase();
    } else {
      dot.classList.add("bad");
      seg.classList.add("bad");
      v.textContent = String(text || "OFFLINE").toUpperCase();
    }
  }

  function hotkeys() {
    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
      if (e.key === "t" || e.key === "T") toggleTheme();
    });
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

  function safeStr(v, fallback = "-") {
    if (v === null || v === undefined || v === "") return fallback;
    return String(v);
  }

  function fmtAge(seconds) {
    if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "unknown";
    const s = Number(seconds);
    if (s < 60) return `${Math.floor(s)}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function fmtCounts(obj) {
    const pairs = Object.entries(obj || {});
    if (!pairs.length) return "-";
    return pairs.map(([k, v]) => `${k}=${v}`).join("  ");
  }

  function setWindowButtons() {
    document.querySelectorAll(".btn-window").forEach((btn) => {
      const isActive = btn.dataset.window === state.window;
      btn.classList.toggle("primary", isActive);
    });
  }

  function buildQuery(params) {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && String(v).length > 0) {
        usp.set(k, String(v));
      }
    });
    return usp.toString();
  }

  function fmtSummary(payload) {
    if (!payload || !payload.ok) return `Runner unavailable.\n\nReason: ${payload?.error || "unknown"}`;

    const runner = payload.runner || {};
    const totals = payload.totals || {};
    const human = payload.human_status || {};
    const queue = payload.queue || {};
    const lastTask = payload.last_task || null;
    const lastDecision = payload.last_decision || null;
    const lastRun = payload.last_run || null;

    return [
      `status       ${safeStr(human.level, "unknown").toUpperCase()}  ${safeStr(human.message, "No summary available.")}`,
      `window       ${safeStr(payload.window)}   queue=${safeStr(queue.state)} depth=${safeStr(queue.depth, "unknown")}`,
      `runner       service=${safeStr(runner.service)} status=${safeStr(runner.status)} rules_loaded=${safeStr(runner.rules_loaded, "0")}`,
      `activity     last=${safeStr(human.last_activity_human)}  decisions=${safeStr(totals.decisions, "0")}  tasks=${safeStr(totals.tasks, "0")}  runs=${safeStr(totals.runs, "0")}  failures=${safeStr(totals.failures, "0")}`,
      `task_status  ${fmtCounts(payload.task_status_counts)}`,
      `run_status   ${fmtCounts(payload.run_status_counts)}`,
      "",
      `last decision  id=${safeStr(lastDecision?.id)}  type=${safeStr(lastDecision?.decision)}  severity=${safeStr(lastDecision?.severity)}  alert=${safeStr(lastDecision?.alertname)}  ${fmtAge(lastDecision?.created_age_s)}`,
      `last task      id=${safeStr(lastTask?.id)}  type=${safeStr(lastTask?.task_type)}  status=${safeStr(lastTask?.status)}  ${fmtAge(lastTask?.created_age_s)}`,
      `last run       id=${safeStr(lastRun?.id)}  action=${safeStr(lastRun?.action)}  status=${safeStr(lastRun?.status)}  ${fmtAge(lastRun?.started_age_s)}`,
    ].join("\n");
  }

  function fmtEmpty(message) {
    return message;
  }

  function fmtDecisions(payload) {
    if (!payload || !payload.ok) return `Runner unavailable.\n\nReason: ${payload?.error || "unknown"}`;
    const decisions = payload.decisions || [];
    if (!decisions.length) return fmtEmpty("No recent decisions in the selected window.");

    const head = `window=${safeStr(payload.window)}  filter=${safeStr(payload.decision_type)}  count=${safeStr(payload.count, decisions.length)}`;
    const lines = decisions.map((d) => {
      const reason = safeStr(d.reason, "");
      return [
        `id=${safeStr(d.id).padEnd(4)}`,
        `decision=${safeStr(d.decision).padEnd(14)}`,
        `severity=${safeStr(d.severity).padEnd(8)}`,
        `alert=${safeStr(d.alertname).padEnd(18)}`,
        `${fmtAge(d.created_age_s).padEnd(10)}`,
        reason ? `reason=${reason}` : "",
      ].filter(Boolean).join("  ");
    });
    return [head, "", ...lines].join("\n");
  }

  function fmtTasks(payload) {
    if (!payload || !payload.ok) return `Runner unavailable.\n\nReason: ${payload?.error || "unknown"}`;
    const tasks = payload.tasks || [];
    if (!tasks.length) return fmtEmpty("No recent tasks in the selected window.");

    const head = `window=${safeStr(payload.window)}  filter=${safeStr(payload.task_status)}  count=${safeStr(payload.count, tasks.length)}`;
    const lines = tasks.map((t) => {
      const flags = [
        t.has_error ? "error" : null,
        t.has_result ? "result" : null,
      ].filter(Boolean).join(",");
      return [
        `id=${safeStr(t.id).padEnd(4)}`,
        `type=${safeStr(t.task_type).padEnd(10)}`,
        `status=${safeStr(t.status).padEnd(10)}`,
        `prio=${safeStr(t.priority).padEnd(3)}`,
        `decision=${safeStr(t.decision_id).padEnd(4)}`,
        `${fmtAge(t.created_age_s).padEnd(10)}`,
        flags ? `flags=${flags}` : "",
      ].filter(Boolean).join("  ");
    });
    return [head, "", ...lines].join("\n");
  }

  function fmtRuns(payload) {
    if (!payload || !payload.ok) return `Runner unavailable.\n\nReason: ${payload?.error || "unknown"}`;
    const runs = payload.runs || [];
    if (!runs.length) return fmtEmpty("No recent runs in the selected window.");

    const head = `window=${safeStr(payload.window)}  filter=${safeStr(payload.run_status)}  count=${safeStr(payload.count, runs.length)}`;
    const lines = runs.map((r) => {
      return [
        `id=${safeStr(r.id).padEnd(4)}`,
        `action=${safeStr(r.action).padEnd(20)}`,
        `status=${safeStr(r.status).padEnd(10)}`,
        `trigger=${safeStr(r.trigger_type).padEnd(8)}`,
        `${fmtAge(r.started_age_s).padEnd(10)}`,
        r.has_error ? "error=yes" : "",
      ].filter(Boolean).join("  ");
    });
    return [head, "", ...lines].join("\n");
  }

  function fmtOutcomes(summary, tasksPayload, runsPayload) {
    if (!summary || !summary.ok) return "Outcomes unavailable while runner is unreachable.";

    const totals = summary.totals || {};
    const taskCounts = summary.task_status_counts || {};
    const runCounts = summary.run_status_counts || {};
    const failedTasks = Number(taskCounts.failed || 0);
    const failedRuns = Number(runCounts.failed || 0);
    const totalFailures = Number(totals.failures || 0);

    let headline = "Pipeline healthy.";
    if (totalFailures > 0) headline = `Failures detected: ${totalFailures}.`;
    else if ((tasksPayload?.count || 0) === 0 && (runsPayload?.count || 0) === 0) headline = "No recent task or run activity in the selected window.";

    return [
      headline,
      "",
      `failed tasks: ${failedTasks}`,
      `failed runs:  ${failedRuns}`,
      `queue state:  ${safeStr(summary.queue?.state)}`,
      `last activity: ${safeStr(summary.human_status?.last_activity_human)}`,
    ].join("\n");
  }

  async function refreshAll() {
    const summaryOut = $("#summary-out");
    const decisionsOut = $("#decisions-out");
    const tasksOut = $("#tasks-out");
    const runsOut = $("#runs-out");
    const outcomesOut = $("#outcomes-out");

    const summaryQuery = buildQuery({ window: state.window });
    const decisionsQuery = buildQuery({
      window: state.window,
      decision_type: state.decisionType,
      limit: DEFAULT_LIMIT,
    });
    const tasksQuery = buildQuery({
      window: state.window,
      task_status: state.taskStatus,
      limit: DEFAULT_LIMIT,
    });
    const runsQuery = buildQuery({
      window: state.window,
      run_status: state.runStatus,
      limit: DEFAULT_LIMIT,
    });

    const [summary, decisions, tasks, runs] = await Promise.all([
      fetchJson(`/api/control-plane/summary?${summaryQuery}`),
      fetchJson(`/api/control-plane/decisions?${decisionsQuery}`),
      fetchJson(`/api/control-plane/tasks?${tasksQuery}`),
      fetchJson(`/api/control-plane/runs?${runsQuery}`),
    ]);

    if (summaryOut) summaryOut.textContent = fmtSummary(summary.json);
    if (decisionsOut) decisionsOut.textContent = fmtDecisions(decisions.json);
    if (tasksOut) tasksOut.textContent = fmtTasks(tasks.json);
    if (runsOut) runsOut.textContent = fmtRuns(runs.json);
    if (outcomesOut) outcomesOut.textContent = fmtOutcomes(summary.json, tasks.json, runs.json);

    if (summary.ok && summary.json?.runner?.status) {
      setRunnerStatus(true, summary.json.runner.status);
    } else {
      setRunnerStatus(false, "error");
    }
  }

  function wireControls() {
    const btnRefreshAll = $("#btn-refresh-all");
    const btnAuto = $("#btn-auto");
    const decisionFilter = $("#decision-filter");
    const taskFilter = $("#task-filter");
    const runFilter = $("#run-filter");

    function setAutoButton() {
      if (!btnAuto) return;
      btnAuto.textContent = state.auto ? "auto: on" : "auto: off";
      btnAuto.classList.toggle("primary", state.auto);
    }

    function restartAuto() {
      if (state.timer) clearInterval(state.timer);
      state.timer = state.auto ? setInterval(refreshAll, AUTO_INTERVAL_MS) : null;
    }

    if (btnRefreshAll) {
      btnRefreshAll.addEventListener("click", async () => {
        await refreshAll();
        toast("refreshed");
      });
    }

    if (btnAuto) {
      btnAuto.addEventListener("click", async () => {
        state.auto = !state.auto;
        setAutoButton();
        restartAuto();
        if (state.auto) await refreshAll();
      });
    }

    document.querySelectorAll(".btn-window").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.window = btn.dataset.window || DEFAULT_WINDOW;
        setWindowButtons();
        await refreshAll();
      });
    });

    if (decisionFilter) {
      decisionFilter.addEventListener("change", async () => {
        state.decisionType = decisionFilter.value || "all";
        await refreshAll();
      });
    }

    if (taskFilter) {
      taskFilter.addEventListener("change", async () => {
        state.taskStatus = taskFilter.value || "all";
        await refreshAll();
      });
    }

    if (runFilter) {
      runFilter.addEventListener("change", async () => {
        state.runStatus = runFilter.value || "all";
        await refreshAll();
      });
    }

    setAutoButton();
    setWindowButtons();
    restartAuto();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    ensurePowerlineAndTheme();

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || "terminal");

    hotkeys();
    wireControls();
    setTime();
    setInterval(setTime, 1000);

    await refreshAll();
  });
})();
