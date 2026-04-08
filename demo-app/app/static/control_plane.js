(function () {
  const THEME_KEY = "demoapp_theme";
  const themes = ["terminal", "light"];
  const DEFAULT_WINDOW = "24h";
  const AUTO_INTERVAL_MS = 30000;

  let currentWindow = DEFAULT_WINDOW;
  let autoEnabled = true;
  let autoTimer = null;

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

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

    function seg(id, innerHtml) {
      const s = el("div", "seg");
      s.id = id;
      s.innerHTML = innerHtml;
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
    const appName = document.documentElement.getAttribute("data-app") || $("#app-name")?.textContent || null;
    const env = document.documentElement.getAttribute("data-env") || null;
    if (appName && $("#pl-app")) $("#pl-app").textContent = appName;
    if (env && $("#pl-env")) $("#pl-env").textContent = env;
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

  async function fetchJson(path) {
    const r = await fetch(path, { cache: "no-store" });
    const txt = await r.text();
    try {
      return { ok: r.ok, status: r.status, json: JSON.parse(txt) };
    } catch {
      return { ok: false, status: r.status, json: { ok: false, error: "bad json", raw: txt.slice(0, 500) } };
    }
  }

  function setRunnerStatus(levelText, ok) {
    const dot = $("#pl-dot");
    const v = $("#pl-status");
    const seg = $("#pl-seg-status");
    if (!dot || !v || !seg) return;

    dot.classList.remove("ok", "bad", "warn");
    seg.classList.remove("ok", "bad", "warn");

    if (ok) {
      dot.classList.add("ok");
      seg.classList.add("ok");
    } else {
      dot.classList.add("bad");
      seg.classList.add("bad");
    }
    v.textContent = levelText;
  }

  function humanAgeFromSeconds(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "unknown";
    const s = Math.max(0, Math.floor(Number(value)));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function setWindowButtons() {
    $all(".btn-window").forEach((btn) => {
      btn.classList.toggle("primary", btn.dataset.window === currentWindow);
    });
  }

  function summarizeCounts(obj) {
    const entries = Object.entries(obj || {});
    if (!entries.length) return "none";
    return entries
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
  }

  function friendlyStatus(summary) {
    const human = summary?.human_status || {};
    const totals = summary?.totals || {};
    const failures = Number(totals.failures || 0);
    const lastAge = human.last_activity_age_s;
    const hasRecentSuccess =
      (summary?.last_task && summary.last_task.status === "success") ||
      (summary?.last_run && summary.last_run.status === "success");

    if (!summary?.runner || summary.runner.status !== "ok") {
      return {
        level: "warning",
        label: "WARNING",
        message: "Runner is not healthy.",
        sub: "Check runner health and service logs.",
        powerlineOk: false,
      };
    }

    if (!totals.tasks && !totals.decisions && !totals.runs) {
      return {
        level: "idle",
        label: "IDLE",
        message: "Runner is healthy, but no recent pipeline activity was detected.",
        sub: `Window: ${summary.window}. Queue: ${summary?.queue?.state || "unknown"}.`,
        powerlineOk: true,
      };
    }

    if (failures === 0) {
      return {
        level: "ok",
        label: "OK",
        message: "Recent pipeline activity looks healthy.",
        sub: `Last activity: ${humanAgeFromSeconds(lastAge)}. Queue: ${summary?.queue?.state || "unknown"}.`,
        powerlineOk: true,
      };
    }

    const olderFailure = Number.isFinite(Number(lastAge)) && Number(lastAge) > 1800;
    if (olderFailure && hasRecentSuccess) {
      return {
        level: "info",
        label: "INFO",
        message: `Recent activity is healthy. ${failures} older failure(s) remain in the selected ${summary.window} window.`,
        sub: `Latest successful activity: ${humanAgeFromSeconds(lastAge)}. Queue: ${summary?.queue?.state || "unknown"}.`,
        powerlineOk: true,
      };
    }

    return {
      level: "warning",
      label: "WARNING",
      message: `Recent activity detected with ${failures} failure(s) in the pipeline.`,
      sub: `Last activity: ${humanAgeFromSeconds(lastAge)}. Queue: ${summary?.queue?.state || "unknown"}.`,
      powerlineOk: true,
    };
  }

  function statCard(label, value) {
    const card = el("div", "cp-stat-card");
    card.appendChild(el("div", "cp-stat-k", label));
    card.appendChild(el("div", "cp-stat-v", String(value)));
    return card;
  }

  function metaCard(title, lines) {
    const card = el("div", "cp-meta-card");
    card.appendChild(el("div", "cp-meta-title", title));
    lines.forEach((line) => card.appendChild(el("div", "cp-meta-line", line)));
    return card;
  }

  function lastCard(title, lines) {
    const card = el("div", "cp-last-card");
    card.appendChild(el("div", "cp-last-title", title));
    const body = el("div", "cp-last-body", lines.join("\n"));
    card.appendChild(body);
    return card;
  }

  function renderSummary(summary) {
    const levelEl = $("#summary-level");
    const messageEl = $("#summary-message");
    const subEl = $("#summary-sub");
    const statsEl = $("#summary-stats");
    const metaEl = $("#summary-meta");
    const lastEl = $("#summary-last");

    if (!levelEl || !messageEl || !subEl || !statsEl || !metaEl || !lastEl) return;

    if (!summary || !summary.ok) {
      levelEl.className = "cp-status-pill warning";
      levelEl.textContent = "WARNING";
      messageEl.textContent = summary?.error || "Failed to load summary.";
      subEl.textContent = "Check runner API and demo-app logs.";
      statsEl.innerHTML = "";
      metaEl.innerHTML = "";
      lastEl.innerHTML = "";
      setRunnerStatus("ERR", false);
      return;
    }

    const friendly = friendlyStatus(summary);
    levelEl.className = `cp-status-pill ${friendly.level}`;
    levelEl.textContent = friendly.label;
    messageEl.textContent = friendly.message;
    subEl.textContent = friendly.sub;
    setRunnerStatus(summary.runner.status === "ok" ? "OK" : "ERR", friendly.powerlineOk);

    statsEl.innerHTML = "";
    statsEl.appendChild(statCard("decisions", summary?.totals?.decisions ?? 0));
    statsEl.appendChild(statCard("tasks", summary?.totals?.tasks ?? 0));
    statsEl.appendChild(statCard("runs", summary?.totals?.runs ?? 0));
    statsEl.appendChild(statCard("failures", summary?.totals?.failures ?? 0));

    metaEl.innerHTML = "";
    metaEl.appendChild(
      metaCard("runner", [
        `service=${summary?.runner?.service || "unknown"}`,
        `status=${summary?.runner?.status || "unknown"}`,
        `rules_loaded=${summary?.runner?.rules_loaded ?? "unknown"}`,
      ])
    );
    metaEl.appendChild(
      metaCard("queue + window", [
        `window=${summary.window}`,
        `queue=${summary?.queue?.state || "unknown"}`,
        `depth=${summary?.queue?.depth ?? "unknown"}`,
      ])
    );
    metaEl.appendChild(
      metaCard("status counts", [
        `tasks: ${summarizeCounts(summary.task_status_counts)}`,
        `runs: ${summarizeCounts(summary.run_status_counts)}`,
      ])
    );

    const lastDecision = summary.last_decision
      ? [
          `id=${summary.last_decision.id}`,
          `type=${summary.last_decision.decision}`,
          `alert=${summary.last_decision.alertname || "-"}`,
          `severity=${summary.last_decision.severity || "-"}`,
          `when=${humanAgeFromSeconds(summary.last_decision.created_age_s)}`,
        ]
      : ["no recent decision"];

    const lastTask = summary.last_task
      ? [
          `id=${summary.last_task.id}`,
          `type=${summary.last_task.task_type}`,
          `status=${summary.last_task.status}`,
          `priority=${summary.last_task.priority}`,
          `when=${humanAgeFromSeconds(summary.last_task.finished_age_s ?? summary.last_task.created_age_s)}`,
        ]
      : ["no recent task"];

    const lastRun = summary.last_run
      ? [
          `id=${summary.last_run.id}`,
          `action=${summary.last_run.action}`,
          `status=${summary.last_run.status}`,
          `trigger=${summary.last_run.trigger_type}`,
          `when=${humanAgeFromSeconds(summary.last_run.finished_age_s ?? summary.last_run.started_age_s)}`,
        ]
      : ["no recent run"];

    lastEl.innerHTML = "";
    lastEl.appendChild(lastCard("last decision", lastDecision));
    lastEl.appendChild(lastCard("last task", lastTask));
    lastEl.appendChild(lastCard("last run", lastRun));
  }

  function fmtDecision(item) {
    return [
      `id=${item.id}  decision=${item.decision}  severity=${item.severity || "-"}  alert=${item.alertname || "-"}`,
      `status=${item.status || "-"}  action=${item.action || "-"}  when=${humanAgeFromSeconds(item.created_age_s)}`,
      `reason=${item.reason || "-"}`,
      "",
    ].join("\n");
  }

  function fmtTask(item) {
    return [
      `id=${item.id}  type=${item.task_type}  status=${item.status}  priority=${item.priority}`,
      `decision_id=${item.decision_id ?? "--"}  created=${humanAgeFromSeconds(item.created_age_s)}`,
      `started=${humanAgeFromSeconds(item.started_age_s)}  finished=${humanAgeFromSeconds(item.finished_age_s)}`,
      item.error ? `error=${item.error}` : "error=-",
      "",
    ].join("\n");
  }

  function fmtRun(item) {
    return [
      `id=${item.id}  action=${item.action}  status=${item.status}  trigger=${item.trigger_type}`,
      `started=${humanAgeFromSeconds(item.started_age_s)}  finished=${humanAgeFromSeconds(item.finished_age_s)}`,
      item.error ? `error=${item.error}` : "error=-",
      "",
    ].join("\n");
  }

  async function refreshSummary() {
    const r = await fetchJson(`/api/control-plane/summary?window=${encodeURIComponent(currentWindow)}`);
    renderSummary(r.json);
  }

  async function refreshDecisions() {
    const filter = $("#decision-filter")?.value || "all";
    const out = $("#decisions-out");
    if (!out) return;
    const r = await fetchJson(`/api/control-plane/decisions?window=${encodeURIComponent(currentWindow)}&decision_type=${encodeURIComponent(filter)}&limit=50`);
    if (!r.ok || !r.json?.ok) {
      out.textContent = r.json?.error || "failed to load decisions";
      return;
    }
    const items = r.json.decisions || [];
    out.textContent = items.length ? items.map(fmtDecision).join("\n") : "No recent decisions in the selected window.";
  }

  async function refreshTasks() {
    const filter = $("#task-filter")?.value || "all";
    const out = $("#tasks-out");
    if (!out) return;
    const r = await fetchJson(`/api/control-plane/tasks?window=${encodeURIComponent(currentWindow)}&task_status=${encodeURIComponent(filter)}&limit=50`);
    if (!r.ok || !r.json?.ok) {
      out.textContent = r.json?.error || "failed to load tasks";
      return;
    }
    const items = r.json.tasks || [];
    out.textContent = items.length ? items.map(fmtTask).join("\n") : "No recent tasks in the selected window.";
  }

  async function refreshRuns() {
    const filter = $("#run-filter")?.value || "all";
    const out = $("#runs-out");
    if (!out) return;
    const r = await fetchJson(`/api/control-plane/runs?window=${encodeURIComponent(currentWindow)}&run_status=${encodeURIComponent(filter)}&limit=50`);
    if (!r.ok || !r.json?.ok) {
      out.textContent = r.json?.error || "failed to load runs";
      return;
    }
    const items = r.json.runs || [];
    out.textContent = items.length ? items.map(fmtRun).join("\n") : "No recent runs in the selected window.";
  }

  async function refreshOutcomes() {
    const out = $("#outcomes-out");
    if (!out) return;

    const summaryResp = await fetchJson(`/api/control-plane/summary?window=${encodeURIComponent(currentWindow)}`);
    const summary = summaryResp.json;

    if (!summaryResp.ok || !summary?.ok) {
      out.textContent = summary?.error || "failed to load outcomes";
      return;
    }

    const lines = [];
    lines.push(`window=${summary.window}`);
    lines.push(`queue=${summary?.queue?.state || "unknown"} depth=${summary?.queue?.depth ?? "unknown"}`);
    lines.push(`tasks=${summary?.totals?.tasks ?? 0}  decisions=${summary?.totals?.decisions ?? 0}  runs=${summary?.totals?.runs ?? 0}`);
    lines.push(`task_status=${summarizeCounts(summary.task_status_counts)}`);
    lines.push(`run_status=${summarizeCounts(summary.run_status_counts)}`);

    if (summary.last_task) {
      lines.push("");
      lines.push(`last_task id=${summary.last_task.id} type=${summary.last_task.task_type} status=${summary.last_task.status}`);
    }
    if (summary.last_run) {
      lines.push(`last_run  id=${summary.last_run.id} action=${summary.last_run.action} status=${summary.last_run.status}`);
    }

    out.textContent = lines.join("\n");
  }

  async function refreshAll() {
    await Promise.all([
      refreshSummary(),
      refreshDecisions(),
      refreshTasks(),
      refreshRuns(),
      refreshOutcomes(),
    ]);
  }

  function wireFilters() {
    $("#decision-filter")?.addEventListener("change", refreshDecisions);
    $("#task-filter")?.addEventListener("change", refreshTasks);
    $("#run-filter")?.addEventListener("change", refreshRuns);
  }

  function wireWindowButtons() {
    $all(".btn-window").forEach((btn) => {
      btn.addEventListener("click", async () => {
        currentWindow = btn.dataset.window || DEFAULT_WINDOW;
        setWindowButtons();
        await refreshAll();
      });
    });
    setWindowButtons();
  }

  function wireSummaryControls() {
    $("#btn-refresh-all")?.addEventListener("click", async () => {
      await refreshAll();
      toast("refreshed");
    });

    $("#btn-auto")?.addEventListener("click", async () => {
      autoEnabled = !autoEnabled;
      const btn = $("#btn-auto");
      if (btn) {
        btn.textContent = autoEnabled ? "auto: on" : "auto: off";
        btn.classList.toggle("primary", autoEnabled);
      }
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = autoEnabled ? setInterval(refreshAll, AUTO_INTERVAL_MS) : null;
      if (autoEnabled) await refreshAll();
    });

    const btn = $("#btn-auto");
    if (btn) {
      btn.textContent = autoEnabled ? "auto: on" : "auto: off";
      btn.classList.toggle("primary", autoEnabled);
    }
  }

  function hotkeys() {
    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) return;
      if (e.key === "t" || e.key === "T") toggleTheme();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    ensurePowerlineAndTheme();

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || "terminal");

    initFromDom();
    hotkeys();
    wireFilters();
    wireWindowButtons();
    wireSummaryControls();

    setTime();
    setInterval(setTime, 1000);

    await refreshAll();
    if (autoEnabled) autoTimer = setInterval(refreshAll, AUTO_INTERVAL_MS);
  });
})();
