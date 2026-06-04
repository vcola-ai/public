/* ============================================================
   VCola Studio — Logic (implementation-intent layer)
   ============================================================ */
(function () {
  const S = window.SPEC;
  const { el } = window.UI;

  const KIND_LABELS = {
    routing: { label: "Routing", sub: "workflow next-state decisions" },
    query: { label: "Query logic", sub: "read calculations" },
    mutation: { label: "Mutation logic", sub: "operation bodies / side effects" },
    invariant: { label: "Invariant", sub: "entity rules" },
    standalone: { label: "Standalone", sub: "reusable, referenced by multiple operations" }
  };
  const KIND_ORDER = ["routing", "query", "mutation", "invariant", "standalone"];

  // Build the unified catalog: explicit logic entries + operations-as-logic.
  function buildCatalog() {
    const items = [];
    S.logic.forEach(l => items.push(Object.assign({}, l)));
    S.security.operations.forEach(op => {
      items.push({
        id: op.name, name: op.name, kind: op.kind === "mutation" ? "mutation" : "query",
        status: op.status || "wired", feature: op.feature,
        oneLine: op.intent, intent: op.intent, op: op, refs: []
      });
    });
    return items;
  }
  const CATALOG = buildCatalog();
  function byId(id) { return CATALOG.find(x => x.id === id || x.name === id); }

  const filters = { status: "all", feature: "all" };

  function statind(status) {
    const todo = status === "todo";
    return el("span", { class: "statind " + (todo ? "todo" : "wired") }, [
      el("span", { class: "g", text: todo ? "◷" : "✓" }), todo ? "TODO" : "wired"
    ]);
  }

  function navigateRef(ref) {
    if (ref.type === "op") { const o = S.security.operations.find(x => x.name === ref.id); if (o && window.SEC_UI) return window.SEC_UI.openOpDrawer(o); }
    if (ref.type === "logic") return openLogicDrawer(ref.id);
    if (ref.type === "state") return window.APP.go("workflows");
    if (ref.type === "field") return window.APP.go("entities");
    window.APP.go("logic");
  }

  function openLogicDrawer(id) {
    const x = byId(id);
    if (!x) return;
    const sections = [];
    sections.push({ node: el("div", {}, [
      el("div", { class: "state-meta" }, [
        el("span", { class: "chip mono", text: KIND_LABELS[x.kind] ? KIND_LABELS[x.kind].label : x.kind }),
        x.feature ? el("span", { class: "chip mono", text: x.feature }) : null,
        statind(x.status)
      ]),
      x.io ? el("div", { class: "lc-io", style: "margin-top:9px", text: x.io }) : null
    ]) });
    sections.push({ lbl: "Implementation intent", node: el("div", { class: "intent-text", text: x.intent || x.oneLine }) });

    // diff (intent changed / became implemented)
    const d = window.UI.diffByTarget(x.name);
    if (d) sections.push({ node: window.UI.diffBox(d) });

    // references
    if (x.refs && x.refs.length) {
      const list = el("div", { class: "reflist" });
      x.refs.forEach(ref => {
        list.appendChild(el("div", { class: "refrow", onclick: () => navigateRef(ref) }, [
          el("span", { class: "rtype", text: ref.type }),
          el("span", { class: "rname", text: ref.label }),
          el("span", { style: "margin-left:auto;color:var(--faint)", text: "→" })
        ]));
      });
      sections.push({ lbl: "Referenced by / related", node: list });
    } else if (x.op) {
      sections.push({ lbl: "Authorization", node: el("div", { class: "pill-grid" }, [
        el("button", { class: "scenario", text: "Open in Security matrix →", onclick: () => window.APP.go("security") })
      ]) });
    }

    window.UI.openDrawer({ id: "logic:" + x.id, kicker: (KIND_LABELS[x.kind] ? KIND_LABELS[x.kind].label : "Logic"), title: x.name, sections });
  }
  window.LOGIC_UI = { openLogicDrawer };

  function logicCard(x) {
    const card = el("div", { class: "logic-card" + (x.status === "todo" ? " s-todo" : ""), onclick: () => openLogicDrawer(x.id) });
    const d = window.UI.diffByTarget(x.name);
    card.appendChild(el("div", { class: "lc-top" }, [
      el("div", { class: "lc-name" }, [
        document.createTextNode(x.name),
        d ? el("span", { class: "dchip " + d.status, style: "margin-left:7px", text: d.status === "built" ? "now built" : "changed" }) : null
      ]),
      statind(x.status)
    ]));
    if (x.io) card.appendChild(el("div", { class: "lc-io", text: x.io }));
    card.appendChild(el("div", { class: "lc-line", text: x.oneLine }));
    if (x.refs && x.refs.length) {
      const refs = el("div", { class: "lc-refs" }, [el("span", { class: "reflabel", text: "used by" })]);
      x.refs.forEach(r => refs.appendChild(el("span", { class: "ref", text: r.label })));
      card.appendChild(refs);
    }
    return card;
  }

  function render(host) {
    const pad = el("div", { class: "view-pad" });
    pad.appendChild(el("div", { class: "view-head" }, [
      el("div", { class: "eyebrow", text: "Implementation" }),
      el("h1", { text: "Logic" }),
      el("p", { class: "lead", text: "Every function that does something carries an implementation intent (\u201Cwhat it's supposed to do\u201D) and a status: \u2713 wired (a real function is attached) or \u25F7 TODO (still a placeholder). Toggle the Status lens in the top bar to see what's left to build across the whole spec." })
    ]));

    // counts
    const wired = CATALOG.filter(x => x.status !== "todo").length;
    const todo = CATALOG.filter(x => x.status === "todo").length;
    const stats = el("div", { class: "stat-row" });
    [["Logic functions", CATALOG.length], ["✓ Wired", wired], ["◷ TODO", todo]].forEach(([l, v]) =>
      stats.appendChild(el("div", { class: "stat" }, [el("div", { class: "v", text: String(v) }), el("div", { class: "l", text: l })])));
    pad.appendChild(stats);

    // filters
    const featureSet = ["all", ...Array.from(new Set(CATALOG.map(x => x.feature).filter(Boolean)))];
    const toolbar = el("div", { class: "logic-toolbar" });
    toolbar.appendChild(el("span", { class: "flabel", text: "Status" }));
    [["all", "All"], ["wired", "✓ Wired"], ["todo", "◷ TODO"]].forEach(([k, lbl]) => {
      toolbar.appendChild(el("button", { class: "logicfilter" + (filters.status === k ? " active" : ""), "data-status": k, onclick: () => setStatus(k) }, [
        document.createTextNode(lbl),
        el("span", { class: "ct", text: k === "all" ? String(CATALOG.length) : String(CATALOG.filter(x => (k === "todo" ? x.status === "todo" : x.status !== "todo")).length) })
      ]));
    });
    toolbar.appendChild(el("span", { class: "lens-sep", style: "height:20px" }));
    toolbar.appendChild(el("span", { class: "flabel", text: "Feature" }));
    featureSet.forEach(f => {
      toolbar.appendChild(el("button", { class: "logicfilter" + (filters.feature === f ? " active" : ""), "data-feature": f, onclick: () => setFeature(f), text: f === "all" ? "All" : f }));
    });
    pad.appendChild(toolbar);

    const groupsWrap = el("div", {});
    pad.appendChild(groupsWrap);
    host.appendChild(pad);

    function renderGroups() {
      groupsWrap.innerHTML = "";
      KIND_ORDER.forEach(kind => {
        let items = CATALOG.filter(x => x.kind === kind);
        if (filters.status !== "all") items = items.filter(x => filters.status === "todo" ? x.status === "todo" : x.status !== "todo");
        if (filters.feature !== "all") items = items.filter(x => x.feature === filters.feature);
        if (!items.length) return;
        const g = el("div", { class: "logic-group" });
        g.appendChild(el("div", { class: "lg-head" }, [
          el("span", { class: "lg-title", text: KIND_LABELS[kind].label }),
          el("span", { class: "lg-sub", text: items.length + " · " + KIND_LABELS[kind].sub })
        ]));
        const grid = el("div", { class: "logic-grid" });
        items.forEach(x => grid.appendChild(logicCard(x)));
        g.appendChild(grid);
        groupsWrap.appendChild(g);
      });
      if (!groupsWrap.children.length) groupsWrap.appendChild(el("p", { class: "feat-summary", text: "No logic functions match these filters." }));
    }
    function setStatus(k) { filters.status = k; toolbar.querySelectorAll("[data-status]").forEach(b => b.classList.toggle("active", b.getAttribute("data-status") === k)); renderGroups(); }
    function setFeature(f) { filters.feature = f; toolbar.querySelectorAll("[data-feature]").forEach(b => b.classList.toggle("active", b.getAttribute("data-feature") === f)); renderGroups(); }
    renderGroups();
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.logic = { render };
})();
