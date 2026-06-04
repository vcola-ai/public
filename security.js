/* ============================================================
   TPS Spec Visualizer — Security view (roles × operations)
   ============================================================ */
(function () {
  const S = window.SPEC;
  const SEC = S.security;
  const { el } = window.UI;

  const sec = { filter: null }; // role id, relation id, or null (all)

  /* ---- auth evaluation: which roles / relations grant access ---- */
  function collect(node, out) {
    if (!node) return;
    if (node.role) out.roles.add(node.role);
    if (node.relation) out.relations.add(node.relation);
    if (node.anyOf) node.anyOf.forEach(n => collect(n, out));
    if (node.allOf) node.allOf.forEach(n => collect(n, out));
  }
  function grantsFor(auth) {
    const out = { roles: new Set(), relations: new Set() };
    collect(auth, out);
    return out;
  }
  // SUPER_ADMIN is an implicit superuser across everything
  function roleGranted(op, role) {
    const g = grantsFor(op.auth);
    if (g.roles.has(role)) return true;
    return false;
  }

  /* ---- auth tree renderer (drawer) ---- */
  function authNode(node) {
    if (node.anyOf || node.allOf) {
      const comp = node.anyOf ? "anyOf" : "allOf";
      const arr = node.anyOf || node.allOf;
      const wrap = el("div", { class: "authnode" });
      wrap.appendChild(el("span", { class: "comp", text: comp + (comp === "anyOf" ? "  (any one grants)" : "  (all required)") }));
      const ch = el("div", { class: "children" });
      arr.forEach(n => ch.appendChild(authNode(n)));
      wrap.appendChild(ch);
      return wrap;
    }
    // leaf
    if (node.role) {
      return el("div", { class: "authnode" }, el("span", { class: "authleaf" + (node.diff === "added" ? " added" : "") }, [
        el("span", { class: "lk role", text: "role" }),
        el("span", { class: "mono", text: node.role }),
        node.diff === "added" ? el("span", { class: "plus", text: "＋ new" }) : null
      ]));
    }
    if (node.relation) {
      const rel = SEC.relations.find(r => r.id === node.relation);
      return el("div", { class: "authnode" }, el("span", { class: "authleaf" + (node.diff === "added" ? " added" : "") }, [
        el("span", { class: "lk relation", text: "relation" }),
        el("span", { class: "mono", text: rel ? rel.label : node.relation }),
        node.diff === "added" ? el("span", { class: "plus", text: "＋ new" }) : null
      ]));
    }
    return el("div", {});
  }

  // concise, factual operation intents (drawer detail)
  const OP_DESC = {
    bootstrapIrishPayrollSystem: "One-time setup of the Irish payroll system for a tenant — seeds configuration, PRSI/USC bands, and Revenue/NAERSA integration settings.",
    createGlobalEmployeeProfile: "Create the country-agnostic employee profile (the shared identity record).",
    createIrishEmployeeProfile: "Create the Ireland-specific payroll profile for an employee (PPSN, PRSI class, bank details).",
    updateGlobalEmployeeProfile: "Update fields on the shared employee profile.",
    updateIrishEmployeeProfile: "Update the Ireland-specific payroll profile — e.g. correct a PRSI class or IBAN before a resubmission.",
    updateUsEmployeeProfile: "Update the US-specific payroll profile.",
    getEmployeeCountryProfile: "Fetch the country-specific payroll profile for an employee.",
    getEmployeePaySlips: "List an employee's payslips — the IrishPayrollResult records produced by a pay run.",
    getPayRunSummary: "Summary figures for a pay run: totals, employee counts, and external-submission status.",
    getPayrollReadiness: "Pre-flight check that a pay run is ready to calculate or submit (missing data, validation issues).",
    listAllPayRuns: "List pay runs across legal entities for the payroll team.",
    lookupEmployeeByCode: "Resolve an employee by their payroll / employee code.",
    applyPsrSubmissionResponse: "Ingest Revenue's PSR response and apply it to the submission record — drives the routePsrAck branch in the workflow."
  };
  const OP_RELATED = {
    applyPsrSubmissionResponse: { wf: "routePsrAck", label: "Used by SUBMITTING_REVENUE → routePsrAck" },
    getPayRunSummary: { entity: "PayRun" },
    listAllPayRuns: { entity: "PayRun" },
    getEmployeePaySlips: { entity: "IrishPayrollResult" }
  };

  function openOpDrawer(op) {
    const sections = [];
    const isTodo = op.status === "todo";
    sections.push({
      node: el("div", {}, [
        el("div", { class: "state-meta" }, [
          el("span", { class: "chip kind-" + op.kind, text: op.kind }),
          el("span", { class: "chip mono", text: op.feature }),
          el("span", { class: "statind " + (isTodo ? "todo" : "wired") }, [
            el("span", { class: "g", text: isTodo ? "◷" : "✓" }), isTodo ? "TODO" : "wired"
          ])
        ]),
        op.intent ? el("div", { class: "intent-text", style: "margin-top:9px" }, [
          el("div", { style: "font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--muted);margin-bottom:5px", text: "Implementation intent" }),
          document.createTextNode(op.intent)
        ]) : null
      ])
    });
    sections.push({ lbl: "Authorization rule", node: el("div", { class: "authtree" }, authNode(op.auth)) });

    // diff
    const dany = window.UI.diffByTarget(op.name);
    if (dany) sections.push({ node: window.UI.diffBox(dany) });

    // who can do this — plain english
    const g = grantsFor(op.auth);
    const who = el("div", {});
    const roleChips = el("div", { class: "pill-grid", style: "margin-bottom:8px" });
    [...g.roles].forEach(r => roleChips.appendChild(el("span", { class: "chip role mono", text: r })));
    if (g.roles.size) who.appendChild(roleChips);
    if (g.relations.size) {
      const rc = el("div", { class: "pill-grid" });
      [...g.relations].forEach(rid => {
        const rel = SEC.relations.find(r => r.id === rid);
        rc.appendChild(el("span", { class: "chip relation", title: rel.note, text: rel.label }));
      });
      who.appendChild(rc);
    }
    sections.push({ lbl: "Who can do this", node: who });

    // related context + cross-links
    const rel = OP_RELATED[op.name];
    const links = el("div", { class: "pill-grid" });
    links.appendChild(el("button", { class: "scenario", text: "Open in Security matrix →", onclick: () => window.APP.go("security") }));
    links.appendChild(el("button", { class: "scenario", text: "View logic →", onclick: () => { if (window.LOGIC_UI) window.LOGIC_UI.openLogicDrawer(op.name); else window.APP.go("logic"); } }));
    if (rel && rel.entity) links.appendChild(el("button", { class: "scenario", text: rel.entity + " entity →", onclick: () => window.APP.go("entities") }));
    if (rel && rel.wf) links.appendChild(el("button", { class: "scenario", text: "See in workflow →", onclick: () => window.APP.go("workflows") }));
    sections.push({ lbl: rel && rel.label ? rel.label : "Cross-references", node: links });

    window.UI.openDrawer({ id: "op:" + op.name, kicker: op.kind + " · authorization", title: op.name, sections });
  }
  window.SEC_UI = { openOpDrawer, authNode };

  /* ---- matrix ---- */
  function dot(kind) {
    return el("span", { class: "dot " + kind });
  }

  function render(host) {
    const pad = el("div", { class: "view-pad" });

    pad.appendChild(el("div", { class: "view-head" }, [
      el("div", { class: "eyebrow", text: "Security · priority area" }),
      el("h1", { text: "Who can do what" }),
      el("p", { class: "lead", text: "Every operation and CRUD-maintained entity carries an authorization rule built from roles, user→entity relations, and anyOf / allOf compositions. Filter by a role to see everything it can reach; click any operation for its full auth tree." })
    ]));

    // role filter
    const filters = el("div", { class: "sec-filters" });
    filters.appendChild(el("span", { class: "flabel", text: "Show access for" }));
    const allBtn = el("button", { class: "rolefilter active", text: "All", onclick: () => setFilter(null) });
    filters.appendChild(allBtn);
    SEC.roles.forEach(r => filters.appendChild(el("button", { class: "rolefilter", "data-role": r, text: r, onclick: () => setFilter(r) })));
    SEC.relations.forEach(rel => filters.appendChild(el("button", { class: "rolefilter relation", "data-rel": rel.id, text: rel.short, onclick: () => setFilter("rel:" + rel.id) })));
    pad.appendChild(filters);

    // matrix
    const wrap = el("div", { class: "matrix-wrap scroll" });
    const table = el("table", { class: "matrix" });

    const thead = el("thead");
    const hr = el("tr");
    hr.appendChild(el("th", { class: "op-col", text: "Operation" }));
    SEC.roles.forEach(r => hr.appendChild(el("th", { class: "role-col", "data-role": r, text: r })));
    SEC.relations.forEach(rel => hr.appendChild(el("th", { class: "role-col relation", "data-rel": rel.id, title: rel.note, text: rel.short })));
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = el("tbody");

    function opRow(op) {
      const tr = el("tr", { "data-op": op.name });
      const g = grantsFor(op.auth);
      // op cell
      const nameEl = el("span", { class: "opname", onclick: () => openOpDrawer(op) }, [
        document.createTextNode(op.name),
        op.diff ? el("span", { class: "dchip yellow", text: "changed" }) : null
      ]);
      const cell = el("td", { class: "op-cell" }, [nameEl, el("div", { class: "ometa", text: op.kind })]);
      tr.appendChild(cell);
      // role cells
      SEC.roles.forEach(r => {
        const granted = g.roles.has(r) || r === "SUPER_ADMIN" && false; // explicit only
        const td = el("td", { class: "grant", "data-col": r });
        if (granted) td.appendChild(dot("role"));
        tr.appendChild(td);
      });
      // relation cells
      SEC.relations.forEach(rel => {
        const granted = g.relations.has(rel.id);
        const td = el("td", { class: "grant", "data-col": "rel:" + rel.id });
        if (granted) {
          const isDiff = op.diff && rel.id === "manager" && op.name === "getEmployeePaySlips";
          const d = dot("relation");
          if (isDiff) { const w = el("span", { class: "cell-diff" }, d); td.appendChild(w); }
          else td.appendChild(d);
        }
        tr.appendChild(td);
      });
      tr.dataset.roles = [...g.roles].join(",");
      tr.dataset.rels = [...g.relations].join(",");
      return tr;
    }

    // group: mutations, queries
    const muts = SEC.operations.filter(o => o.kind === "mutation");
    const queries = SEC.operations.filter(o => o.kind === "query");
    function groupHead(label) {
      const tr = el("tr", { class: "group-head" });
      tr.appendChild(el("td", { colspan: 1 + SEC.roles.length + SEC.relations.length, text: label }));
      return tr;
    }
    tbody.appendChild(groupHead("Mutations"));
    muts.forEach(o => tbody.appendChild(opRow(o)));
    tbody.appendChild(groupHead("Queries"));
    queries.forEach(o => tbody.appendChild(opRow(o)));

    // CRUD maintainers
    tbody.appendChild(groupHead("CRUD reference-entity maintainers (maintainableBy)"));
    SEC.maintainers.forEach(m => {
      const tr = el("tr", { "data-op": m.entity });
      const nameEl = el("span", { class: "opname", onclick: () => openMaintainerDrawer(m) }, [
        document.createTextNode(m.entity),
        m.singleton ? el("span", { class: "chip", style: "font-size:10px", text: "singleton" }) : null
      ]);
      tr.appendChild(el("td", { class: "op-cell" }, [nameEl, el("div", { class: "ometa", text: "reference entity" })]));
      SEC.roles.forEach(r => {
        const td = el("td", { class: "grant", "data-col": r });
        if (m.role === r) td.appendChild(dot("role"));
        tr.appendChild(td);
      });
      SEC.relations.forEach(rel => tr.appendChild(el("td", { class: "grant", "data-col": "rel:" + rel.id })));
      tr.dataset.roles = m.role;
      tr.dataset.rels = "";
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    pad.appendChild(wrap);

    // key
    pad.appendChild(el("div", { class: "sec-key" }, [
      el("span", { class: "k" }, [dot("role"), "role gate — anyone with the role"]),
      el("span", { class: "k" }, [dot("relation"), "relation gate — self / manager traversal"]),
      el("span", { class: "k" }, [el("span", { class: "cell-diff", style: "padding:3px 5px", html: "&nbsp;" }), "changed since last commit"])
    ]));

    // SUPER_ADMIN note + maintainer note
    pad.appendChild(el("p", { class: "feat-summary", style: "margin-top:18px;font-size:13px",
      html: "Relation gates (dashed, hollow) widen access beyond roles — an employee can always reach their own record, and (newly) a direct manager can view their reports' payslips. Roles in this product: " +
        SEC.roles.map(r => "<b class='mono'>" + r + "</b>").join(" · ") + "." }));

    host.appendChild(pad);

    function openMaintainerDrawer(m) {
      window.UI.openDrawer({
        id: "ent:" + m.entity, kicker: "CRUD reference entity", title: m.entity,
        sections: [
          { node: el("p", { html: "Maintained via <b class='mono'>maintainableBy</b> — create/update/delete is gated on a single role." + (m.singleton ? " This is a <b>singleton</b> configuration entity." : "") }) },
          { lbl: "maintainableBy", node: el("div", { class: "authtree" }, authNode({ role: m.role })) }
        ]
      });
    }

    function setFilter(f) {
      sec.filter = f;
      filters.querySelectorAll(".rolefilter").forEach(b => {
        const key = b.getAttribute("data-role") ? b.getAttribute("data-role")
          : b.getAttribute("data-rel") ? "rel:" + b.getAttribute("data-rel") : null;
        b.classList.toggle("active", key === f || (f === null && b.textContent === "All"));
      });
      // dim columns
      table.querySelectorAll("th.role-col").forEach(th => {
        const key = th.getAttribute("data-role") || ("rel:" + th.getAttribute("data-rel"));
        th.classList.toggle("dim", f !== null && key !== f);
      });
      table.querySelectorAll("td.grant").forEach(td => {
        const key = td.getAttribute("data-col");
        td.classList.toggle("dim", f !== null && key !== f);
      });
      // highlight / dim rows
      tbody.querySelectorAll("tr[data-op]").forEach(tr => {
        if (f === null) { tr.classList.remove("hi", "dimrow"); return; }
        let match = false;
        if (f.startsWith("rel:")) match = (tr.dataset.rels || "").split(",").includes(f.slice(4));
        else match = (tr.dataset.roles || "").split(",").includes(f);
        tr.classList.toggle("hi", match);
        tr.classList.toggle("dimrow", !match);
      });
    }
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.security = { render };
})();
