/* ============================================================
   TPS Spec Visualizer — Workflow Explorer (PayRun)
   ============================================================ */
(function () {
  const S = window.SPEC;
  const WF = S.workflow;
  const { el } = window.UI;
  const SVGNS = "http://www.w3.org/2000/svg";
  const DIA = 23;                 // diamond half-size
  const SVGW = 648, SVGH = WF.svg.h;

  // ---- module state ----
  const wf = {
    cur: WF.initial,
    selected: WF.initial,
    trail: [{ id: WF.initial, via: null, viaKind: null }],
    hiEdge: null,
    view: { s: 1, tx: 0, ty: 0 },
    svg: null, vp: null, stage: null, trailEl: null, host: null
  };

  function sn(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function diaBox(d) {
    return { cx: d.cx, cy: d.cy, x: d.cx - DIA, y: d.cy - DIA, w: DIA * 2, h: DIA * 2 };
  }
  const anchor = {
    bottom: b => [b.cx, b.y + b.h], top: b => [b.cx, b.y],
    left: b => [b.x, b.cy], right: b => [b.x + b.w, b.cy]
  };

  /* ============================================================
     Build edge list (with fromId/toId for path highlighting)
     ============================================================ */
  function buildEdges() {
    const E = [];
    function add(e) { e.id = "e" + E.length; E.push(e); return e; }

    Object.keys(WF.states).forEach(sid => {
      const st = WF.states[sid];
      (st.t || []).forEach(t => {
        if (t.self) { add({ fromId: sid, toId: sid, cat: "self", who: t.who, label: null, todo: t.status === "todo" }); return; }
        if (t.dynamic) {
          const rname = t.to.slice(1);
          add({ fromId: sid, toId: "dia:" + rname, cat: "fwd", who: t.who, async: t.who === "system", label: null, todo: t.status === "todo" });
          return;
        }
        add({ fromId: sid, toId: t.to, cat: null, who: t.who, label: t.action, todo: t.status === "todo" });
      });
    });
    Object.keys(WF.routes).forEach(rname => {
      const r = WF.routes[rname];
      r.branches.forEach(br => {
        add({ fromId: "dia:" + rname, toId: br.to, cat: br.kind === "skip" ? "bypass" : null, branchKind: br.kind, label: br.cond });
      });
    });
    return E;
  }

  function boxOf(id) {
    if (id.startsWith("dia:")) return diaBox(WF.diamonds[id.slice(4)]);
    return WF.states[id].b;
  }

  function categorize(e) {
    if (e.cat) return e.cat;
    const fb = boxOf(e.fromId), tb = boxOf(e.toId);
    if (e.fromId === e.toId) return "self";
    if (e.toId === "DRAFT" && e.fromId !== "DRAFT") return "backTop";
    if (e.toId === "CANCELLED") return "toCancel";
    if (WF.states[e.toId] && WF.states[e.toId].col === "review") return "toReview";
    const fromReview = WF.states[e.fromId] && WF.states[e.fromId].col === "review";
    if (fromReview) return (tb.cy < fb.cy) ? "retryUp" : "ackDown";
    return "fwd";
  }

  /* ---- path string per category ---- */
  function pathFor(e) {
    const cat = categorize(e);
    const fb = boxOf(e.fromId), tb = boxOf(e.toId);
    const P = (x, y) => x.toFixed(1) + " " + y.toFixed(1);
    let d = "", lbl = null;
    switch (cat) {
      case "self": {
        const [rx, ry] = anchor.right(fb);
        d = `M ${P(rx, ry - 7)} C ${P(rx + 40, ry - 20)} ${P(rx + 40, ry + 20)} ${P(rx, ry + 7)}`;
        lbl = [rx + 30, ry];
        break;
      }
      case "fwd": {
        const [sx, sy] = anchor.bottom(fb), [tx, ty] = anchor.top(tb);
        if (Math.abs(sx - tx) < 1) { d = `M ${P(sx, sy)} L ${P(tx, ty)}`; lbl = [sx, (sy + ty) / 2]; }
        else { const my = (sy + ty) / 2; d = `M ${P(sx, sy)} C ${P(sx, my)} ${P(tx, my)} ${P(tx, ty)}`; lbl = [(sx + tx) / 2, my]; }
        break;
      }
      case "bypass": {
        const [sx, sy] = anchor.bottom(fb), [tx, ty] = anchor.top(tb);
        const bow = sx - 96;
        d = `M ${P(sx, sy)} C ${P(bow, sy + 36)} ${P(bow, ty - 36)} ${P(tx, ty)}`;
        lbl = [bow + 8, (sy + ty) / 2];
        break;
      }
      case "toReview": {
        const [sx, sy] = anchor.right(fb), [tx, ty] = anchor.left(tb);
        const cmx = (sx + tx) / 2;
        d = `M ${P(sx, sy)} C ${P(cmx, sy)} ${P(cmx, ty)} ${P(tx, ty)}`;
        lbl = [cmx, (sy + ty) / 2 - 2];
        break;
      }
      case "toCancel": {
        const [sx, sy] = anchor.left(fb), [tx, ty] = anchor.right(tb);
        const mx = Math.min(sx, tx) - 34;
        d = `M ${P(sx, sy)} C ${P(mx, sy)} ${P(mx, ty)} ${P(tx, ty)}`;
        lbl = [mx, (sy + ty) / 2];
        break;
      }
      case "retryUp": {
        const [sx, sy] = anchor.left(fb), [tx, ty] = anchor.right(tb);
        d = `M ${P(sx, sy)} C ${P(sx - 26, sy - 24)} ${P(tx + 44, ty + 6)} ${P(tx, ty)}`;
        break;
      }
      case "ackDown": {
        const [sx, sy] = anchor.left(fb), [tx, ty] = anchor.right(tb);
        d = `M ${P(sx, sy)} C ${P(sx - 26, sy + 24)} ${P(tx + 44, ty - 6)} ${P(tx, ty)}`;
        break;
      }
      case "backTop": {
        const dr = boxOf("DRAFT");
        if (WF.states[e.fromId] && WF.states[e.fromId].col === "review") {
          // far-right channel
          const idx = ["NAERSA_NEEDS_REVIEW", "REVENUE_NEEDS_REVIEW", "PSR_VERIFICATION_NEEDS_REVIEW", "BANK_NEEDS_REVIEW"].indexOf(e.fromId);
          const chx = SVGW - 8 - (3 - (idx < 0 ? 0 : idx)) * 9;
          const [sx, sy] = anchor.right(fb);
          const [tx, ty] = anchor.right(dr);
          d = `M ${P(sx, sy)} H ${chx} V ${ty.toFixed(1)} H ${tx.toFixed(1)}`;
        } else {
          // left channel for recalc/reject/reprepare
          const order = ["AEPN_REVIEW", "CALCULATED", "APPROVAL_PENDING"];
          const idx = order.indexOf(e.fromId);
          const chx = 150 - (idx < 0 ? 0 : idx) * 0; // single channel
          const [sx, sy] = anchor.left(fb);
          const [tx, ty] = anchor.left(dr);
          const mx = 148;
          d = `M ${P(sx, sy)} C ${P(mx, sy)} ${P(mx, ty + 6)} ${P(tx, ty)}`;
        }
        break;
      }
      default: {
        const [sx, sy] = anchor.bottom(fb), [tx, ty] = anchor.top(tb);
        d = `M ${P(sx, sy)} L ${P(tx, ty)}`;
      }
    }
    return { d, lbl, cat };
  }

  /* ============================================================
     Find active edges along the trail
     ============================================================ */
  function activeEdgeIds(edges) {
    const ids = new Set();
    for (let i = 1; i < wf.trail.length; i++) {
      const a = wf.trail[i - 1].id, b = wf.trail[i].id;
      // direct
      const direct = edges.find(e => e.fromId === a && e.toId === b);
      if (direct) { ids.add(direct.id); continue; }
      // via diamond
      let found = false;
      for (const e1 of edges) {
        if (e1.fromId === a && e1.toId.startsWith("dia:")) {
          const e2 = edges.find(e => e.fromId === e1.toId && e.toId === b);
          if (e2) { ids.add(e1.id); ids.add(e2.id); found = true; break; }
        }
      }
      if (found) continue;
      // self
      if (a === b) { const s = edges.find(e => e.fromId === a && e.toId === a); if (s) ids.add(s.id); }
    }
    return ids;
  }

  /* ============================================================
     Render diagram
     ============================================================ */
  function splitLabel(label) {
    if (label.length <= 15) return [label];
    const words = label.split(" ");
    if (words.length === 1) return [label];
    // break before "Needs" if present, else middle
    let bi = words.indexOf("Needs");
    if (bi < 1) bi = Math.ceil(words.length / 2);
    return [words.slice(0, bi).join(" "), words.slice(bi).join(" ")];
  }

  function nodeDiff(id) {
    return S.diffs.find(d => d.area === "workflows" && d.target === id) || null;
  }

  function buildDiagram() {
    const edges = buildEdges();
    const active = activeEdgeIds(edges);
    // highlight the currently-inspected transition's edge
    if (wf.hiEdge) {
      const he = edges.find(e => e.fromId === wf.hiEdge.fromId && e.toId === wf.hiEdge.toId);
      if (he) active.add(he.id);
    }

    const svg = sn("svg", { class: "diagram" });
    // defs markers
    const defs = sn("defs");
    [["arrow", "#b3ae9f"], ["arrow-active", "#2a6090"], ["arrow-recover", "#c46b1f"]].forEach(([id, col]) => {
      const m = sn("marker", { id, viewBox: "0 0 10 10", refX: 8.5, refY: 5, markerWidth: 6.5, markerHeight: 6.5, orient: "auto-start-reverse" });
      m.appendChild(sn("path", { d: "M0 0 L10 5 L0 10 z", fill: col }));
      defs.appendChild(m);
    });
    svg.appendChild(defs);

    const vp = sn("g", { id: "vp" });
    svg.appendChild(vp);

    // ---- edges layer ----
    const edgeLayer = sn("g");
    const labelLayer = sn("g");
    vp.appendChild(edgeLayer);

    edges.forEach(e => {
      const { d, lbl, cat } = pathFor(e);
      const isActive = active.has(e.id);
      const recover = (cat === "retryUp" || cat === "ackDown" || cat === "backTop");
      let cls = "edge";
      if (e.async) cls += " async";
      if (recover) cls += " recover faint";
      else if (cat === "self" || cat === "toCancel") cls += " faint";
      if (e.todo) cls += " todo";
      if (isActive) cls += " active" + (recover ? " recover" : "");
      const marker = isActive ? (recover ? "url(#arrow-recover)" : "url(#arrow-active)") : "url(#arrow)";
      const p = sn("path", { class: cls, d, "marker-end": marker });
      edgeLayer.appendChild(p);

      // labels: spine actions + branch conditions
      if (lbl && e.label && (cat === "fwd" || cat === "bypass" || cat === "toReview")) {
        const isCond = !!e.branchKind;
        const txt = e.label.length > 22 ? e.label.slice(0, 21) + "…" : e.label;
        const w = txt.length * 5.0 + 8;
        const g = sn("g");
        g.appendChild(sn("rect", { class: "elabel-bg", x: lbl[0] - w / 2, y: lbl[1] - 7, width: w, height: 14, rx: 4 }));
        const t = sn("text", { class: "elabel" + (isCond ? " branch-cond " + (e.branchKind === "ok" ? "ok" : (e.branchKind === "bad" ? "bad" : "")) : ""), x: lbl[0], y: lbl[1] + 3, "text-anchor": "middle" });
        t.textContent = txt;
        g.appendChild(t);
        labelLayer.appendChild(g);
      }
    });

    // ---- diamonds ----
    const diaLayer = sn("g");
    Object.keys(WF.diamonds).forEach(rname => {
      const d = WF.diamonds[rname];
      const g = sn("g", { class: "diamond", "data-dia": rname });
      const pts = `${d.cx},${d.cy - DIA} ${d.cx + DIA},${d.cy} ${d.cx},${d.cy + DIA} ${d.cx - DIA},${d.cy}`;
      g.appendChild(sn("polygon", { class: "dia-shape", points: pts }));
      // branch fork glyph (stem splitting into two)
      const fork = sn("path", {
        class: "dia-fork", fill: "none", stroke: "var(--accent)", "stroke-width": 1.6, "stroke-linecap": "round",
        d: `M ${d.cx} ${d.cy - 7} V ${d.cy - 1} M ${d.cx} ${d.cy - 1} L ${d.cx - 6} ${d.cy + 7} M ${d.cx} ${d.cy - 1} L ${d.cx + 6} ${d.cy + 7}`
      });
      g.appendChild(fork);
      // route-name label below the diamond
      const short = rname.replace(/^route/, "");
      const lw = short.length * 4.9 + 8;
      g.appendChild(sn("rect", { class: "dia-label-bg", x: d.cx - lw / 2, y: d.cy + DIA + 2, width: lw, height: 12, rx: 3 }));
      const lt = sn("text", { class: "dia-label", x: d.cx, y: d.cy + DIA + 11 }); lt.textContent = short;
      g.appendChild(lt);
      g.addEventListener("click", ev => { ev.stopPropagation(); inspectDiamond(rname); });
      if (wf.selected === "dia:" + rname) g.classList.add("selected");
      diaLayer.appendChild(g);
    });

    // ---- nodes ----
    const nodeLayer = sn("g");
    Object.keys(WF.states).forEach(sid => {
      const st = WF.states[sid], b = st.b;
      const g = sn("g", { class: "node kind-" + st.kind, "data-state": sid });
      const df = nodeDiff(sid);
      const rectCls = "node-box" + (df && window.UI.diffOn ? (df.status === "red" ? " diff-red" : " diff-yellow") : (df ? (df.status === "red" ? " diff-red" : " diff-yellow") : ""));
      const rect = sn("rect", { class: rectCls, x: b.x, y: b.y, width: b.w, height: b.h, rx: 7 });
      g.appendChild(rect);

      const lines = splitLabel(st.label);
      if (lines.length === 1) {
        const t1 = sn("text", { class: "node-label", x: b.cx, y: b.cy - 3 }); t1.textContent = st.label;
        g.appendChild(t1);
        const kindText = { wait: "wait", flight: "in-flight", review: "needs review", ok: "terminal ✓", cancel: "cancelled", term: "terminal" }[st.kind];
        const t2 = sn("text", { class: "node-kind", x: b.cx, y: b.cy + 11 }); t2.textContent = kindText;
        g.appendChild(t2);
      } else {
        const t1 = sn("text", { class: "node-label", x: b.cx, y: b.cy - 7 }); t1.textContent = lines[0];
        const t2 = sn("text", { class: "node-label", x: b.cx, y: b.cy + 7 }); t2.textContent = lines[1];
        g.appendChild(t1); g.appendChild(t2);
      }

      // diff marker
      if (df) {
        const mg = sn("g", { class: "diffmark" });
        const mt = sn("text", { x: b.x + b.w - 3, y: b.y + 11, "text-anchor": "end", fill: df.status === "red" ? "#b03030" : "#c46b1f" });
        mt.textContent = df.breaking ? "⚠" : "●";
        mg.appendChild(mt);
        g.appendChild(mg);
      }

      // status (TODO) marker — shown only under the status lens
      const hasTodo = (st.t || []).some(t => t.status === "todo");
      if (hasTodo) {
        g.classList.add("node-todo");
        const tg = sn("g", { class: "todomark" });
        const tt = sn("text", { x: b.x + 4, y: b.y + 12, "text-anchor": "start" });
        tt.textContent = "◷";
        tg.appendChild(tt);
        g.appendChild(tg);
      }

      // holding annotation for terminal dead-end states
      if (st.kind === "term") {
        const hn = sn("text", { class: "holding-note", x: b.cx, y: b.y + b.h + 11 });
        hn.textContent = "holding · no transitions in current spec";
        g.appendChild(hn);
      }

      if (sid === wf.cur) g.classList.add("current");
      if (sid === wf.selected && sid !== wf.cur) g.classList.add("selected");
      if (wf.trail.some(s => s.id === sid)) g.classList.add("visited");

      g.addEventListener("click", ev => { ev.stopPropagation(); jumpTo(sid); });
      nodeLayer.appendChild(g);
    });

    vp.appendChild(labelLayer);
    vp.appendChild(diaLayer);
    vp.appendChild(nodeLayer);

    svg.addEventListener("click", () => { /* background */ });
    return { svg, vp };
  }

  /* ============================================================
     Pan / zoom
     ============================================================ */
  function applyView() {
    if (!wf.vp) return;
    wf.vp.setAttribute("transform", `translate(${wf.view.tx} ${wf.view.ty}) scale(${wf.view.s})`);
  }
  function fitView() {
    const r = wf.stage.getBoundingClientRect();
    if (!r.width) return;
    const leftPad = 232;   // clear the floating legend
    const availW = r.width - leftPad - 16;
    // fit-width, left-aligned: pack the diagram against the legend, fill the rest
    const s = Math.min(availW / SVGW, 1.35);
    wf.view.s = s;
    wf.view.tx = leftPad;
    wf.view.ty = SVGH * s <= r.height ? (r.height - SVGH * s) / 2 : 14;
    applyView();
  }
  function fitAll() {
    const r = wf.stage.getBoundingClientRect();
    if (!r.width) return;
    const leftPad = 232;
    const availW = r.width - leftPad - 16;
    const s = Math.min(availW / SVGW, r.height / SVGH) * 0.96;
    wf.view.s = s;
    wf.view.tx = leftPad + Math.max(0, (availW - SVGW * s) / 2);
    wf.view.ty = (r.height - SVGH * s) / 2 < 8 ? 8 : (r.height - SVGH * s) / 2;
    applyView();
  }
  function focusState(id, animate) {
    const b = boxOf(id);
    const r = wf.stage.getBoundingClientRect();
    if (!r.width) return;
    const s = Math.max(wf.view.s, 0.7);
    wf.view.s = s;
    wf.view.tx = r.width / 2 - b.cx * s;
    wf.view.ty = r.height / 2 - b.cy * s;
    // clamp so we don't fly off the top
    if (wf.view.ty > 20) wf.view.ty = 20;
    if (wf.view.ty < r.height - SVGH * s - 20) wf.view.ty = r.height - SVGH * s - 20;
    if (animate && wf.vp) wf.vp.style.transition = "transform .4s cubic-bezier(.4,0,.2,1)";
    applyView();
    if (animate) setTimeout(() => { if (wf.vp) wf.vp.style.transition = ""; }, 420);
  }
  function bindPanZoom(svg) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
    svg.addEventListener("mousedown", e => {
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; ox = wf.view.tx; oy = wf.view.ty;
      svg.classList.add("grabbing");
    });
    window.addEventListener("mousemove", e => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      wf.view.tx = ox + dx; wf.view.ty = oy + dy; applyView();
    });
    window.addEventListener("mouseup", () => { dragging = false; svg.classList.remove("grabbing"); });
    svg.addEventListener("click", () => { if (!moved && window.UI) window.UI.closeDrawer(); });
    svg.addEventListener("wheel", e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const ns = Math.min(2.4, Math.max(0.3, wf.view.s * factor));
      const k = ns / wf.view.s;
      wf.view.tx = mx - (mx - wf.view.tx) * k;
      wf.view.ty = my - (my - wf.view.ty) * k;
      wf.view.s = ns; applyView();
    }, { passive: false });
  }
  function zoom(factor) {
    const r = wf.stage.getBoundingClientRect();
    const mx = r.width / 2, my = r.height / 2;
    const ns = Math.min(2.4, Math.max(0.3, wf.view.s * factor));
    const k = ns / wf.view.s;
    wf.view.tx = mx - (mx - wf.view.tx) * k;
    wf.view.ty = my - (my - wf.view.ty) * k;
    wf.view.s = ns; applyView();
  }

  /* ============================================================
     Simulator actions
     ============================================================ */
  function jumpTo(id) {
    wf.cur = id; wf.selected = id; wf.hiEdge = null;
    wf.trail = [{ id, via: null, viaKind: null }];
    redraw();
    inspectState(id);
    focusState(id, true);
  }
  function doAdvance(toId, via, viaKind) {
    wf.trail.push({ id: toId, via, viaKind });
    wf.cur = toId; wf.selected = toId; wf.hiEdge = null;
    redraw();
    inspectState(toId);
    focusState(toId, true);
  }
  function reset() {
    jumpTo(WF.initial);
    fitView();
  }

  /* ============================================================
     Drawer rendering (state / diamond)
     ============================================================ */
  /* ---- transition (mutation) metadata ---- */
  const TXN_META = {
    createPayRun: {
      start: true, auth: { role: "PAYROLL_ADMIN" },
      payload: [
        { name: "createdBy", type: "EntityReference<Employee>" },
        { name: "legalEntity", type: "EntityReference<LegalEntity>" },
        { name: "payPeriodStart", type: "LocalDate" },
        { name: "payPeriodEnd", type: "LocalDate" },
        { name: "payDate", type: "LocalDate" },
        { name: "payFrequency", type: "PayFrequency" },
        { name: "notes", type: "String?" }
      ],
      intent: "Create a PayRun entity in DRAFT state."
    },
    createCorrectionPayRun: {
      start: true, auth: { role: "PAYROLL_ADMIN" },
      payload: [
        { name: "createdBy", type: "EntityReference<Employee>" },
        { name: "legalEntity", type: "EntityReference<LegalEntity>" },
        { name: "correctedPayRun", type: "EntityReference<PayRun>" },
        { name: "correctionReason", type: "String" },
        { name: "payPeriodStart", type: "LocalDate" },
        { name: "payPeriodEnd", type: "LocalDate" },
        { name: "payDate", type: "LocalDate" },
        { name: "payFrequency", type: "PayFrequency" }
      ],
      intent: "Create a correction PayRun (payRunType = CORRECTION) linked to a prior run, in DRAFT state."
    },
    submitForApproval: { intent: "Validate PaySlip records exist, advance to APPROVAL_PENDING." },
    approvePayRun: { auth: { role: "CONTROLLER" }, payload: [{ name: "payRun", type: "EntityReference<PayRun>" }, { name: "comments", type: "String?" }], intent: "Controller approves — store comments on notes." },
    rejectPayRun: { auth: { role: "CONTROLLER" }, payload: [{ name: "payRun", type: "EntityReference<PayRun>" }, { name: "reason", type: "String" }], intent: "Controller rejects to DRAFT — wipes calc artifacts, stores reason." },
    submitToNaersa: { intent: "If ≥1 IrishPayrollResult has non-zero AE contributions, fire SubmitContributionsAsync. Idempotent." },
    acknowledgeAndProceedFromNaersa: { payload: [{ name: "payRun", type: "EntityReference<PayRun>" }, { name: "note", type: "String" }], intent: "Operator confirms NAERSA resolution; advance to NAERSA_ACCEPTED." }
  };

  function transitionMeta(fromId, t) {
    const ov = TXN_META[t.action] || {};
    const who = t.who || "operator";
    const auth = ov.auth || (who === "controller" ? { role: "CONTROLLER" } : (who === "system" ? null : { role: "PAYROLL_ADMIN" }));
    let payload = ov.payload;
    if (!payload) {
      payload = [{ name: "payRun", type: "EntityReference<PayRun>" }];
      if (/^acknowledge/.test(t.action) || /^restartFromCalc/.test(t.action)) payload.push({ name: "note", type: "String" });
    }
    return {
      mutation: t.action, who, auth, payload,
      intent: ov.intent || t.note || "—",
      status: t.status === "todo" ? "todo" : "wired",
      dynamic: !!t.dynamic, routeName: t.dynamic ? t.to.slice(1) : null,
      self: !!t.self, to: t.to, start: !!ov.start
    };
  }

  function authChips(auth, who) {
    if (who === "system" || !auth)
      return el("p", { class: "mono", style: "color:var(--muted);font-size:12px;margin:0", text: "system / async — fired automatically, no operator authorization" });
    if (window.SEC_UI && window.SEC_UI.authNode) return el("div", { class: "authtree" }, window.SEC_UI.authNode(auth));
    return el("span", { class: "chip role mono", text: auth.role || "—" });
  }

  // a clickable transition row that INSPECTS (never advances)
  function actionButton(fromId, t) {
    const who = t.who || "operator";
    const isTodo = t.status === "todo";
    const btn = el("button", { class: "action " + who + (isTodo ? " s-todo" : ""), style: isTodo ? "border-style:dashed" : "" });
    const head = el("div", { class: "ahead" }, [
      el("span", { class: "who", text: who === "system" ? "async" : who }),
      el("span", { class: "aname", text: t.action }),
      el("span", { class: "arr", text: t.start ? "⇢" : "→" }),
      t.dynamic
        ? el("span", { class: "target dyn", text: t.to.slice(1) })
        : el("span", { class: "target", text: t.start ? "DRAFT" : t.to }),
      el("span", { style: "margin-left:auto" }, el("span", { class: "statind " + (isTodo ? "todo" : "wired") }, [
        el("span", { class: "g", text: isTodo ? "◷" : "✓" }), isTodo ? "TODO" : "wired"
      ]))
    ]);
    btn.appendChild(head);
    if (t.who === "system") btn.appendChild(el("span", { class: "async-tag", html: "⚙ automatic — fires when async work completes" }));
    btn.appendChild(el("span", { class: "inspect-hint", text: t.dynamic ? "click to inspect mutation + routing" : "click to inspect mutation" }));
    btn.addEventListener("click", () => inspectTransition(fromId, t));
    return btn;
  }

  // inspect a transition = a mutation. Separate from advancing.
  function inspectTransition(fromId, t) {
    wf.selected = fromId;
    wf.hiEdge = t.start ? null : { fromId: fromId, toId: t.self ? fromId : (t.dynamic ? "dia:" + t.to.slice(1) : t.to) };
    const m = transitionMeta(fromId, t);
    const sections = [];

    sections.push({ node: el("button", { class: "back-link", html: "← back to " + fromId, onclick: () => inspectState(fromId) }) });

    // meta
    sections.push({ node: el("div", {}, [
      el("div", { class: "state-meta" }, [
        el("span", { class: "chip kind-mutation", text: "mutation" }),
        m.start ? el("span", { class: "chip", text: "start" }) : null,
        m.dynamic ? el("span", { class: "chip", style: "border-style:dashed;border-color:var(--accent);color:var(--accent);background:var(--accent-soft)", text: "dynamic routing" }) : null,
        el("span", { class: "statind " + (m.status === "todo" ? "todo" : "wired") }, [el("span", { class: "g", text: m.status === "todo" ? "◷" : "✓" }), m.status === "todo" ? "TODO" : "wired"])
      ]),
      el("div", { style: "font-size:11.5px;color:var(--faint);margin-top:7px" }, m.start
        ? [document.createTextNode("entry mutation → "), el("b", { class: "mono", text: "DRAFT" })]
        : [document.createTextNode("from "), el("b", { class: "mono", text: fromId }), document.createTextNode(m.self ? " (self)" : (m.dynamic ? " → dynamic" : " → ")), m.dynamic ? null : el("b", { class: "mono", text: m.self ? "" : m.to })])
    ]) });

    // operation logic / intent
    sections.push({ lbl: m.dynamic ? "Operation logic" : "Implementation intent", node: el("div", { class: "intent-text", text: m.intent }) });

    // payload
    const pl = el("div", {});
    if (m.payload.length) m.payload.forEach(f => {
      pl.appendChild(el("div", { class: "frow" }, [
        el("span", { class: "fname", text: f.name }),
        el("span", { class: "ftype", text: f.type }),
        el("span", { style: "margin-left:auto" }, /\?$/.test(f.type) ? el("span", { class: "nullable", text: "nullable" }) : null)
      ]));
    });
    else pl.appendChild(el("p", { class: "mono", style: "color:var(--muted);margin:0", text: "— no payload —" }));
    sections.push({ lbl: "Payload", node: pl });

    // authorization
    sections.push({ lbl: "Authorization", node: authChips(m.auth, m.who) });

    // routing logic (dynamic only)
    if (m.dynamic) {
      const r = WF.routes[m.routeName];
      const list = el("div", {});
      r.branches.forEach(br => {
        list.appendChild(el("div", { class: "branch " + br.kind, style: "cursor:default" }, [
          el("div", { class: "cond", text: br.cond }),
          el("div", { class: "to", html: "→ <b>" + br.to + "</b>" + (br.note ? " · " + br.note : "") })
        ]));
      });
      const wrap = el("div", {}, [
        el("div", { style: "font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--accent);margin-bottom:7px", text: "◆ " + m.routeName }),
        list,
        el("button", { class: "scenario", style: "margin-top:9px", text: "Open routing logic →", onclick: () => { if (window.LOGIC_UI) window.LOGIC_UI.openLogicDrawer(m.routeName); else window.APP.go("logic"); } })
      ]);
      sections.push({ lbl: "Routing logic", node: wrap });
    }

    // take / advance
    if (m.start) {
      sections.push({ lbl: "Entry point", node: el("p", { class: "mono", style: "color:var(--muted);font-size:12px;margin:0", text: "The walkthrough begins in DRAFT when this mutation fires." }) });
    } else {
      const takeWrap = el("div", {});
      if (m.dynamic) {
        takeWrap.appendChild(el("div", { style: "font-size:11.5px;color:var(--muted);margin-bottom:9px", text: "Outcome is chosen by routing — take the transition and pick the runtime result:" }));
        const r = WF.routes[m.routeName];
        r.branches.forEach(br => {
          const b = el("button", { class: "branch " + br.kind }, [
            el("div", { class: "cond", html: "Take → <span style='color:var(--muted)'>" + br.cond + "</span>" }),
            el("div", { class: "to", html: "→ <b>" + br.to + "</b>" })
          ]);
          b.addEventListener("click", () => doAdvance(br.to, m.mutation + " · " + br.cond, "branch"));
          takeWrap.appendChild(b);
        });
      } else if (m.self) {
        takeWrap.appendChild(el("button", { class: "take-btn", html: "Take this transition ↺ <b>" + fromId + "</b>", onclick: () => doAdvance(fromId, m.mutation, m.who === "system" ? "sys" : "op") }));
      } else {
        takeWrap.appendChild(el("button", { class: "take-btn", html: "Take this transition → <b>" + m.to + "</b>", onclick: () => doAdvance(m.to, m.mutation, m.who === "system" ? "sys" : "op") }));
      }
      sections.push({ lbl: "Advance the walkthrough", node: takeWrap });
    }

    window.UI.openDrawer({
      id: "txn:" + fromId + ":" + t.action,
      kicker: m.dynamic ? "Transition · mutation · dynamic" : (m.start ? "Start mutation" : "Transition · mutation"),
      title: m.mutation,
      sections
    });
    redraw(true);
  }

  function inspectState(id) {
    wf.selected = id; wf.hiEdge = null;
    const st = WF.states[id];
    const isCur = id === wf.cur;
    const sections = [];

    const meta = el("div", { class: "state-meta" }, [
      el("span", { class: "kbadge " + st.kind, text: { wait: "wait", flight: "in-flight", review: "needs review", ok: "terminal ok", cancel: "cancelled", term: "terminal" }[st.kind] }),
      isCur ? el("span", { class: "current-flag", text: "● current" }) : null,
      id === WF.initial ? el("span", { class: "current-flag", text: "initial" }) : null
    ]);
    sections.push({ node: el("div", {}, [meta, el("p", { text: st.desc })]) });

    const df = nodeDiff(id);
    if (df) sections.push({ node: window.UI.diffBox(df) });
    if (st.behind) sections.push({ lbl: "Behind the scenes", node: el("div", { class: "behind", html: st.behind }) });

    // start mutations on the initial state
    if (id === WF.initial && WF.startMutations && WF.startMutations.length) {
      const starts = el("div", { class: "actions" });
      WF.startMutations.forEach(name => starts.appendChild(actionButton(id, { action: name, to: "DRAFT", who: "operator", start: true })));
      sections.push({ lbl: "Entry — start mutations", node: starts });
    }

    if (st.t && st.t.length) {
      const acts = el("div", { class: "actions" });
      st.t.forEach(t => acts.appendChild(actionButton(id, t)));
      sections.push({ lbl: "Transitions" + (isCur ? "" : " · jump here to walk from this state"), node: acts });
    } else {
      sections.push({ lbl: "Transitions", node: el("p", { class: "mono", html: "<span style='color:var(--muted)'>— terminal state, no transitions —</span>" }) });
    }

    window.UI.openDrawer({ id: "state:" + id, kicker: "State · " + WF.name, title: id, sections });
    redraw(true);
  }

  function inspectDiamond(rname) {
    const r = WF.routes[rname];
    wf.selected = "dia:" + rname;
    const list = el("div", {});
    r.branches.forEach(br => {
      const b = el("button", { class: "branch " + br.kind }, [
        el("div", { class: "cond", text: br.cond }),
        el("div", { class: "to", html: "→ <b>" + br.to + "</b>" + (br.note ? " · " + br.note : "") })
      ]);
      b.addEventListener("click", () => jumpTo(br.to));
      list.appendChild(b);
    });
    const logicLink = el("div", { class: "pill-grid" }, [
      el("button", { class: "scenario", text: "Open routing logic →", onclick: () => {
        if (window.LOGIC_UI) window.LOGIC_UI.openLogicDrawer(rname); else window.APP.go("logic");
      } })
    ]);
    window.UI.openDrawer({
      id: "dia:" + rname,
      kicker: "Dynamic routing",
      title: rname,
      sections: [
        { node: el("p", { html: "Fired from <b class='mono'>" + r.from + "</b>. The next state is chosen at runtime from these conditions:" }) },
        { lbl: "Branches", node: list },
        { lbl: "Logic", node: logicLink }
      ]
    });
    redraw(true);
  }

  /* ============================================================
     Trail
     ============================================================ */
  function renderTrail() {
    const t = wf.trailEl;
    t.innerHTML = "";
    t.appendChild(el("span", { class: "tlabel", text: "Path" }));
    wf.trail.forEach((step, i) => {
      if (i > 0) {
        const rec = step.viaKind === "recover";
        const arr = el("span", { class: "trail-arrow" + (rec ? " recover" : "") }, [
          el("span", { class: "via", text: step.via || "" }),
          document.createTextNode(" → ")
        ]);
        t.appendChild(arr);
      }
      const st = WF.states[step.id];
      const node = el("span", {
        class: "node kind-" + (st ? st.kind : "wait") + (i === wf.trail.length - 1 ? " now" : ""),
        text: step.id, title: st ? st.label : step.id,
        onclick: () => { wf.cur = step.id; redraw(); inspectState(step.id); focusState(step.id, true); }
      });
      t.appendChild(el("span", { class: "trail-step" }, node));
    });
  }

  /* ============================================================
     Redraw
     ============================================================ */
  function redraw(keepView) {
    const view = wf.view, prevStage = wf.stage;
    const built = buildDiagram();
    const old = wf.svg;
    wf.svg = built.svg; wf.vp = built.vp;
    bindPanZoom(wf.svg);
    prevStage.replaceChild(wf.svg, old);
    applyView();
    renderTrail();
  }

  /* ============================================================
     View entry
     ============================================================ */
  function render(host) {
    wf.host = host;
    const wrap = el("div", { class: "wf" });

    // toolbar
    const toolbar = el("div", { class: "wf-toolbar" }, [
      el("div", { class: "ttl", html: WF.name + "<span class='sub'>case " + WF.caseEntity + " · enum " + WF.statusEnum + "</span>" }),
      el("div", { style: "flex:1" }),
      el("span", { class: "wf-hint", text: "Click a state, then a transition to inspect the mutation. Take a transition to walk the graph." }),
      el("button", { class: "minor", html: "↺ Reset", onclick: reset })
    ]);

    // stage
    const stage = el("div", { class: "wf-stage" });
    wf.stage = stage;
    const built = buildDiagram();
    wf.svg = built.svg; wf.vp = built.vp;
    stage.appendChild(wf.svg);
    bindPanZoom(wf.svg);

    // legend
    const legend = el("div", { class: "wf-legend" });
    [["wait", "Wait — operator acts"], ["flight", "In-flight — async work"], ["review", "Needs review — recover"], ["ok", "Terminal (done)"], ["cancel", "Cancelled"]].forEach(([k, t]) => {
      legend.appendChild(el("div", { class: "lg-row" }, [el("span", { class: "lg-sw " + k }), t]));
    });
    legend.appendChild(el("hr"));
    legend.appendChild(el("div", { class: "lg-row" }, [
      el("span", { class: "lg-dash" }), "system / async transition"
    ]));
    legend.appendChild(el("div", { class: "lg-row" }, [
      el("span", { class: "lg-dia" }), "dynamic routing branch"
    ]));

    // zoom controls
    const zc = el("div", { class: "zoom-controls" }, [
      el("button", { html: "+", title: "Zoom in", onclick: () => zoom(1.2) }),
      el("button", { html: "−", title: "Zoom out", onclick: () => zoom(1 / 1.2) }),
      el("button", { class: "fit", html: "FIT", title: "Fit whole diagram", onclick: fitAll })
    ]);

    stage.appendChild(legend);
    stage.appendChild(zc);

    // trail
    const trail = el("div", { class: "wf-trail scroll" });
    wf.trailEl = trail;

    wrap.appendChild(toolbar);
    wrap.appendChild(stage);
    wrap.appendChild(trail);
    host.appendChild(wrap);

    renderTrail();
    inspectState(wf.cur);
    requestAnimationFrame(() => { fitView(); });

    document.addEventListener("diffchange", () => { if (wf.host && wf.host.isConnected) redraw(true); });
    document.addEventListener("drawerresize", () => { if (wf.host && wf.host.isConnected) requestAnimationFrame(fitView); });
  }

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.workflows = { render };
})();
