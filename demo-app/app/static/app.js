(function () {
  const THEME_KEY = "demoapp_theme";
  const themes = ["light", "dark", "terminal"];

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

  function applyTheme(t) {
    const theme = themes.includes(t) ? t : "terminal";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    document.querySelectorAll(".theme-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === theme);
    });
  }

  function cycleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "terminal";
    const i = themes.indexOf(cur);
    applyTheme(themes[(i + 1) % themes.length]);
    toast(`theme=${document.documentElement.getAttribute("data-theme")}`);
  }

  function ensureThemeSwitch(host) {
    const wrap = el("div", "theme-switch");
    const buttons = [
      { theme: "light", label: "1:light" },
      { theme: "dark", label: "2:dark" },
      { theme: "terminal", label: "3:term" },
    ];
    for (const b of buttons) {
      const btn = el("button", "theme-btn", b.label);
      btn.type = "button";
      btn.dataset.theme = b.theme;
      btn.addEventListener("click", () => applyTheme(b.theme));
      wrap.appendChild(btn);
    }
    host.appendChild(wrap);
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
    const lines = next.split("\n").slice(-120);
    pre.textContent = lines.join("\n") + "\n";
    pre.scrollTop = pre.scrollHeight;
  }

  function curlFor(path) {
    const base = window.location.origin;
    return `curl -fsS '${base}${path}'`;
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

  function wireQuickActions() {
    const btn503 = $("#btn-503");
    const btnSlow = $("#btn-slow");
    const btnMetrics = $("#btn-metrics");
    const btnCopy = $("#btn-copy");

    const msInput = $("#slow-ms");

    if (btn503) {
      btn503.addEventListener("click", async () => {
        await hit(`/error?code=503`);
      });
    }

    if (btnSlow) {
      btnSlow.addEventListener("click", async () => {
        const ms = msInput ? Number(msInput.value || "500") : 500;
        const safe = Number.isFinite(ms) ? Math.max(0, Math.min(ms, 30000)) : 500;
        if (msInput) msInput.value = String(safe);
        await hit(`/slow?ms=${encodeURIComponent(String(safe))}`);
      });
    }

    if (btnMetrics) {
      btnMetrics.addEventListener("click", async () => {
        await hit(`/metrics`);
      });
    }

    if (btnCopy) {
      btnCopy.addEventListener("click", async () => {
        const ms = msInput ? Number(msInput.value || "500") : 500;
        const safe = Number.isFinite(ms) ? Math.max(0, Math.min(ms, 30000)) : 500;
        const script =
          [
            curlFor("/healthz"),
            curlFor("/metrics"),
            curlFor(`/slow?ms=${safe}`),
            curlFor("/error?code=503"),
          ].join("\n") + "\n";
        await navigator.clipboard.writeText(script);
        toast("copied curl script");
      });
    }
  }

  function hotkeys() {
    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

      if (e.key === "t" || e.key === "T") {
        cycleTheme();
      } else if (e.key === "1") {
        applyTheme("light"); toast("theme=light");
      } else if (e.key === "2") {
        applyTheme("dark"); toast("theme=dark");
      } else if (e.key === "3") {
        applyTheme("terminal"); toast("theme=terminal");
      } else if (e.key === "?") {
        toast("keys: t cycle | 1 light | 2 dark | 3 terminal");
      }
    });
  }

  function ensurePowerlineAndTheme() {
    let pl = $(".powerline");
    if (!pl) {
      const top = $(".topbar") || document.body;
      pl = el("div", "powerline");
      top.appendChild(pl);
    }

    function seg(id, innerHtml, extraCls = "") {
      const s = el("div", `seg ${extraCls}`.trim());
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

    if (!pl.querySelector(".theme-switch")) {
      ensureThemeSwitch(pl);
    }
  }

  async function refreshStatusLoop() {
    setTime();
    const ok = await pingHealthz();
    setStatus(ok);
    setInterval(async () => {
      setTime();
      setStatus(await pingHealthz());
    }, 3000);
  }

  function initFromDom() {
    const appName = document.documentElement.getAttribute("data-app") || $("#app-name")?.textContent || null;
    const env = document.documentElement.getAttribute("data-env") || $("#env-name")?.textContent || null;
    if (appName && $("#pl-app")) $("#pl-app").textContent = appName;
    if (env && $("#pl-env")) $("#pl-env").textContent = env;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    ensurePowerlineAndTheme();

    const saved = localStorage.getItem(THEME_KEY);
    applyTheme(saved || "terminal");

    initFromDom();
    hotkeys();
    wireQuickActions();
    await refreshStatusLoop();

    appendEvent("ready (press ? for keys)");
  });
})();
