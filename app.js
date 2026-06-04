/* ============================================================
   TPS Spec Visualizer — app shell, navigator, drawer, router
   ============================================================ */
(function () {
  const S = window.SPEC;

  /* ---- tiny DOM helpers (shared via window.UI) ---- */
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    if (children != null) (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  const icons = {
    overview: '<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 9h7v12h-7zM3 12h7v9H3z"/>',
    entities: '<path d="M4 5h16v4H4zM4 11h16v4H4zM4 17h16v3H4z"/>',
    relationships: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.6 7.6l3 8M16.4 7.6l-3 8M8 6h8" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    workflows: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8 7l8 4M8 17l8-4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    operations: '<path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="18" r="2"/>',
    logic: '<path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14 4l6 6m0-6v6h-6" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="14" r="1.4"/><path d="M11.5 14h4" stroke="currentColor" stroke-width="1.6"/>',
    security: '<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    ui: '<rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 9h18M8 9v11" fill="none" stroke="currentColor" stroke-width="1.5"/>'
  };
  function svgIcon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "ico");
    svg.setAttribute("fill", "currentColor");
    svg.innerHTML = icons[name] || "";
    return svg;
  }

  /* ---- app state ---- */
  const app = {
    current: "workflows",
    diffOn: true,
    statusOn: false,
    drawer: null
  };
  window.APP = app;

  /* ---- mount skeleton ---- */
  const root = document.getElementById("app");

  // brand
  const brand = el("div", { class: "brand" }, [
    el("img", { class: "brand-logo", src: "assets/vcola-logo.png", alt: "VCola.ai" })
  ]);

  // topbar — two orthogonal lenses
  const diffToggle = el("div", { class: "toggle on", onclick: toggleDiff }, [
    el("div", { class: "track" }, el("div", { class: "knob" })),
    el("span", { text: "Diff" })
  ]);
  const legend = el("div", { class: "legend" }, [
    el("span", { class: "item" }, [el("span", { class: "sw yellow" }), "changed"]),
    el("span", { class: "item" }, [el("span", { class: "sw red" }), "deployed"]),
    el("span", { class: "item" }, [el("span", { class: "sw built", style: "background:var(--built-soft);border-color:var(--built)" }), "built"]),
    el("span", { class: "item" }, [el("span", { class: "sw breaking", text: "⚠" }), "breaking"])
  ]);
  const statusToggle = el("div", { class: "toggle status", onclick: toggleStatus }, [
    el("div", { class: "track" }, el("div", { class: "knob" })),
    el("span", { text: "Status" })
  ]);
  const statusLegend = el("div", { class: "legend status hidden" }, [
    el("span", { class: "item" }, [el("span", { class: "sw wired" }), "✓ wired"]),
    el("span", { class: "item" }, [el("span", { class: "sw todo" }), "◷ TODO"])
  ]);
  const topbar = el("div", { class: "topbar" }, [
    el("div", { class: "product" }, [
      el("span", { class: "pname", text: S.product.name }),
      el("span", { class: "pver", text: S.product.version })
    ]),
    el("span", { class: "live" }, [el("span", { class: "dot" }), "live"]),
    el("div", { class: "spacer" }),
    el("div", { class: "lens-group" }, [
      el("div", { class: "diff-control" }, [diffToggle, legend]),
      el("div", { class: "lens-sep" }),
      el("div", { class: "diff-control" }, [statusToggle, statusLegend])
    ]),
    el("div", { class: "baseline" }, [
      el("b", { class: "mono", text: "HEAD " + S.product.baseline })
    ])
  ]);

  // navigator
  const nav = el("div", { class: "nav scroll" });
  nav.appendChild(el("div", { class: "nav-label", text: "Spec areas" }));
  S.areas.forEach(a => nav.appendChild(navItem(a)));
  nav.appendChild(el("div", { class: "nav-foot", html:
    "Live-loaded against the last committed baseline. Badges show changes per area — <b style='color:var(--err)'>red</b> from the latest deploy, <b style='color:var(--warn)'>amber</b> uncommitted drift." }));

  // main + drawer
  const main = el("div", { class: "main" });
  const viewHost = el("div", { class: "view scroll" });
  const drawer = el("div", { class: "drawer" });
  main.appendChild(viewHost);
  main.appendChild(drawer);

  root.appendChild(brand);
  root.appendChild(topbar);
  root.appendChild(nav);
  root.appendChild(main);
  root.classList.add("app");
  applyDiffClass();

  // Esc closes the drawer; clicking empty view background closes it too.
  document.addEventListener("keydown", e => { if (e.key === "Escape" && app.drawer) closeDrawer(); });
  viewHost.addEventListener("click", e => {
    if (!app.drawer) return;
    // only the empty container itself — never a row/card/node/button inside it
    if (e.target === viewHost || e.target.classList.contains("view-pad") ||
        e.target.classList.contains("wf") || e.target.classList.contains("view")) {
      closeDrawer();
    }
  });

  function navItem(a) {
    const ch = S.areaChanges[a.id] || { count: 0 };
    const badge = el("span", {
      class: "badge " + (ch.count === 0 ? "zero" : ch.severity)
    }, [document.createTextNode(String(ch.count)), ch.breaking ? el("span", { class: "brk", text: "⚠" }) : null]);

    const titleRow = el("div", { class: "t" }, [
      document.createTextNode(a.label),
      a.star ? el("span", { class: "star", text: "★" }) : null,
      a.priority ? el("span", { class: "pri", text: "priority" }) : null
    ]);
    const item = el("div", {
      class: "nav-item" + (a.id === app.current ? " active" : ""),
      "data-area": a.id,
      onclick: () => go(a.id)
    }, [
      svgIcon(a.id),
      el("div", { class: "txt" }, [titleRow, el("div", { class: "d", text: a.desc })]),
      badge
    ]);
    return item;
  }

  /* ---- router ---- */
  function go(areaId) {
    app.current = areaId;
    closeDrawer();
    nav.querySelectorAll(".nav-item").forEach(n =>
      n.classList.toggle("active", n.getAttribute("data-area") === areaId));
    viewHost.innerHTML = "";
    viewHost.scrollTop = 0;
    const view = window.VIEWS[areaId];
    if (view) view.render(viewHost);
    else viewHost.appendChild(el("div", { class: "view-pad" }, el("p", { text: "Coming soon." })));
    // persist
    try { localStorage.setItem("tps_area", areaId); } catch (e) {}
  }
  window.APP.go = go;

  /* ---- diff toggle ---- */
  function toggleDiff() {
    app.diffOn = !app.diffOn;
    diffToggle.classList.toggle("on", app.diffOn);
    legend.classList.toggle("hidden", !app.diffOn);
    applyDiffClass();
    document.dispatchEvent(new CustomEvent("diffchange", { detail: app.diffOn }));
  }
  function applyDiffClass() {
    root.classList.toggle("diff-off", !app.diffOn);
    legend.classList.toggle("hidden", !app.diffOn);
  }

  /* ---- implementation-status lens ---- */
  function toggleStatus() {
    app.statusOn = !app.statusOn;
    statusToggle.classList.toggle("on", app.statusOn);
    statusLegend.classList.toggle("hidden", !app.statusOn);
    root.classList.toggle("status-lens", app.statusOn);
    document.dispatchEvent(new CustomEvent("statuschange", { detail: app.statusOn }));
  }

  /* ============================================================
     Drawer API (window.UI.openDrawer)
     payload: { kicker, title, sections:[{lbl, node}], onClose }
     ============================================================ */
  function openDrawer(payload) {
    drawer.innerHTML = "";
    const head = el("div", { class: "d-head" }, [
      el("div", {}, [
        el("div", { class: "d-kicker", text: payload.kicker || "" }),
        el("h3", { text: payload.title || "" })
      ]),
      el("button", { class: "d-close", html: "✕", title: "Close", onclick: closeDrawer })
    ]);
    const body = el("div", { class: "d-body scroll" });
    (payload.sections || []).forEach(sec => {
      if (!sec) return;
      const s = el("div", { class: "d-section" });
      if (sec.lbl) s.appendChild(el("div", { class: "lbl", text: sec.lbl }));
      if (sec.node) s.appendChild(sec.node);
      body.appendChild(s);
    });
    drawer.appendChild(head);
    drawer.appendChild(body);
    const wasOpen = drawer.classList.contains("open");
    drawer.classList.add("open");
    app.drawer = payload.id || true;
    if (!wasOpen) document.dispatchEvent(new CustomEvent("drawerresize"));
  }
  function closeDrawer() {
    const wasOpen = drawer.classList.contains("open");
    drawer.classList.remove("open");
    app.drawer = null;
    if (wasOpen) document.dispatchEvent(new CustomEvent("drawerresize"));
    document.dispatchEvent(new CustomEvent("drawerclose"));
  }

  /* ---- diff helpers shared with views ---- */
  function diffById(id) { return S.diffs.find(d => d.id === id); }
  function diffByTarget(target) { return S.diffs.find(d => d.target === target); }

  function diffBox(diff) {
    if (!diff) return null;
    const box = el("div", { class: "diffbox " + diff.status });
    const title = diff.breaking ? "Breaking change"
      : diff.status === "built" ? "Now implemented"
      : diff.status === "red" ? "Changed by latest deploy"
      : "Changed since last commit";
    box.appendChild(el("div", { class: "dtitle" }, [
      el("span", { class: "brkmark", html: diff.breaking ? "⚠" : (diff.status === "built" ? "✓" : "●") }),
      document.createTextNode(title)
    ]));
    const ft = el("div", { class: "fromto" });
    ft.appendChild(el("div", { class: "row" }, [el("span", { class: "tag", text: "from" }), el("span", { class: "from", text: diff.from })]));
    ft.appendChild(el("div", { class: "row" }, [el("span", { class: "tag", text: "to" }), el("span", { class: "to", text: diff.to })]));
    box.appendChild(ft);
    if (diff.note) box.appendChild(el("div", { class: "dnote", text: diff.note }));
    return box;
  }

  window.UI = { el, svgIcon, openDrawer, closeDrawer, diffById, diffByTarget, diffBox,
    get diffOn() { return app.diffOn; }, get statusOn() { return app.statusOn; } };

  /* ---- boot ---- */
  let start = "workflows";
  try { const s = localStorage.getItem("tps_area"); if (s && window.VIEWS && window.VIEWS[s]) start = s; } catch (e) {}
  // VIEWS may not all be registered yet at parse time; defer
  window.addEventListener("DOMContentLoaded", () => {});
  // go after all scripts loaded
  window.__bootApp = () => go(start);
})();
