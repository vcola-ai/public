/* ============================================================
   TPS Spec Visualizer — Overview, Entities, Relationships,
   Operations, UI
   ============================================================ */
(function () {
  const S = window.SPEC;
  const { el } = window.UI;
  window.VIEWS = window.VIEWS || {};

  /* ============================================================
     OVERVIEW
     ============================================================ */
  function renderOverview(host) {
    const pad = el("div", { class: "view-pad" });
    pad.appendChild(el("div", { class: "view-head" }, [
      el("div", { class: "eyebrow", text: "Product · " + S.product.version }),
      el("h1", { text: S.product.name }),
      el("p", { class: "lead", text: S.product.summary })
    ]));

    // totals
    const tot = S.product.features.reduce((a, f) => ({
      entities: a.entities + f.entities, enums: a.enums + f.enums,
      mutations: a.mutations + f.mutations, queries: a.queries + f.queries, workflows: a.workflows + f.workflows
    }), { entities: 0, enums: 0, mutations: 0, queries: 0, workflows: 0 });
    const stats = el("div", { class: "stat-row" });
    [["Features", S.product.features.length], ["Entities", tot.entities], ["Enums", tot.enums],
     ["Mutations", tot.mutations], ["Queries", tot.queries], ["Workflows", tot.workflows]].forEach(([l, v]) => {
      stats.appendChild(el("div", { class: "stat" }, [el("div", { class: "v", text: String(v) }), el("div", { class: "l", text: l })]));
    });
    pad.appendChild(stats);

    // change digest
    pad.appendChild(el("h2", { class: "section", text: "What changed since last commit" }));
    pad.appendChild(el("p", { class: "feat-summary", style: "font-size:13.5px;margin-top:0",
      html: "Live diff against <b class='mono'>HEAD " + S.product.baseline + "</b>. <b style='color:var(--err)'>Red</b> landed in the most recent deploy; <b style='color:var(--warn)'>amber</b> is uncommitted drift. ⚠ marks breaking changes." }));
    const digest = el("div", { class: "digest" });
    S.diffs.forEach(d => {
      const item = el("div", { class: "digest-item", onclick: () => openDiffDrawer(d) });
      item.appendChild(el("div", { class: "stripe " + d.status }));
      item.appendChild(el("div", { class: "di-body" }, [
        el("div", { class: "di-title" }, [
          document.createTextNode(d.title),
          d.breaking ? el("span", { class: "dchip yellow", html: "⚠ breaking" }) : null
        ]),
        el("div", { class: "di-area", text: d.area + (d.status === "red" ? " · deployed just now" : d.status === "built" ? " · now implemented" : " · uncommitted") }),
        el("div", { class: "di-note", text: d.note })
      ]));
      digest.appendChild(item);
    });
    pad.appendChild(digest);

    // feature breakdown
    pad.appendChild(el("h2", { class: "section", text: "Feature breakdown" }));
    const tbl = el("table", { class: "tbl" });
    const thead = el("thead", {}, el("tr", {}, [
      el("th", { text: "Feature" }), el("th", { class: "num", text: "Entities" }), el("th", { class: "num", text: "Enums" }),
      el("th", { class: "num", text: "Mutations" }), el("th", { class: "num", text: "Queries" }), el("th", { class: "num", text: "Workflows" })
    ]));
    tbl.appendChild(thead);
    const tb = el("tbody");
    S.product.features.forEach(f => {
      tb.appendChild(el("tr", {}, [
        el("td", {}, el("span", { class: "mono", text: f.name })),
        el("td", { class: "num", text: f.entities }), el("td", { class: "num", text: f.enums }),
        el("td", { class: "num", text: f.mutations }), el("td", { class: "num", text: f.queries }),
        el("td", { class: "num", html: f.workflows ? "<b>" + f.workflows + "</b>" : "<span style='color:var(--faint)'>0</span>" })
      ]));
    });
    tbl.appendChild(tb);
    pad.appendChild(tbl);
    host.appendChild(pad);
  }

  function openDiffDrawer(d) {
    window.UI.openDrawer({
      id: "diff:" + d.id, kicker: "Change · " + d.area, title: d.title,
      sections: [
        { node: el("p", { html: "Target: <b class='mono'>" + d.target + "</b>" }) },
        { node: window.UI.diffBox(d) },
        { node: el("p", { class: "feat-summary", style: "font-size:12.5px",
          html: "Jump to <b>" + d.area + "</b> in the navigator to see this change in context." }) }
      ]
    });
  }

  /* ============================================================
     ENTITIES
     ============================================================ */
  function typeLabel(f) {
    if (f.type === "reference") return "reference → " + f.target;
    if (f.type === "enum") return "enum " + (f.enumName || "");
    return f.type;
  }
  function openFieldDrawer(entity, f) {
    const sections = [];
    sections.push({ node: el("div", { class: "state-meta" }, [
      el("span", { class: "chip mono", text: f.type }),
      el("span", { class: "chip", text: f.nullable ? "nullable" : "required" }),
      f.card ? el("span", { class: "chip mono", text: f.card }) : null
    ]) });
    const dl = el("div", {});
    dl.appendChild(el("p", { html: "Field on <b class='mono'>" + entity.name + "</b>." }));
    if (f.type === "reference") dl.appendChild(el("p", { html: "References <b class='mono'>" + f.target + "</b> with cardinality <b class='mono'>" + f.card + "</b>." }));
    if (f.type === "enum") dl.appendChild(el("p", { html: "Enum <b class='mono'>" + f.enumName + "</b>" + (f.enumVals ? " — values: <span class='mono'>" + f.enumVals + "</span>" : "") + "." }));
    if (f.group) dl.appendChild(el("p", { html: "Part of the <b>" + f.group + "</b> group." }));
    sections.push({ node: dl });
    const d = window.UI.diffByTarget(entity.name + "." + f.name);
    if (d) sections.push({ node: window.UI.diffBox(d) });
    window.UI.openDrawer({ id: "field:" + entity.name + "." + f.name, kicker: "Field · " + entity.name, title: f.name, sections });
  }

  function entityCard(e) {
    const card = el("div", { class: "entity-card" });
    card.appendChild(el("div", { class: "ec-head" }, [
      el("span", { class: "ec-name", text: e.name }),
      el("span", { class: "chip", text: e.kind }),
      el("span", { class: "ec-role", text: e.role })
    ]));
    const body = el("div", { class: "ec-body" });
    let lastGroup = null;
    e.fields.forEach(f => {
      if (f.group && f.group !== lastGroup) {
        body.appendChild(el("div", { class: "field-group-label", text: f.group + "s" }));
        lastGroup = f.group;
      } else if (!f.group) { lastGroup = null; }
      const fd = window.UI.diffByTarget(e.name + "." + f.name);
      const row = el("div", { class: "field" + (fd && window.UI.diffOn ? " diff-yellow" : (fd ? " diff-yellow" : "")), onclick: () => openFieldDrawer(e, f) }, [
        el("span", { class: "fn" }, [document.createTextNode(f.name), fd ? el("span", { class: "dchip yellow", style: "margin-left:7px", text: "changed" }) : null]),
        el("span", { class: "ft", text: typeLabel(f) }),
        el("span", { class: "fmeta" }, [
          f.card ? el("span", { class: "ref", text: f.card }) : null,
          el("span", { class: "nullable", text: f.nullable ? "nullable" : "required" })
        ])
      ]);
      body.appendChild(row);
    });
    card.appendChild(body);
    return card;
  }

  function renderEntities(host) {
    const pad = el("div", { class: "view-pad" });
    pad.appendChild(el("div", { class: "view-head" }, [
      el("div", { class: "eyebrow", text: "Data model" }),
      el("h1", { text: "Entities & Data" }),
      el("p", { class: "lead", text: "Entities have typed fields — scalars and references to other entities (with cardinality). Reference fields imply edges in the Relationships graph. Click any field for detail." })
    ]));
    pad.appendChild(el("h2", { class: "section", text: "Detailed entities" }));
    const cards = el("div", { class: "cards" });
    S.entities.forEach(e => cards.appendChild(entityCard(e)));
    pad.appendChild(cards);

    pad.appendChild(el("h2", { class: "section", text: "Other entities" }));
    pad.appendChild(el("p", { class: "feat-summary", style: "font-size:13px;margin-top:0", text: "Referenced across the spec — field-level detail not expanded in this iteration." }));
    const grid = el("div", { class: "pill-grid" });
    S.otherEntities.forEach(n => grid.appendChild(el("span", { class: "eref", text: n })));
    pad.appendChild(grid);
    host.appendChild(pad);
  }

  /* ============================================================
     RELATIONSHIPS — small graph of detailed entities
     ============================================================ */
  function renderRelationships(host) {
    const pad = el("div", { class: "view-pad" });
    pad.appendChild(el("div", { class: "view-head" }, [
      el("div", { class: "eyebrow", text: "References" }),
      el("h1", { text: "Relationships" }),
      el("p", { class: "lead", text: "Reference fields between entities, with cardinality. Solid nodes are detailed entities; dashed nodes are referenced but not yet expanded." })
    ]));

    // nodes
    const N = {
      PayRun: { x: 250, y: 40, w: 150, det: true },
      IrishPayrollResult: { x: 60, y: 200, w: 180, det: true },
      IrishEmployeeProfile: { x: 470, y: 200, w: 180, det: true },
      Employee: { x: 250, y: 200, w: 130, det: false },
      LegalEntity: { x: 250, y: 330, w: 130, det: false }
    };
    const edges = [
      ["PayRun", "LegalEntity", "EXACTLY_ONE", "legalEntity"],
      ["PayRun", "Employee", "EXACTLY_ONE", "createdBy"],
      ["PayRun", "PayRun", "ZERO_OR_ONE", "correctedPayRun"],
      ["IrishPayrollResult", "Employee", "EXACTLY_ONE", "employee"],
      ["IrishPayrollResult", "PayRun", "EXACTLY_ONE", "payRun"],
      ["IrishEmployeeProfile", "Employee", "EXACTLY_ONE", "employee"],
      ["IrishEmployeeProfile", "LegalEntity", "EXACTLY_ONE", "legalEntity"]
    ];
    const W = 700, H = 400, NH = 42;
    const SVGNS = "http://www.w3.org/2000/svg";
    function sc(tag, a) { const n = document.createElementNS(SVGNS, tag); if (a) for (const k in a) n.setAttribute(k, a[k]); return n; }
    const svg = sc("svg", { viewBox: `0 0 ${W} ${H}` });
    const defs = sc("defs");
    const m = sc("marker", { id: "rarr", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" });
    m.appendChild(sc("path", { d: "M0 0 L10 5 L0 10 z", fill: "#b3ae9f" })); defs.appendChild(m); svg.appendChild(defs);

    function center(id) { const n = N[id]; return [n.x + n.w / 2, n.y + NH / 2]; }
    edges.forEach(([a, b, card, fld]) => {
      const na = N[a], nb = N[b];
      let path, lx, ly;
      if (a === b) {
        // self loop (PayRun.correctedPayRun)
        const x = na.x + na.w, y = na.y + 10;
        path = `M ${x} ${y} C ${x + 60} ${y - 20} ${x + 60} ${y + 30} ${x} ${y + 28}`;
        lx = x + 52; ly = y + 6;
      } else {
        const [ax, ay] = center(a), [bx, by] = center(b);
        path = `M ${ax} ${ay} L ${bx} ${by}`;
        lx = (ax + bx) / 2; ly = (ay + by) / 2;
      }
      svg.appendChild(sc("path", { class: "redge", d: path, "marker-end": "url(#rarr)" }));
      const tw = (fld + " · " + card).length * 5.2 + 8;
      svg.appendChild(sc("rect", { class: "rcard-bg", x: lx - tw / 2, y: ly - 8, width: tw, height: 15, rx: 3 }));
      const t = sc("text", { class: "rcard", x: lx, y: ly + 3, "text-anchor": "middle" }); t.textContent = fld + " · " + card;
      svg.appendChild(t);
    });
    Object.keys(N).forEach(id => {
      const n = N[id];
      const g = sc("g", { class: "rnode" + (n.det ? "" : " ext") });
      g.appendChild(sc("rect", { x: n.x, y: n.y, width: n.w, height: NH, rx: 7 }));
      const t = sc("text", { x: n.x + n.w / 2, y: n.y + NH / 2 + 1 }); t.textContent = id;
      g.appendChild(t);
      if (n.det) g.style.cursor = "pointer", g.addEventListener("click", () => window.APP.go("entities"));
      svg.appendChild(g);
    });

    const graph = el("div", { class: "rel-graph" });
    graph.appendChild(svg);
    pad.appendChild(graph);
    pad.appendChild(el("p", { class: "feat-summary", style: "font-size:13px", html: "Cardinalities: <b class='mono'>EXACTLY_ONE</b>, <b class='mono'>ZERO_OR_ONE</b>, <b class='mono'>ZERO_OR_MANY</b>. This iteration graphs the three detailed entities and their direct references; the full cross-feature graph is future work." }));
    host.appendChild(pad);
  }

  /* ============================================================
     OPERATIONS
     ============================================================ */
  function renderOperations(host) {
    const pad = el("div", { class: "view-pad" });
    pad.appendChild(el("div", { class: "view-head" }, [
      el("div", { class: "eyebrow", text: "Queries & mutations" }),
      el("h1", { text: "Operations" }),
      el("p", { class: "lead", text: "Queries read the data model; mutations change it. Each carries an authorization rule and an implementation status. Click a row for its intent, auth tree, and references." })
    ]));

    const counts = S.product.features.reduce((a, f) => ({ m: a.m + f.mutations, q: a.q + f.queries }), { m: 0, q: 0 });
    const stats = el("div", { class: "stat-row" });
    [["Mutations", counts.m], ["Queries", counts.q], ["With explicit auth shown", S.security.operations.length]].forEach(([l, v]) =>
      stats.appendChild(el("div", { class: "stat" }, [el("div", { class: "v", text: String(v) }), el("div", { class: "l", text: l })])));
    pad.appendChild(stats);

    pad.appendChild(el("h2", { class: "section", text: "Operations with documented authorization" }));
    const tbl = el("table", { class: "tbl" });
    tbl.appendChild(el("thead", {}, el("tr", {}, [
      el("th", { text: "Operation" }), el("th", { text: "Kind" }), el("th", { text: "Status" }), el("th", { text: "Feature" }), el("th", { text: "" })
    ])));
    const tb = el("tbody");
    S.security.operations.forEach(op => {
      const isTodo = op.status === "todo";
      const tr = el("tr", { class: "clickable" + (isTodo ? " s-todo" : ""), onclick: () => window.SEC_UI.openOpDrawer(op) }, [
        el("td", {}, [
          el("span", { class: "mono", text: op.name }),
          el("div", { class: "ometa", style: "font-size:11.5px;color:var(--faint);margin-top:3px;max-width:46ch", text: op.intent || "" })
        ]),
        el("td", {}, el("span", { class: "chip kind-" + op.kind, text: op.kind })),
        el("td", {}, el("span", { class: "statind " + (isTodo ? "todo" : "wired") }, [el("span", { class: "g", text: isTodo ? "◷" : "✓" }), isTodo ? "TODO" : "wired"])),
        el("td", {}, el("span", { class: "mono", style: "font-size:12px;color:var(--muted)", text: op.feature })),
        el("td", {}, op.diff ? el("span", { class: "dchip yellow", text: "changed" }) : (window.UI.diffByTarget(op.name) ? el("span", { class: "dchip " + window.UI.diffByTarget(op.name).status, text: window.UI.diffByTarget(op.name).status === "built" ? "now built" : "new" }) : null))
      ]);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    pad.appendChild(tbl);

    pad.appendChild(el("div", { class: "placeholder", style: "margin-top:24px" }, [
      el("span", { class: "ph-tag", text: "Placeholder" }),
      el("p", { class: "feat-summary", style: "margin:0;font-size:13.5px", html: "The full operation explorer — argument shapes, return types, and per-operation implementation intent for all <b>27 mutations</b> and <b>30 queries</b> — slots in here. This iteration surfaces the operations whose authorization is documented." })
    ]));
    host.appendChild(pad);
  }

  /* ============================================================
     UI (placeholder)
     ============================================================ */
  function renderUI(host) {
    const pad = el("div", { class: "view-pad" });
    pad.appendChild(el("div", { class: "view-head" }, [
      el("div", { class: "eyebrow", text: "Presentation" }),
      el("h1", { text: "UI" }),
      el("p", { class: "lead", text: "Pages and components generated from the spec. This area is a placeholder in the current iteration — it shows where the page/component tree will slot into the shell." })
    ]));
    const ph = el("div", { class: "placeholder" });
    ph.appendChild(el("span", { class: "ph-tag", text: "Placeholder — not in this iteration" }));
    ph.appendChild(el("p", { class: "feat-summary", style: "margin:0 0 6px;font-size:13.5px", text: "Pages, layouts, and the component hierarchy will render here — navigable the same way as the other areas, with the diff overlay and detail drawer applying to page and component nodes." }));
    const grid = el("div", { class: "skeleton-grid" });
    for (let i = 0; i < 8; i++) grid.appendChild(el("div", { class: "sk" }));
    ph.appendChild(grid);
    pad.appendChild(ph);
    host.appendChild(pad);
  }

  window.VIEWS.overview = { render: renderOverview };
  window.VIEWS.entities = { render: renderEntities };
  window.VIEWS.relationships = { render: renderRelationships };
  window.VIEWS.operations = { render: renderOperations };
  window.VIEWS.ui = { render: renderUI };
})();
