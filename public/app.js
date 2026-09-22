(function () {
  "use strict";

  const CH = {
    instagram: { label: "Instagram", color: "var(--ig)",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>' },
    facebook: { label: "Facebook", color: "var(--fb)",
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h-3a4 4 0 0 0-4 4v3H6v4h3v7h4v-7h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>' }
  };
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const $ = (id) => document.getElementById(id);

  let ACCOUNTS = [];
  let PLAN = {};
  let current = null;
  let currentRange = { range: '30' }; // { range: '7'|'30'|'90' } or { range: 'custom', since, until }

  // ---- helpers ------------------------------------------------------------
  const fmt = (n) => {
    if (n === null || n === undefined) return "–";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const href = (l) => (/^https?:\/\//i.test(l) ? l : "https://" + l);
  const shortUrl = (l) => l.replace(/^https?:\/\/(www\.)?/i, "");
  const pct = (v) => (v === null || v === undefined ? "" : ` ${v > 0 ? "+" : ""}${v}%`);

  function ago(ts) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
    if (mins < 60) return mins + " min ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    const days = Math.round(hrs / 24);
    if (days === 1) return "yesterday";
    return days + " days ago";
  }

  function weekDates() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return x; });
  }

  async function api(url, opts) {
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed");
    return json;
  }

  function sparkline(series, stroke) {
    if (!series || series.length < 2) {
      return '<div class="spark-empty">Trend appears after a couple of days of data</div>';
    }
    const w = 100, h = 34, pad = 3;
    const min = Math.min(...series), max = Math.max(...series);
    const span = (max - min) || 1;
    const pts = series.map((v, i) => [(i / (series.length - 1)) * w, h - pad - ((v - min) / span) * (h - pad * 2)]);
    const line = pts.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
    const area = line + ` L${w} ${h} L0 ${h} Z`;
    const last = pts[pts.length - 1];
    const gid = "g" + Math.random().toString(36).slice(2, 8);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Follower trend">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity=".22"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.1" fill="${stroke}"/>
    </svg>`;
  }

  // ---- render -------------------------------------------------------------
  function renderMenu() {
    const menu = $("menu");
    menu.innerHTML = ACCOUNTS.map((a) => {
      const chans = Object.keys(a.channels).filter((k) => a.channels[k]).map((k) => CH[k].label).join(" · ") || "Not connected";
      return `<button class="menu-item" role="menuitem" data-id="${esc(a.id)}" aria-current="${a.id === current.id}">
        <span class="dot" style="background:${a.id === current.id ? "var(--accent)" : "var(--line)"}"></span>
        <span><span class="mi-name">${esc(a.name)}</span><br><span class="mi-meta">${esc(chans)}</span></span>
      </button>`;
    }).join("");
    menu.querySelectorAll(".menu-item").forEach((b) => {
      b.addEventListener("click", () => {
        current = ACCOUNTS.find((a) => a.id === b.dataset.id);
        try { localStorage.setItem("healther.account", current.id); } catch (e) { /* ignore */ }
        closeMenu();
        render();
      });
    });
  }

  function renderSummary() {
    const chans = Object.values(current.channels).filter(Boolean);
    const followers = chans.reduce((s, c) => s + (c.followers || 0), 0);
    const reach = chans.reduce((s, c) => s + (c.reach || 0), 0);
    $("headline").textContent = chans.length ? `${fmt(followers)} followers, ${fmt(reach)} reached` : "Not connected yet";
    $("switchLabel").textContent = current.name;
  }

  function renderMetrics() {
    const cards = ["instagram", "facebook"].map((key) => {
      const c = current.channels[key];
      const meta = CH[key];
      if (!c) {
        const err = current.channelErrors[key];
        return `<div class="card"><div class="unset"><div>
          ${err ? `${meta.label} couldn't load<div class="err">${esc(err)}</div>`
                : `${meta.label} isn't set up<br>for this account`}
        </div></div></div>`;
      }
      const delta = c.delta === null || c.delta === undefined ? "" :
        `<span class="delta" data-dir="${c.delta < 0 ? "down" : "up"}">${c.delta >= 0 ? "+" : "−"}${fmt(Math.abs(c.delta))} this week</span>`;
      return `<div class="card">
        <div class="card-top">
          <div class="chan">
            <span class="chan-icon" style="background:color-mix(in srgb, ${meta.color} 14%, transparent); color:${meta.color}">${meta.icon}</span>
            <div>
              <div class="chan-name">${meta.label}</div>
              <div class="chan-handle">${esc(c.handle)}</div>
            </div>
          </div>
          ${delta}
        </div>
        <div class="figures">
          <div><div class="fig-label">Followers</div><div class="fig-value">${fmt(c.followers)}</div></div>
          <div><div class="fig-label">Engagements</div><div class="fig-value">${fmt(c.engagements)}</div></div>
          <div><div class="fig-label">Reach</div><div class="fig-value">${fmt(c.reach)}</div></div>
        </div>
        <div class="spark">${sparkline(c.trend, meta.color)}</div>
        <div class="card-foot">${esc(c.trendLabel || "Followers")}</div>
      </div>`;
    }).join("");

    $("metrics").innerHTML = cards + `<div class="card"><div class="unset">
      <div><strong style="color:var(--ink-soft);font-weight:500">LinkedIn</strong><br>
      Awaiting Partner API approval</div>
    </div></div>`;
  }

  function renderPosts() {
    const entries = Object.entries(current.published);
    $("posts").innerHTML = entries.length ? entries.map(([key, p]) => {
      const meta = CH[key];
      return `<div class="card post">
        <span class="tag" style="background:color-mix(in srgb, ${meta.color} 13%, transparent); color:${meta.color}">${meta.icon} ${meta.label}</span>
        <p class="post-caption">${esc(p.caption || "(no caption)")}</p>
        <div class="post-stats">
          <span><b>${fmt(p.likes)}</b> likes</span>
          <span><b>${fmt(p.comments)}</b> comments</span>
          <a class="day-link" style="margin:0 0 0 auto" href="${esc(p.url)}" target="_blank" rel="noreferrer">${esc(ago(p.timestamp))}</a>
        </div>
      </div>`;
    }).join("") : `<div class="card"><div class="unset"><div>No published posts found</div></div></div>`;
  }

  function renderWeek() {
    const dates = weekDates();
    const todayKey = ymd(new Date());
    const plan = PLAN[current.id] || {};

    $("week").innerHTML = dates.map((d, i) => {
      const key = ymd(d);
      const planned = plan[key];
      const live = current.recent.filter((p) => ymd(new Date(p.timestamp)) === key).slice(0, 2);
      const head = `<div class="day-head">
        <div>
          <div class="dow">${DOW[i]}</div>
          <div class="dnum">${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
        </div>
        <button class="pencil" data-edit="${key}" aria-label="Edit ${DOW[i]}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
      </div>`;

      let body;
      if (planned) {
        const meta = CH[planned.ch];
        body = `<span class="tag" style="background:color-mix(in srgb, ${meta.color} 13%, transparent); color:${meta.color}">${meta.icon} ${meta.label}</span>
          <p class="day-caption">${esc(planned.caption)}</p>
          ${planned.link ? `<a class="day-link" href="${esc(href(planned.link))}" target="_blank" rel="noreferrer">${esc(shortUrl(planned.link))}</a>` : ""}`;
      } else if (live.length) {
        body = live.map((p) => {
          const meta = CH[p.ch];
          return `<div class="day-item">
            <div class="day-tags">
              <span class="tag" style="background:color-mix(in srgb, ${meta.color} 13%, transparent); color:${meta.color}">${meta.icon} ${meta.label}</span>
              <span class="tag live">Live</span>
            </div>
            <p class="day-caption">${esc(p.caption || "(no caption)")}</p>
            <a class="day-link" href="${esc(p.url)}" target="_blank" rel="noreferrer">${esc(shortUrl(p.url))}</a>
          </div>`;
        }).join("");
      } else {
        body = `<button class="add" data-edit="${key}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Plan a post
        </button>`;
      }
      return `<div class="day" data-today="${key === todayKey}" data-day="${key}">${head}${body}</div>`;
    }).join("");

    $("week").querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
  }

  function openEditor(key) {
    const cell = document.querySelector(`.day[data-day="${key}"]`);
    if (!cell || cell.querySelector(".editor")) return;
    const post = (PLAN[current.id] || {})[key] || { ch: "instagram", caption: "", link: "" };
    const opts = Object.keys(CH).map((k) => `<option value="${k}"${k === post.ch ? " selected" : ""}>${CH[k].label}</option>`).join("");

    cell.innerHTML = cell.querySelector(".day-head").outerHTML + `<div class="editor">
      <select aria-label="Channel">${opts}</select>
      <textarea placeholder="Caption" aria-label="Caption">${esc(post.caption)}</textarea>
      <input placeholder="Post link" aria-label="Post link" value="${esc(post.link)}">
      <p class="form-err" hidden></p>
      <div class="editor-actions">
        <button class="save">Save</button>
        <button class="cancel">Cancel</button>
      </div>
    </div>`;

    const sel = cell.querySelector("select"), cap = cell.querySelector("textarea"), lnk = cell.querySelector("input"), err = cell.querySelector(".form-err");
    cap.focus();

    cell.querySelector(".save").addEventListener("click", async () => {
      const caption = cap.value.trim();
      try {
        if (caption) {
          const saved = await api(`/api/planner/${encodeURIComponent(current.id)}/${key}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ch: sel.value, caption, link: lnk.value.trim() })
          });
          (PLAN[current.id] = PLAN[current.id] || {})[key] = saved;
        } else {
          await api(`/api/planner/${encodeURIComponent(current.id)}/${key}`, { method: "DELETE" });
          if (PLAN[current.id]) delete PLAN[current.id][key];
        }
        renderWeek();
      } catch (e) {
        err.textContent = "Couldn't save: " + e.message;
        err.hidden = false;
      }
    });
    cell.querySelector(".cancel").addEventListener("click", renderWeek);
  }

  function renderNotes() {
    const items = ACCOUNTS.flatMap((a) => [
      ...Object.entries(a.channelErrors).map(([k, e]) => `${a.name} · ${CH[k].label}: ${e}`),
      ...a.notes.map((n) => `${a.name} · ${n}`)
    ]);
    $("notes").hidden = !items.length;
    $("notesList").innerHTML = items.map((n) => `<li>${esc(n)}</li>`).join("");
  }

  // ---- Claude Weekly Intelligence ------------------------------------------
  let claudeToken = 0; // guards against a slow request landing after a faster account switch

  function claudeSection(title, items) {
    if (!items || !items.length) return "";
    return `<div class="claude-block"><h4>${title}</h4><ul class="claude-list">${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
  }

  function bindClaudeActions(record) {
    const regen = $("claudeRegenBtn");
    if (regen) {
      regen.addEventListener("click", async () => {
        const accountId = current.id;
        regen.disabled = true;
        const label = regen.textContent;
        regen.textContent = "Regenerating…";
        try {
          const fresh = await api(`/api/weekly-analysis/${encodeURIComponent(accountId)}/regenerate`, { method: "POST" });
          if (current.id === accountId) renderClaudeCard(fresh);
        } catch (e) {
          if (current.id === accountId) $("claudeCard").innerHTML = `<p class="claude-error">${esc(e.message)}</p>`;
        } finally {
          if (regen.isConnected) { regen.disabled = false; regen.textContent = label; }
        }
      });
    }
    const view = $("claudeViewBtn");
    if (view && record) view.addEventListener("click", () => openClaudeModal(record));
    const report = $("claudeReportBtn");
    if (report) {
      report.addEventListener("click", () => {
        window.open(`/api/weekly-analysis/${encodeURIComponent(current.id)}/report`, "_blank");
      });
    }
  }

  function renderClaudeCard(record) {
    const card = $("claudeCard");
    const period = $("claudePeriod");

    if (!record || !record.analysis) {
      period.textContent = "";
      card.innerHTML = `
        <p class="claude-empty">${esc((record && record.message) || "No analysis yet — click “Regenerate Analysis” to generate this week's report.")}</p>
        <div class="claude-actions"><button class="ghost-btn" id="claudeRegenBtn">Regenerate Analysis</button></div>`;
      bindClaudeActions(null);
      return;
    }

    const a = record.analysis;
    period.textContent = "Week: " + record.period_label;

    const up = (a.improvements || []).slice(0, 4).map((i) =>
      `<li><span class="claude-metric-up">📈 ${esc(i.metric)}${pct(i.change_pct)}</span><span class="claude-detail">${esc(i.detail)}</span></li>`
    ).join("");
    const down = (a.declines || []).slice(0, 4).map((d) =>
      `<li><span class="claude-metric-down">📉 ${esc(d.metric)}${pct(d.change_pct)}</span><span class="claude-detail">${esc(d.detail)}</span></li>`
    ).join("");
    const top = (a.top_posts || []).slice(0, 3).map((p) => {
      const meta = CH[p.platform] || { color: "var(--ink-faint)" };
      return `<li><span class="tag" style="background:color-mix(in srgb, ${meta.color} 13%, transparent); color:${meta.color}">${esc(p.platform)}</span>
        ${esc((p.caption_or_title || "").slice(0, 90))}${p.url ? ` — <a class="day-link" href="${esc(p.url)}" target="_blank" rel="noreferrer">view</a>` : ""}
        <span class="claude-detail">${esc(p.why_it_stands_out || "")}</span></li>`;
    }).join("");
    const recs = (a.recommendations || []).slice(0, 4).map((s) => `<li>${esc(s)}</li>`).join("");
    const plan = (a.next_week_plan || []).slice(0, 7).map((p) =>
      `<li><b>${esc(p.day)}</b> — ${esc(p.platform)} · ${esc(p.format)}: ${esc(p.topic)}</li>`
    ).join("");

    card.innerHTML = `
      <p class="claude-summary">${esc(a.executive_summary || "")}</p>
      ${up ? `<div class="claude-block"><h4>📈 Improved</h4><ul class="claude-list">${up}</ul></div>` : ""}
      ${down ? `<div class="claude-block"><h4>📉 Declined</h4><ul class="claude-list">${down}</ul></div>` : ""}
      ${top ? `<div class="claude-block"><h4>🔥 Top Content</h4><ul class="claude-list">${top}</ul></div>` : ""}
      ${claudeSection("🧠 What Claude Found", a.content_patterns)}
      ${recs ? `<div class="claude-block"><h4>🎯 Next Week</h4><ul class="claude-list">${recs}</ul></div>` : ""}
      ${plan ? `<div class="claude-block"><h4>📅 Suggested Content Plan</h4><ul class="claude-list">${plan}</ul></div>` : ""}
      <div class="claude-actions">
        <button class="ghost-btn" id="claudeViewBtn">View Full Analysis</button>
        <button class="ghost-btn" id="claudeRegenBtn">Regenerate Analysis</button>
        <button class="ghost-btn" id="claudeReportBtn">Generate Report</button>
      </div>
      <p class="claude-disclaimer">AI analysis generated by Claude using your account's analytics data.</p>
    `;
    bindClaudeActions(record);
  }

  function openClaudeModal(record) {
    const a = record.analysis;
    const modal = $("claudeModal");
    modal.querySelector(".claude-modal-body").innerHTML = `
      <h3>🤖 Claude Weekly Intelligence — ${esc(record.account_name)}</h3>
      <p class="sec-note">Week: ${esc(record.period_label)}</p>
      <p class="claude-summary">${esc(a.executive_summary)}</p>
      ${claudeSection("📈 Improved", (a.improvements || []).map((i) => `${i.metric}${pct(i.change_pct)} — ${i.detail}`))}
      ${claudeSection("📉 Declined", (a.declines || []).map((d) => `${d.metric}${pct(d.change_pct)} — ${d.detail}`))}
      ${claudeSection("🔥 Top Content", (a.top_posts || []).map((p) => `[${p.platform}] ${p.caption_or_title} — ${p.why_it_stands_out}`))}
      ${claudeSection("🧠 Content Patterns", a.content_patterns)}
      ${claudeSection("💬 Engagement Analysis", a.engagement_analysis)}
      ${claudeSection("📊 Platform Comparison", (a.platform_comparison || []).map((p) => `${p.platform}: reach ${p.reach ?? "–"}, engagement rate ${p.engagement_rate ?? "–"}%`))}
      ${claudeSection("🗓️ Posting Consistency", [JSON.stringify(a.posting_consistency || {})])}
      ${claudeSection("🎯 Recommendations", a.recommendations)}
      ${claudeSection("📅 Next Week Content Plan", (a.next_week_plan || []).map((p) => `${p.day} — ${p.platform} — ${p.format}: ${p.topic} — ${p.reason}`))}
      ${claudeSection("⚠️ Data Limitations", a.data_limitations)}
      <p class="claude-disclaimer">AI analysis generated by Claude using your account's analytics data.</p>
    `;
    modal.hidden = false;
  }

  async function loadClaude() {
    const accountId = current.id;
    const token = ++claudeToken;
    $("claudeCard").innerHTML = '<p class="claude-loading">Loading this week’s analysis…</p>';
    $("claudePeriod").textContent = "—";
    try {
      const record = await api(`/api/weekly-analysis/${encodeURIComponent(accountId)}`);
      if (token !== claudeToken || current.id !== accountId) return; // a newer request/account switch won
      renderClaudeCard(record.analysis ? record : null);
    } catch (e) {
      if (token !== claudeToken || current.id !== accountId) return;
      $("claudeCard").innerHTML = `<p class="claude-error">Couldn't load analysis: ${esc(e.message)}</p>`;
    }
  }

  function render() {
    renderSummary();
    renderMenu();
    renderMetrics();
    renderPosts();
    renderWeek();
    renderNotes();
    loadClaude();
    resetPostsSection();
  }

  // ---- switcher -----------------------------------------------------------
  const switcher = $("switcher"), menu = $("menu"), switchBtn = $("switchBtn");
  function openMenu() { menu.hidden = false; switcher.dataset.open = "true"; switchBtn.setAttribute("aria-expanded", "true"); }
  function closeMenu() { menu.hidden = true; switcher.dataset.open = "false"; switchBtn.setAttribute("aria-expanded", "false"); }
  switchBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); });
  document.addEventListener("click", (e) => { if (!switcher.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  // ---- Claude modal ---------------------------------------------------------
  const claudeModal = $("claudeModal");
  if (claudeModal) {
    claudeModal.querySelector(".claude-modal-close").addEventListener("click", () => { claudeModal.hidden = true; });
    claudeModal.addEventListener("click", (e) => { if (e.target === claudeModal) claudeModal.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") claudeModal.hidden = true; });
  }

  // ---- load / refresh -----------------------------------------------------
  const refreshBtn = $("refreshBtn");

  function rangeQuery() {
    const p = new URLSearchParams();
    p.set("range", currentRange.range);
    if (currentRange.range === "custom") { p.set("since", currentRange.since); p.set("until", currentRange.until); }
    return p.toString();
  }

  async function load(refresh) {
    if (refreshBtn.dataset.busy === "true") return;
    refreshBtn.dataset.busy = "true";
    $("refreshLabel").textContent = "Refreshing";
    try {
      const qs = rangeQuery() + (refresh ? "&refresh=1" : "");
      const [data, plan] = await Promise.all([api("/api/accounts?" + qs), api("/api/planner")]);
      ACCOUNTS = data.accounts;
      PLAN = plan;
      let saved = null;
      try { saved = localStorage.getItem("healther.account"); } catch (e) { /* ignore */ }
      current = ACCOUNTS.find((a) => a.id === (current && current.id)) || ACCOUNTS.find((a) => a.id === saved) || ACCOUNTS[0];
      render();
      $("chanNote").textContent = data.range?.label || "";
      $("stamp").textContent = "Updated " + new Date(data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      $("headline").textContent = "Couldn't load your data";
      $("stamp").textContent = e.message;
    } finally {
      refreshBtn.dataset.busy = "false";
      $("refreshLabel").textContent = "Refresh";
    }
  }

  refreshBtn.addEventListener("click", () => load(true));

  // ---- range picker (Channels metrics window) ------------------------------
  const rangePicker = $("rangePicker"), rangeCustom = $("rangeCustom");
  rangePicker.querySelectorAll(".range-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const val = chip.dataset.range;
      rangePicker.querySelectorAll(".range-chip").forEach((b) => b.removeAttribute("aria-current"));
      chip.setAttribute("aria-current", "true");
      if (val === "custom") {
        rangeCustom.hidden = false;
        if (!$("rangeFrom").value || !$("rangeTo").value) return; // wait for Apply
      } else {
        rangeCustom.hidden = true;
        currentRange = { range: val };
        load(false);
      }
    });
  });
  $("rangeApply").addEventListener("click", () => {
    const since = $("rangeFrom").value, until = $("rangeTo").value;
    if (!since || !until || since > until) {
      alert("Pick a valid from/to date range.");
      return;
    }
    currentRange = { range: "custom", since, until };
    load(false);
  });

  // ---- All Posts explorer --------------------------------------------------
  const CT_COLOR = { instagram: "var(--ig)", facebook: "var(--fb)" };

  function renderPostsTable(data) {
    const wrap = $("postsTableWrap");
    if (data.errors && data.errors.length && (!data.posts || !data.posts.length)) {
      wrap.innerHTML = `<div class="posts-error">${data.errors.map(esc).join("<br>")}</div>`;
      return;
    }
    if (!data.posts || !data.posts.length) {
      wrap.innerHTML = `<div class="posts-empty">No posts found in this date range.</div>`;
      return;
    }
    const rows = data.posts.map((p) => {
      const color = CT_COLOR[p.platform] || "var(--ink-faint)";
      return `<tr>
        <td><span class="tag" style="background:color-mix(in srgb, ${color} 13%, transparent); color:${color}">${esc(p.platform)}</span></td>
        <td>${esc(new Date(p.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</td>
        <td>${esc(p.content_type || "")}</td>
        <td class="posts-caption">${p.url ? `<a class="day-link" href="${esc(p.url)}" target="_blank" rel="noreferrer">${esc(p.caption || "(no caption)")}</a>` : esc(p.caption || "(no caption)")}</td>
        <td>${fmt(p.impressions ?? p.reach)}</td>
        <td>${fmt(p.views)}</td>
        <td>${fmt(p.likes)}</td>
        <td>${fmt(p.comments)}</td>
        <td>${fmt(p.shares)}</td>
        <td>${fmt(p.saved)}</td>
      </tr>`;
    }).join("");
    wrap.innerHTML = `<div class="table-scroll"><table class="posts-table">
      <thead><tr>
        <th>Platform</th><th>Date</th><th>Type</th><th>Caption</th>
        <th>Impressions / Reach</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Saved</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${data.errors && data.errors.length ? `<p class="posts-error" style="padding-top:8px">${data.errors.map(esc).join("<br>")}</p>` : ""}`;
  }

  function resetPostsSection() {
    $("postsTableWrap").innerHTML = `<div class="posts-empty">Pick a date range above and click "Show Posts" to see every post with its impressions, likes, comments, shares and saves.</div>`;
    $("postsRangeNote").textContent = "Pick a date range below";
  }

  $("postsApplyBtn").addEventListener("click", async () => {
    const since = $("postsFrom").value, until = $("postsTo").value;
    if (!since || !until || since > until) { alert("Pick a valid from/to date range."); return; }
    const wrap = $("postsTableWrap");
    wrap.innerHTML = `<div class="posts-empty">Loading posts…</div>`;
    try {
      const data = await api(`/api/posts/${encodeURIComponent(current.id)}?range=custom&since=${since}&until=${until}`);
      $("postsRangeNote").textContent = data.range?.label || "";
      renderPostsTable(data);
    } catch (e) {
      wrap.innerHTML = `<div class="posts-error">${esc(e.message)}</div>`;
    }
  });

  $("headline").textContent = "Loading…";
  $("stamp").textContent = "Fetching from Meta";
  load(false);
})();
