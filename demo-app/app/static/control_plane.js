(function () {
  const THEME_KEY = "demoapp_theme";
  const themes = ["terminal", "light"];
  const AUTO_INTERVAL_MS = 15000;

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
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
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

  function previewJson(v, maxLen = 180) {
    try {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
    } catch {
      return safeStr(v);
    }
  }

  function fmtCounts(obj) {
    const pairs = Object.entries(obj || {});
    if (!pairs.length) return "-";
    return pairs.map(([k, v]) => `${k}=${v}`).join(" ");
  }

  function fmtSummary(payload) {
    if (!payload || !payload.ok) return `error: ${payload?.error || "unknown"}`;

    const runner = payload.runner || {};
    const totals = payload.totals || {};
    const lastTask = payload.last_task || null;
    const lastDecision = payload.last_decision || null;
    const lastRun = payload.last_run || null;

    return [
      `runner.status=${safeStr(runner.status)} service=${safeStr(runner.service)} rules_loaded=${safeStr(runner.rules_loaded, "0")}`,
      `totals tasks=${safeStr(totals.tasks, "0")} decisions=${safeStr(totals.decisions, "0")} runs=${safeStr(totals.runs, "0")}`,
      `task_status_counts ${fmtCounts(payload.task_status_counts)}`,
      `run_status_counts  ${fmtCounts(payload.run_status_counts)}`,
      "",
      `last_task     id=${safeStr(lastTask?.id)} type=${safeStr(lastTask?.task_type)} status=${safeStr(lastTask?.status)} created_at=${safeStr(lastTask?.created_at)}`,
      `last_decision id=${safeStr(lastDecision?.id)} decision=${safeStr(lastDecision?.decision)} severity=${safeStr(lastDecision?.severity)} alertname=${safeStr(lastDecision?.alertname)}`,
      `last_run      id=${safeStr(lastRun?.id)} action=${safeStr(lastRun?.action)} status=${safeStr(lastRun?.status)} started_at=${safeStr(lastRun?.started_at)}`,
    ].join("\n");
  }

  function fmtTasks(payload) {
    if (!payload || !payload.ok) return `error: ${payload?.error || "unknown"}`;
    const tasks = payload.tasks || [];
    const head = `count=${payload.count ?? tasks.length}`;
    const lines = tasks.map((t) => {
      return [
        `id=${safeStr(t.id).padEnd(4)}`,
        `type=${safeStr(t.task_type).padEnd(10)}`,
        `status=${safeStr(t.status).padEnd(10)}`,
        `prio=${safeStr(t.priority).padEnd(3)}`,
        `decision_id=${safeStr(t.decision_id).padEnd(4)}`,
        `created_at=${safeStr(t.created_at)}`,
      ].join("  ");
    });
    return [head, "", ...lines].join("\n");
  }

  function fmtDecisions(payload) {
    if (!payload || !payload.ok) return `error: ${payload?.error || "unknown"}`;
    const decisions = payload.decisions || [];
    const head = `count=${payload.count ?? decisions.length}`;
    const lines = decisions.map((d) => {
      const reason = safeStr(d.reason, "").slice(0, 140);
      return [
        `id=${safeStr(d.id).padEnd(4)}`,
        `decision=${safeStr(d.decision).padEnd(16)}`,
        `severity=${safeStr(d.severity).padEnd(8)}`,
        `alert=${safeStr(d.alertname).padEnd(24)}`,
        `instance=${safeStr(d.instance).padEnd(18)}`,
        `status=${safeStr(d.status).padEnd(8)}`,
        reason ? `reason=${reason}` : "",
      ].filter(Boolean).join("  ");
    });
    return [head, "", ...lines].join("\n");
  }

  function fmtRuns(payload) {
    if (!payload || !payload.ok) return `error: ${payload?.error || "unknown"}`;
    const runs = payload.runs || [];
    const head = `count=${payload.count ?? runs.length}`;
    const lines = runs.map((r) => {
      return [
        `id=${safeStr(r.id).padEnd(4)}`,
        `action=${safeStr(r.action).padEnd(18)}`,
        `status=${safeStr(r.status).padEnd(10)}`,
        `started_at=${safeStr(r.started_at).padEnd(24)}`,
        `finished_at=${safeStr(r.finished_at).padEnd(24)}`,
        `error=${previewJson(r.error || "", 80)}`,
      ].join("  ");
    });
    return [head, "", ...lines].join("\n");
  }

  async function refreshAll() {
    const summaryOut = $("#summary-out");
    const tasksOut = $("#tasks-out");
    const decisionsOut = $("#decisions-out");
    const runsOut = $("#runs-out");

    const [summary, tasks, decisions, runs] = await Promise.all([
      fetchJson("/api/control-plane/summary"),
      fetchJson("/api/control-plane/tasks?limit=20"),
      fetchJson("/api/control-plane/decisions?limit=20"),
      fetchJson("/api/control-plane/runs?limit=20"),
    ]);

    if (summaryOut) summaryOut.textContent = fmtSummary(summary.json);
    if (tasksOut) tasksOut.textContent = fmtTasks(tasks.json);
    if (decisionsOut) decisionsOut.textContent = fmtDecisions(decisions.json);
    if (runsOut) runsOut.textContent = fmtRuns(runs.json);

    if (summary.ok && summary.json?.runner?.status) {
      setRunnerStatus(true, summary.json.runner.status);
    } else {
      setRunnerStatus(false, "error");
    }
  }

  function wireControls() {
    const btnRefreshAll = $("#btn-refresh-all");
    const btnAuto = $("#btn-auto");

    let auto = true;
    let timer = null;

    function setAutoButton() {
      if (!btnAuto) return;
      btnAuto.textContent = auto ? "auto: on" : "auto: off";
      btnAuto.classList.toggle("primary", auto);
    }

    async function startAuto() {
      if (timer) clearInterval(timer);
      timer = auto ? setInterval(refreshAll, AUTO_INTERVAL_MS) : null;
    }

    if (btnRefreshAll) {
      btnRefreshAll.addEventListener("click", async () => {
        await refreshAll();
        toast("refreshed");
      });
    }

    if (btnAuto) {
      btnAuto.addEventListener("click", async () => {
        auto = !auto;
        setAutoButton();
        await startAuto();
        if (auto) await refreshAll();
      });
    }

    setAutoButton();
    startAuto();
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

