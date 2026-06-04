/* ============================================================
   TPS Spec Visualizer — spec data (payroll v2.23.2)
   All content verbatim from the production spec brief.
   ============================================================ */
window.SPEC = (function () {

  /* ---- Product / feature breakdown -------------------------------- */
  const product = {
    name: "payroll",
    version: "v2.23.2",
    baseline: "a1b2c3d",
    summary:
      "Multi-country HCM: onboarding/offboarding, document management, Irish payroll (PAYE/PRSI/USC), Revenue PAYE Modernisation integration, Revolut bank file generation, company management (Ireland & USA).",
    features: [
      { name: "company-management", entities: 5, enums: 6, mutations: 14, queries: 5, workflows: 0 },
      { name: "document-management", entities: 1, enums: 2, mutations: 0, queries: 1, workflows: 0 },
      { name: "irish-payroll", entities: 17, enums: 14, mutations: 5, queries: 12, workflows: 18 },
      { name: "offboarding", entities: 2, enums: 1, mutations: 0, queries: 3, workflows: 4 },
      { name: "onboarding", entities: 2, enums: 1, mutations: 2, queries: 1, workflows: 0 },
      { name: "payroll", entities: 4, enums: 5, mutations: 0, queries: 4, workflows: 5 },
      { name: "revenue-submissions", entities: 1, enums: 2, mutations: 6, queries: 4, workflows: 0 }
    ]
  };

  /* ---- State kinds (color coding) --------------------------------- */
  // wait  -> operator acts here (normal)
  // flight-> async work running (SUBMITTING_*, VERIFYING_*)
  // review-> error / recovery (*_NEEDS_REVIEW)
  // ok    -> terminal ok (CLOSED, RECONCILED)
  // cancel-> terminal cancel (CANCELLED)
  // term  -> bare terminal (AWAITING_NAERSA)

  /* ---- Workflow: PayRunWorkflow ----------------------------------- */
  // Geometry: main spine column (cx 232), review column (cx 470),
  // left aux column (cx 74). Diamonds inline on the spine.
  const W = 160, H = 48;          // node box
  const CX = 232, RX = 470, LX = 78; // column centres

  function box(cx, y, w) { w = w || W; return { x: cx - w / 2, y, w, h: H, cx, cy: y + H / 2 }; }

  const states = {
    DRAFT: {
      label: "Draft", kind: "wait", col: "main", b: box(CX, 24),
      desc: "Pay run created (normal or correction). No external systems contacted yet. Admin fires prepareAepnBindings.",
      behind: "Start mutations <code>createPayRun</code> / <code>createCorrectionPayRun</code> land the run here. Operator can edit pay-period dates or cancel.",
      t: [
        { action: "prepareAepnBindings", to: "AEPN_REVIEW", who: "operator", note: "Fetch latest AEPNs from NAERSA, auto-build an enrolment binding per active employee." },
        { action: "cancelDraftPayRun", to: "CANCELLED", who: "operator", kind: "cancel" }
      ]
    },
    AEPN_REVIEW: {
      label: "AEPN Review", kind: "wait", col: "main", b: box(CX, 116),
      desc: "AEPN bindings present; sync auto-fires; operator reviews bindings then fires calc.",
      behind: "AEPNs persisted; each binding links an employee to the AEPN governing their contribution this run. RPN lookup chains into the calc worker.",
      t: [
        { action: "calculatePayRun", to: "AEPN_REVIEW", who: "operator", note: "Kick off the calc; an async chain looks up RPNs then runs the calc worker.", self: true },
        { action: "__complete__lookupRpnSync", to: "AEPN_REVIEW", who: "system", note: "RPN sync completes → chains into calculatePayRunWork.", chain: "calculatePayRunWork", self: true },
        { action: "__complete__calculatePayRunWork", to: "CALCULATED", who: "system", note: "Calc worker finished — payslips generated." },
        { action: "__complete__pullAepnFeed", to: "AEPN_REVIEW", who: "system", note: "AEPN feed pull completed.", self: true },
        { action: "confirmNoAepnForBinding", to: "AEPN_REVIEW", who: "operator", note: "Operator confirms a binding has no AEPN (opted-out / not enrolled).", self: true },
        { action: "reprepareAepnBindings", to: "DRAFT", who: "operator", note: "Discard bindings, return to Draft (AEPN data believed stale)." }
      ]
    },
    CALCULATED: {
      label: "Calculated", kind: "wait", col: "main", b: box(CX, 208),
      desc: "Payslips generated — admin reviews before submitting for approval.",
      behind: "Calc produced per-employee IrishPayrollResult records (gross/net/PAYE/PRSI/USC + AE contributions). These feed all three external submissions.",
      t: [
        { action: "submitForApproval", to: "APPROVAL_PENDING", who: "operator", note: "Submit the run for controller sign-off." },
        { action: "recalculatePayRun", to: "DRAFT", who: "operator", note: "Discard the calc and return to Draft." },
        { action: "cancelCalculatedPayRun", to: "CANCELLED", who: "operator", kind: "cancel" }
      ]
    },
    APPROVAL_PENDING: {
      label: "Awaiting Approval", kind: "wait", col: "main", b: box(CX, 300),
      desc: "Controller reviews payslips.",
      behind: "No external commitments yet — the controller views payslips and either approves or rejects.",
      t: [
        { action: "approvePayRun", to: "APPROVED", who: "controller", note: "Controller signs off. Run is ready to commit to external authorities." },
        { action: "rejectPayRun", to: "DRAFT", who: "controller", note: "Controller finds an issue; operator must fix and recalculate." },
        { action: "cancelInReviewPayRun", to: "CANCELLED", who: "operator", kind: "cancel" }
      ]
    },
    APPROVED: {
      label: "Approved", kind: "wait", col: "main", b: box(CX, 392),
      desc: "Controller-approved. Operator fires submitToNaersa. The first external commitment is NAERSA (pension contributions).",
      behind: "Approval recorded; no external system notified yet.",
      t: [
        { action: "submitToNaersa", to: "@routeSubmitToNaersa", who: "operator", dynamic: true, note: "Build the NAERSA contribution XML; routing picks the next state." }
      ]
    },
    SUBMITTING_NAERSA: {
      label: "Submitting NAERSA", kind: "flight", col: "main", b: box(CX, 536),
      desc: "SubmitContributionsAsync in flight; routes on completion.",
      behind: "Async submission worker is running. When it completes, routeNaersaContributionAck picks the next state from the file-acknowledgement result.",
      t: [
        { action: "__complete__submitContributionsToNaersa", to: "@routeNaersaContributionAck", who: "system", dynamic: true, note: "Async submission completed — route on the acknowledgement." }
      ]
    },
    AWAITING_NAERSA: {
      label: "Awaiting NAERSA", kind: "term", col: "left", b: box(LX, 536, 116),
      desc: "Terminal/holding state — no transitions defined in the current spec.",
      behind: "Present in the status enum but unreachable from the current transition set. Surfaced here for completeness.",
      t: []
    },
    NAERSA_NEEDS_REVIEW: {
      label: "NAERSA Needs Review", kind: "review", col: "review", b: box(RX, 620, 188),
      desc: "NAERSA wire-level error or rejection; operator inspects + recovers.",
      behind: "v1 does not parse per-record errors. Operator uses the NAERSA Employer Portal (submission ID is shown) to investigate and fix records.",
      t: [
        { action: "retryNaersa", to: "SUBMITTING_NAERSA", who: "operator", note: "Resubmit the whole file. Avoid after a PARTIAL success (may double-count)." },
        { action: "acknowledgeAndProceedFromNaersa", to: "NAERSA_ACCEPTED", who: "operator", note: "Explicit override (mandatory note). Operator accepts responsibility; handled out-of-band via portal." },
        { action: "restartFromCalcFromNaersa", to: "DRAFT", who: "operator", note: "Discard all NAERSA state, return to Draft. Safe — Revenue & Bank untouched." }
      ]
    },
    NAERSA_ACCEPTED: {
      label: "NAERSA Accepted", kind: "wait", col: "main", b: box(CX, 688),
      desc: "NAERSA accepted (or zero-contribution skip). Operator fires submitToRevenue.",
      behind: "Pension contributions are committed. Next external authority is Revenue (the PSR).",
      t: [
        { action: "submitToRevenue", to: "SUBMITTING_REVENUE", who: "operator", note: "Build the Payroll Submission Report XML for Revenue (ROS)." }
      ]
    },
    SUBMITTING_REVENUE: {
      label: "Submitting Revenue", kind: "flight", col: "main", b: box(CX, 780),
      desc: "SubmitAndValidatePSR in flight; routes on PSR ack.",
      behind: "Async PSR submission worker running. routePsrAck picks the next state from Revenue's acknowledgement.",
      t: [
        { action: "__complete__submitAndValidatePSR", to: "@routePsrAck", who: "system", dynamic: true, note: "PSR submission completed — route on the ack." }
      ]
    },
    REVENUE_NEEDS_REVIEW: {
      label: "Revenue Needs Review", kind: "review", col: "review", b: box(RX, 864, 188),
      desc: "Revenue rejected the PSR; operator inspects + recovers.",
      behind: "Operator reviews the rejection — typically a tax-side error (PRSI class, PAYE/USC). Fix on the Employee Detail page, then retry.",
      t: [
        { action: "retryRevenue", to: "SUBMITTING_REVENUE", who: "operator", note: "Build a fresh PSR with corrected data and resubmit." },
        { action: "acknowledgeAndProceedFromRevenue", to: "REVENUE_VALIDATED", who: "operator", note: "Explicit override with mandatory note." },
        { action: "restartFromCalcFromRevenue", to: "DRAFT", who: "operator", note: "Return to Draft. NAERSA already committed — may require manual ROS amendment later." }
      ]
    },
    REVENUE_VALIDATED: {
      label: "Revenue Validated", kind: "wait", col: "main", b: box(CX, 932),
      desc: "Revenue accepted PSR. Operator fires verifyPsrSubmission.",
      behind: "Revenue acknowledged the PSR. We still verify async processing status before committing money.",
      t: [
        { action: "verifyPsrSubmission", to: "VERIFYING_PSR", who: "operator", note: "Build the CheckPayrollSubmission request." }
      ]
    },
    VERIFYING_PSR: {
      label: "Verifying PSR", kind: "flight", col: "main", b: box(CX, 1024),
      desc: "CheckPayrollSubmissionAsync in flight; routes on processing status.",
      behind: "Async verification worker running. routeCheckPayrollSubmission picks the next state from the processing status.",
      t: [
        { action: "__complete__checkPayrollSubmission", to: "@routeCheckPayrollSubmission", who: "system", dynamic: true, note: "Verification completed — route on the processing status." }
      ]
    },
    PSR_VERIFICATION_NEEDS_REVIEW: {
      label: "PSR Verify Needs Review", kind: "review", col: "review", b: box(RX, 1108, 188),
      desc: "PSR verification PENDING/INVALID; operator inspects + recovers.",
      behind: "Revenue reported the submission as still pending or invalid. Operator investigates and retries, overrides, or restarts.",
      diff: "added",
      t: [
        { action: "retryPsrVerification", to: "VERIFYING_PSR", who: "operator", note: "Re-issue the verification request." },
        { action: "acknowledgeAndProceedFromPsrVerification", to: "PSR_VERIFIED", who: "operator", note: "Explicit override with mandatory note." },
        { action: "restartFromCalcFromPsrVerification", to: "DRAFT", who: "operator", note: "Return to Draft." }
      ]
    },
    PSR_VERIFIED: {
      label: "PSR Verified", kind: "wait", col: "main", b: box(CX, 1176),
      desc: "Revenue confirmed PSR processed. Operator fires submitBankFile.",
      behind: "Tax side fully committed and verified. The final, irreversible step is the bank file.",
      t: [
        { action: "submitBankFile", to: "SUBMITTING_BANK", who: "operator", note: "Build the SEPA pain.001 payment instruction. This is the irreversible step." }
      ]
    },
    SUBMITTING_BANK: {
      label: "Submitting Bank", kind: "flight", col: "main", b: box(CX, 1268),
      desc: "Bank submission in flight; routes on bank ack.",
      behind: "Async bank submission worker running. routeBankFileAck picks the next state from the pain.002 response.",
      t: [
        { action: "__complete__submitBankFileWork", to: "@routeBankFileAck", who: "system", dynamic: true, note: "Bank submission completed — route on the ack." }
      ]
    },
    BANK_NEEDS_REVIEW: {
      label: "Bank Needs Review", kind: "review", col: "review", b: box(RX, 1352, 188),
      desc: "Bank rejected file; operator inspects + recovers.",
      behind: "Operator reads the pain.002 rejection (e.g. invalid IBAN). Fix on the Employee Detail page and retry; amount-level errors may need out-of-band handling.",
      t: [
        { action: "retryBank", to: "SUBMITTING_BANK", who: "operator", note: "Rebuild the pain.001 with corrected data and resubmit." },
        { action: "acknowledgeAndProceedFromBank", to: "PAID", who: "operator", note: "Explicit override with mandatory note — money handled via alternative channel." },
        { action: "restartFromCalcFromBank", to: "DRAFT", who: "operator", status: "todo", note: "Return to Draft." }
      ]
    },
    PAID: {
      label: "Paid", kind: "wait", col: "main", b: box(CX, 1420),
      desc: "Payments issued. Operator fires reconcileNow.",
      behind: "Money has moved. An async run-check verifies the disbursement; reconcileNow re-checks on demand.",
      t: [
        { action: "__complete__checkPayrollRunAsync", to: "@routeCheckPayrollRun", who: "system", dynamic: true, note: "Async run-check completed — route on the reconciliation result." },
        { action: "reconcileNow", to: "PAID", who: "operator", note: "Re-run the reconciliation check on demand.", self: true }
      ]
    },
    RECONCILIATION_NEEDS_REVIEW: {
      label: "Reconciliation Needs Review", kind: "review", col: "review", b: box(RX, 1504, 188),
      desc: "Reconciliation mismatch; operator inspects + recovers.",
      behind: "The disbursement didn't reconcile cleanly. Operator investigates and retries or overrides.",
      t: [
        { action: "retryReconcile", to: "PAID", who: "operator", note: "Re-run reconciliation." },
        { action: "acknowledgeAndProceedFromReconcile", to: "RECONCILED", who: "operator", status: "todo", note: "Explicit override with mandatory note." }
      ]
    },
    RECONCILED: {
      label: "Reconciled", kind: "ok", col: "main", b: box(CX, 1572),
      desc: "Reconciliation passed. Operator fires closePayRun.",
      behind: "Disbursement reconciled. One internal step remains.",
      t: [
        { action: "closePayRun", to: "CLOSED", who: "operator", note: "Close the pay run. Internal workflow only — trivially reversible until closed." }
      ]
    },
    CLOSED: {
      label: "Closed", kind: "ok", col: "main", b: box(CX, 1664),
      desc: "Pay run complete. Terminal success state.",
      behind: "All three external authorities committed and reconciled. Nothing further to do.",
      t: []
    },
    CANCELLED: {
      label: "Cancelled", kind: "cancel", col: "left", b: box(LX, 300, 116),
      desc: "Pay run cancelled before commitment. Terminal state.",
      behind: "Reachable from Draft, Calculated, and Awaiting Approval. No external system was committed.",
      t: []
    }
  };

  /* ---- Dynamic routing rules -------------------------------------- */
  const routes = {
    routeSubmitToNaersa: {
      label: "routeSubmitToNaersa", from: "APPROVED",
      branches: [
        { cond: "zero non-zero-AE rows", to: "NAERSA_ACCEPTED", note: "skip — nothing to submit", kind: "skip" },
        { cond: "else", to: "SUBMITTING_NAERSA", note: "submit contributions", kind: "go" }
      ]
    },
    routeNaersaContributionAck: {
      label: "routeNaersaContributionAck", from: "SUBMITTING_NAERSA",
      branches: [
        { cond: "fileAcknowledged = true", to: "NAERSA_ACCEPTED", kind: "ok" },
        { cond: "fileAcknowledged = false", to: "NAERSA_NEEDS_REVIEW", kind: "bad" }
      ]
    },
    routePsrAck: {
      label: "routePsrAck", from: "SUBMITTING_REVENUE",
      branches: [
        { cond: "ACKNOWLEDGED / RECEIVED", to: "REVENUE_VALIDATED", kind: "ok" },
        { cond: "REJECTED / FAILED", to: "REVENUE_NEEDS_REVIEW", kind: "bad" }
      ]
    },
    routeCheckPayrollSubmission: {
      label: "routeCheckPayrollSubmission", from: "VERIFYING_PSR",
      branches: [
        { cond: "PROCESSED", to: "PSR_VERIFIED", kind: "ok" },
        { cond: "PENDING / INVALID", to: "PSR_VERIFICATION_NEEDS_REVIEW", kind: "bad" }
      ]
    },
    routeBankFileAck: {
      label: "routeBankFileAck", from: "SUBMITTING_BANK",
      branches: [
        { cond: "SUBMITTED", to: "PAID", kind: "ok" },
        { cond: "PARTIALLY_ACCEPTED / FAILED", to: "BANK_NEEDS_REVIEW", kind: "bad" }
      ]
    },
    routeCheckPayrollRun: {
      label: "routeCheckPayrollRun", from: "PAID",
      branches: [
        { cond: "reconciled = true", to: "RECONCILED", kind: "ok" },
        { cond: "reconciled = false", to: "RECONCILIATION_NEEDS_REVIEW", kind: "bad" }
      ]
    }
  };

  // Diamond geometry — placed on the spine between source & target.
  const diamonds = {
    routeSubmitToNaersa:        { cx: CX, cy: 476 },
    routeNaersaContributionAck: { cx: CX, cy: 628 },
    routePsrAck:                { cx: CX, cy: 872 },
    routeCheckPayrollSubmission:{ cx: CX, cy: 1116 },
    routeBankFileAck:           { cx: CX, cy: 1360 },
    routeCheckPayrollRun:       { cx: CX, cy: 1512 }
  };

  const workflow = {
    name: "PayRunWorkflow",
    caseEntity: "PayRun",
    statusEnum: "PayRunStatus",
    initialDesc: "Create a new pay run (normal or correction).",
    startMutations: ["createPayRun", "createCorrectionPayRun"],
    initial: "DRAFT",
    states, routes, diamonds,
    svg: { w: 600, h: 1740 }
  };

  /* ---- Scenarios (jump to end, full trail) ------------------------ */
  // Each step: [stateId, viaLabel, viaKind]  viaKind: op|sys|branch|recover
  const scenarios = {
    happy: {
      label: "Happy path",
      desc: "Everything works. The common case for a stable salaried payroll.",
      steps: [
        ["DRAFT", null], ["AEPN_REVIEW", "prepareAepnBindings", "op"],
        ["CALCULATED", "calc (async)", "sys"], ["APPROVAL_PENDING", "submitForApproval", "op"],
        ["APPROVED", "approvePayRun", "op"], ["SUBMITTING_NAERSA", "submitToNaersa · else", "branch"],
        ["NAERSA_ACCEPTED", "ack = true", "branch"], ["SUBMITTING_REVENUE", "submitToRevenue", "op"],
        ["REVENUE_VALIDATED", "PSR ACKNOWLEDGED", "branch"], ["VERIFYING_PSR", "verifyPsrSubmission", "op"],
        ["PSR_VERIFIED", "PROCESSED", "branch"], ["SUBMITTING_BANK", "submitBankFile", "op"],
        ["PAID", "bank SUBMITTED", "branch"], ["RECONCILED", "reconciled = true", "branch"],
        ["CLOSED", "closePayRun", "op"]
      ]
    },
    naersa: {
      label: "NAERSA rejection & recovery",
      desc: "NAERSA returns fileAcknowledged=false; operator acknowledges & proceeds, then completes the run.",
      steps: [
        ["DRAFT", null], ["AEPN_REVIEW", "prepareAepnBindings", "op"], ["CALCULATED", "calc (async)", "sys"],
        ["APPROVAL_PENDING", "submitForApproval", "op"], ["APPROVED", "approvePayRun", "op"],
        ["SUBMITTING_NAERSA", "submitToNaersa · else", "branch"],
        ["NAERSA_NEEDS_REVIEW", "ack = false", "branch"],
        ["NAERSA_ACCEPTED", "acknowledgeAndProceedFromNaersa", "recover"],
        ["SUBMITTING_REVENUE", "submitToRevenue", "op"], ["REVENUE_VALIDATED", "PSR ACKNOWLEDGED", "branch"],
        ["VERIFYING_PSR", "verifyPsrSubmission", "op"], ["PSR_VERIFIED", "PROCESSED", "branch"],
        ["SUBMITTING_BANK", "submitBankFile", "op"], ["PAID", "bank SUBMITTED", "branch"],
        ["RECONCILED", "reconciled = true", "branch"], ["CLOSED", "closePayRun", "op"]
      ]
    },
    revenue: {
      label: "Revenue rejects PSR",
      desc: "Revenue REJECTS the PSR (tax-side error). Operator fixes the data and retries; NAERSA is untouched.",
      steps: [
        ["DRAFT", null], ["AEPN_REVIEW", "prepareAepnBindings", "op"], ["CALCULATED", "calc (async)", "sys"],
        ["APPROVAL_PENDING", "submitForApproval", "op"], ["APPROVED", "approvePayRun", "op"],
        ["SUBMITTING_NAERSA", "submitToNaersa · else", "branch"], ["NAERSA_ACCEPTED", "ack = true", "branch"],
        ["SUBMITTING_REVENUE", "submitToRevenue", "op"],
        ["REVENUE_NEEDS_REVIEW", "PSR REJECTED", "branch"],
        ["SUBMITTING_REVENUE", "retryRevenue", "recover"],
        ["REVENUE_VALIDATED", "PSR ACKNOWLEDGED", "branch"], ["VERIFYING_PSR", "verifyPsrSubmission", "op"],
        ["PSR_VERIFIED", "PROCESSED", "branch"], ["SUBMITTING_BANK", "submitBankFile", "op"],
        ["PAID", "bank SUBMITTED", "branch"], ["RECONCILED", "reconciled = true", "branch"],
        ["CLOSED", "closePayRun", "op"]
      ]
    },
    bank: {
      label: "Bank rejects file",
      desc: "Bank returns FAILED (e.g. bad IBAN). Operator fixes the account detail and retries.",
      steps: [
        ["DRAFT", null], ["AEPN_REVIEW", "prepareAepnBindings", "op"], ["CALCULATED", "calc (async)", "sys"],
        ["APPROVAL_PENDING", "submitForApproval", "op"], ["APPROVED", "approvePayRun", "op"],
        ["SUBMITTING_NAERSA", "submitToNaersa · else", "branch"], ["NAERSA_ACCEPTED", "ack = true", "branch"],
        ["SUBMITTING_REVENUE", "submitToRevenue", "op"], ["REVENUE_VALIDATED", "PSR ACKNOWLEDGED", "branch"],
        ["VERIFYING_PSR", "verifyPsrSubmission", "op"], ["PSR_VERIFIED", "PROCESSED", "branch"],
        ["SUBMITTING_BANK", "submitBankFile", "op"],
        ["BANK_NEEDS_REVIEW", "bank FAILED", "branch"],
        ["SUBMITTING_BANK", "retryBank", "recover"],
        ["PAID", "bank SUBMITTED", "branch"], ["RECONCILED", "reconciled = true", "branch"],
        ["CLOSED", "closePayRun", "op"]
      ]
    },
    cancelled: {
      label: "Cancelled in draft",
      desc: "Operator cancels before any external commitment.",
      steps: [
        ["DRAFT", null], ["CANCELLED", "cancelDraftPayRun", "op"]
      ]
    }
  };

  /* ---- Security: roles, relations, auth rules --------------------- */
  const roles = ["SUPER_ADMIN", "HR_ADMIN", "PAYROLL_ADMIN", "CONTROLLER"];
  const relations = [
    { id: "self", label: "Employee self-access", short: "Self", note: "the employee acting on their own record (on=employee)" },
    { id: "manager", label: "Direct manager", short: "Manager", note: "the employee's manager (on=employee)" }
  ];

  // auth tree leaves: {role:"X"} or {relation:"self|manager"}
  // composites: {anyOf:[...]} / {allOf:[...]}
  const operations = [
    { name: "bootstrapIrishPayrollSystem", kind: "mutation", feature: "irish-payroll", auth: { role: "SUPER_ADMIN" }, status: "wired",
      intent: "Refuse unless the system is virgin (caller's businessEntity == null, no Employee rows exist). Atomically create LegalEntity (IE) → IrishCompanyProfile → Organization → Employee, and link the HumanUser. Return the created IDs." },
    { name: "createGlobalEmployeeProfile", kind: "mutation", feature: "company-management", auth: { role: "HR_ADMIN" }, status: "wired",
      intent: "Reject if the employee already has a profile. Auto-generate the next code EMP-XXXXX by parsing the numeric suffix of existing codes and incrementing. Create the GlobalEmployeeProfile." },
    { name: "createIrishEmployeeProfile", kind: "mutation", feature: "irish-payroll", auth: { role: "HR_ADMIN" }, status: "wired",
      intent: "Create the Ireland-specific payroll profile (PPSN, PRSI class, tax basis, bank details) for an employee that already has a global profile." },
    { name: "updateGlobalEmployeeProfile", kind: "mutation", feature: "company-management", auth: { anyOf: [{ relation: "self" }, { role: "HR_ADMIN" }] }, status: "wired",
      intent: "Update mutable fields on the shared employee profile." },
    { name: "updateIrishEmployeeProfile", kind: "mutation", feature: "irish-payroll", auth: { anyOf: [{ relation: "self" }, { role: "HR_ADMIN" }] }, status: "wired",
      intent: "Update the Ireland-specific payroll profile — e.g. correct a PRSI class or IBAN before a resubmission." },
    { name: "updateUsEmployeeProfile", kind: "mutation", feature: "company-management", auth: { anyOf: [{ relation: "self" }, { role: "HR_ADMIN" }] }, status: "wired",
      intent: "Update the US-specific payroll profile." },
    { name: "getEmployeeCountryProfile", kind: "query", feature: "company-management", auth: { anyOf: [{ relation: "self" }, { role: "HR_ADMIN" }] }, status: "wired",
      intent: "Resolve and return the country-specific payroll profile for an employee." },
    {
      name: "getEmployeePaySlips", kind: "query", feature: "payroll", status: "wired",
      intent: "Find the employee's payslips; join PayRun period + lines; sort by period descending.",
      auth: { anyOf: [{ relation: "self" }, { relation: "manager", diff: "added" }, { role: "HR_ADMIN" }] },
      diff: "changed",
      diffNote: "Gained Direct-manager relation access (anyOf).",
      diffFrom: "anyOf( Self , HR_ADMIN )",
      diffTo: "anyOf( Self , Direct manager , HR_ADMIN )"
    },
    { name: "getPayRunSummary", kind: "query", feature: "payroll", auth: { anyOf: [{ role: "PAYROLL_ADMIN" }, { role: "CONTROLLER" }] }, status: "wired",
      intent: "Aggregate a pay run's totals, employee counts, and external-submission status." },
    { name: "getPayrollReadiness", kind: "query", feature: "payroll", auth: { anyOf: [{ role: "PAYROLL_ADMIN" }, { role: "HR_ADMIN" }, { role: "CONTROLLER" }] }, status: "wired",
      intent: "For a LegalEntity, find all employees; check their country + tax profiles; classify each as AWAITING_EMPLOYEE / PENDING_ADMIN / ACTIVE." },
    { name: "listAllPayRuns", kind: "query", feature: "payroll", auth: { anyOf: [{ role: "PAYROLL_ADMIN" }, { role: "CONTROLLER" }] }, status: "wired",
      intent: "List pay runs across legal entities for the payroll team." },
    { name: "lookupEmployeeByCode", kind: "query", feature: "company-management", auth: { anyOf: [{ role: "HR_ADMIN" }, { role: "PAYROLL_ADMIN" }] }, status: "wired",
      intent: "Resolve an employee by their payroll / employee code." },
    { name: "applyPsrSubmissionResponse", kind: "mutation", feature: "revenue-submissions", auth: { role: "PAYROLL_ADMIN" }, status: "todo",
      intent: "Ingest a Revenue PSR response and update the matching submission record." }
  ];

  const maintainers = [
    { entity: "EmployeeDocument", role: "HR_ADMIN" },
    { entity: "SupplementaryDeduction", role: "PAYROLL_ADMIN" },
    { entity: "SupplementaryEarning", role: "PAYROLL_ADMIN" },
    { entity: "NaersaConfiguration", role: "PAYROLL_ADMIN", singleton: true },
    { entity: "PRSIBand", role: "PAYROLL_ADMIN" },
    { entity: "USCBand", role: "PAYROLL_ADMIN" }
  ];

  const security = { roles, relations, operations, maintainers };

  /* ---- Logic: implementation-intent layer ------------------------- */
  // status: "wired" (real function attached) | "todo" (TODO_IMPLEMENT placeholder)
  // kind: routing | query | mutation | invariant | standalone
  const logic = [
    // --- Routing (workflow next-state decisions) ---
    { id: "routeSubmitToNaersa", name: "routeSubmitToNaersa", kind: "routing", status: "wired", feature: "irish-payroll",
      io: "PayRun → PayRunStatus", oneLine: "Zero non-zero-AE-contribution rows → skip to NAERSA_ACCEPTED; else → SUBMITTING_NAERSA.",
      intent: "Decide whether NAERSA submission is needed. If the run has no rows with a non-zero AE contribution, skip the pension submission entirely and route straight to NAERSA_ACCEPTED; otherwise route to SUBMITTING_NAERSA to build and send the contribution file.",
      refs: [{ type: "state", id: "APPROVED", label: "APPROVED" }] },
    { id: "routeNaersaContributionAck", name: "routeNaersaContributionAck", kind: "routing", status: "wired", feature: "irish-payroll",
      io: "AckResult → PayRunStatus", oneLine: "fileAcknowledged = true → NAERSA_ACCEPTED; false → NAERSA_NEEDS_REVIEW.",
      intent: "Branch on NAERSA's file acknowledgement. fileAcknowledged=true advances to NAERSA_ACCEPTED; false drops to NAERSA_NEEDS_REVIEW for operator recovery.",
      refs: [{ type: "state", id: "SUBMITTING_NAERSA", label: "SUBMITTING_NAERSA" }] },
    { id: "routePsrAck", name: "routePsrAck", kind: "routing", status: "wired", feature: "revenue-submissions",
      io: "PsrAck → PayRunStatus", oneLine: "ACKNOWLEDGED / RECEIVED → REVENUE_VALIDATED; REJECTED / FAILED → REVENUE_NEEDS_REVIEW.",
      intent: "Branch on Revenue's PSR acknowledgement status. ACKNOWLEDGED or RECEIVED advances to REVENUE_VALIDATED; REJECTED or FAILED drops to REVENUE_NEEDS_REVIEW.",
      refs: [{ type: "state", id: "SUBMITTING_REVENUE", label: "SUBMITTING_REVENUE" }] },
    { id: "routeCheckPayrollSubmission", name: "routeCheckPayrollSubmission", kind: "routing", status: "wired", feature: "revenue-submissions",
      io: "ProcessingStatus → PayRunStatus", oneLine: "PROCESSED → PSR_VERIFIED; PENDING / INVALID → PSR_VERIFICATION_NEEDS_REVIEW.",
      intent: "Branch on the Revenue processing status returned by CheckPayrollSubmission. PROCESSED advances to PSR_VERIFIED; PENDING or INVALID drops to PSR_VERIFICATION_NEEDS_REVIEW.",
      refs: [{ type: "state", id: "VERIFYING_PSR", label: "VERIFYING_PSR" }] },
    { id: "routeBankFileAck", name: "routeBankFileAck", kind: "routing", status: "wired", feature: "payroll",
      io: "BankAck → PayRunStatus", oneLine: "SUBMITTED → PAID; PARTIALLY_ACCEPTED / FAILED → BANK_NEEDS_REVIEW.",
      intent: "Branch on the bank's pain.002 response. SUBMITTED advances to PAID; PARTIALLY_ACCEPTED or FAILED drops to BANK_NEEDS_REVIEW.",
      refs: [{ type: "state", id: "SUBMITTING_BANK", label: "SUBMITTING_BANK" }] },
    { id: "routeCheckPayrollRun", name: "routeCheckPayrollRun", kind: "routing", status: "wired", feature: "payroll",
      io: "ReconResult → PayRunStatus", oneLine: "reconciled = true → RECONCILED; false → RECONCILIATION_NEEDS_REVIEW.",
      intent: "Branch on the disbursement reconciliation result. reconciled=true advances to RECONCILED; false drops to RECONCILIATION_NEEDS_REVIEW.",
      refs: [{ type: "state", id: "PAID", label: "PAID" }] },

    // --- Invariants (entity rules) ---
    { id: "ibanFormatInvariant", name: "IBAN format", kind: "invariant", status: "todo", feature: "irish-payroll",
      io: "IrishEmployeeProfile.iban", oneLine: "IBAN must match the IBAN format (2 letters + 2 digits + 11–30 alphanumeric).",
      intent: "IBAN must match the IBAN format (2 letters + 2 digits + 11–30 alphanumeric). Enforced before an Irish profile is saved and before a bank file is built.",
      refs: [{ type: "field", id: "IrishEmployeeProfile.iban", label: "IrishEmployeeProfile.iban" }, { type: "logic", id: "validateIbanFormat", label: "validateIbanFormat" }] },
    { id: "ssnUniqueInvariant", name: "SSN uniqueness", kind: "invariant", status: "wired", feature: "company-management",
      io: "UsEmployeeProfile.ssn", oneLine: "SSN must be unique across all US profiles (duplicate check).",
      intent: "SSN must be unique across all US profiles. A duplicate check runs on create/update of a US employee profile.",
      refs: [{ type: "op", id: "updateUsEmployeeProfile", label: "updateUsEmployeeProfile" }] },

    // --- Standalone reusable functions ---
    { id: "generateNextEmployeeCode", name: "generateNextEmployeeCode", kind: "standalone", status: "wired", feature: "company-management",
      io: "existing codes → EMP-XXXXX", oneLine: "Parse the numeric suffix of existing employee codes and increment to mint the next EMP-XXXXX.",
      intent: "Parse the numeric suffix of all existing employee codes, take the max, and increment to mint the next EMP-XXXXX. Shared by the create-profile mutations.",
      refs: [{ type: "op", id: "createGlobalEmployeeProfile", label: "createGlobalEmployeeProfile" }, { type: "op", id: "createIrishEmployeeProfile", label: "createIrishEmployeeProfile" }] },
    { id: "validateIbanFormat", name: "validateIbanFormat", kind: "standalone", status: "todo", feature: "irish-payroll",
      io: "string → boolean", oneLine: "Validate an IBAN string against the format rule before building a bank file.",
      intent: "Validate an IBAN string against the IBAN format rule (2 letters + 2 digits + 11–30 alphanumeric). Reused by the IBAN invariant and the bank-file builder.",
      refs: [{ type: "logic", id: "ibanFormatInvariant", label: "IBAN format invariant" }] }
  ];

  /* ---- Entities --------------------------------------------------- */
  const entities = [
    {
      name: "PayRun", kind: "STANDARD", feature: "payroll", role: "the workflow's case entity",
      fields: [
        { name: "legalEntity", type: "reference", nullable: false, target: "LegalEntity", card: "EXACTLY_ONE" },
        { name: "payDate", type: "date", nullable: false },
        { name: "payPeriodStart", type: "date", nullable: false },
        { name: "payPeriodEnd", type: "date", nullable: false },
        { name: "payFrequency", type: "enum", enumName: "PayFrequency", nullable: false },
        { name: "payRunType", type: "enum", enumName: "PayRunType", enumVals: "NORMAL, CORRECTION", nullable: false },
        { name: "correctedPayRun", type: "reference", nullable: true, target: "PayRun", card: "ZERO_OR_ONE" },
        { name: "correctionReason", type: "text", nullable: true },
        { name: "createdBy", type: "reference", nullable: false, target: "Employee", card: "EXACTLY_ONE" },
        { name: "notes", type: "text", nullable: true }
      ]
    },
    {
      name: "IrishPayrollResult", kind: "STANDARD", feature: "irish-payroll", role: "payslip-like calc result — dense, calculation-heavy",
      fields: [
        { name: "employee", type: "reference", nullable: false, target: "Employee", card: "EXACTLY_ONE" },
        { name: "payRun", type: "reference", nullable: false, target: "PayRun", card: "EXACTLY_ONE" },
        { name: "grossPay", type: "decimal", nullable: false },
        { name: "netPay", type: "decimal", nullable: false },
        { name: "paye", type: "decimal", nullable: false },
        { name: "employeePRSI", type: "decimal", nullable: false },
        { name: "employerPRSI", type: "decimal", nullable: false },
        { name: "usc", type: "decimal", nullable: false },
        { name: "lptDeducted", type: "decimal", nullable: true, diff: "changed", diffNote: "nullable: false → true", diffFrom: "nullable: false", diffTo: "nullable: true" },
        { name: "aeEmployeeContribution", type: "decimal", nullable: true },
        { name: "aeEmployerContribution", type: "decimal", nullable: true },
        { name: "prsiClassUsed", type: "enum", enumName: "PRSIClass", nullable: false },
        { name: "taxBasisUsed", type: "enum", enumName: "TaxBasis", nullable: false },
        { name: "calculatedAt", type: "timestamp", nullable: false },
        { name: "ytdGrossPay", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdPaye", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdNetPay", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdEmployeePRSI", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdEmployerPRSI", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdUsc", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdLpt", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdAeEmployee", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdAeEmployer", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdPensionableEarnings", type: "decimal", nullable: false, group: "YTD accumulator" },
        { name: "ytdTaxableEarnings", type: "decimal", nullable: false, group: "YTD accumulator" }
      ]
    },
    {
      name: "IrishEmployeeProfile", kind: "STANDARD", feature: "irish-payroll", role: "per-employee Irish payroll profile",
      fields: [
        { name: "employee", type: "reference", nullable: false, target: "Employee", card: "EXACTLY_ONE" },
        { name: "legalEntity", type: "reference", nullable: false, target: "LegalEntity", card: "EXACTLY_ONE" },
        { name: "iban", type: "text", nullable: true },
        { name: "bic", type: "text", nullable: true },
        { name: "address1", type: "text", nullable: true },
        { name: "address2", type: "text", nullable: true },
        { name: "city", type: "text", nullable: true },
        { name: "county", type: "text", nullable: true },
        { name: "eircode", type: "text", nullable: true },
        { name: "hasExistingPension", type: "boolean", nullable: false }
      ]
    }
  ];

  // lighter entity stubs (names only) referenced across the spec
  const otherEntities = [
    "Employee", "LegalEntity", "Company", "EmployeeDocument", "SupplementaryDeduction",
    "SupplementaryEarning", "NaersaConfiguration", "PRSIBand", "USCBand",
    "AepnBinding", "RpnRecord", "PsrSubmission", "BankFile", "OnboardingCase", "OffboardingCase"
  ];

  /* ---- Diff overlay ----------------------------------------------- */
  // status: 'red' (most recent deploy) | 'yellow' (uncommitted drift)
  const diffs = [
    {
      id: "state-added", area: "workflows", status: "red", breaking: false,
      title: "New state PSR_VERIFICATION_NEEDS_REVIEW",
      target: "PSR_VERIFICATION_NEEDS_REVIEW",
      from: "— (did not exist)",
      to: "review state with retry / acknowledge / restart recovery actions",
      note: "Added by the most recent deploy to model async PSR-verification failures."
    },
    {
      id: "transition-removed", area: "workflows", status: "yellow", breaking: true,
      title: "Removed transition APPROVED → cancelApprovedPayRun",
      target: "APPROVED",
      from: "APPROVED had cancelApprovedPayRun → CANCELLED",
      to: "transition removed — approved runs can no longer be cancelled directly",
      note: "Breaking: a previously-valid operator action is gone. Existing runs relying on it will fail."
    },
    {
      id: "field-nullable", area: "entities", status: "yellow", breaking: false,
      title: "IrishPayrollResult.lptDeducted nullable: false → true",
      target: "IrishPayrollResult.lptDeducted",
      from: "nullable: false",
      to: "nullable: true",
      note: "Local Property Tax deduction is now optional (employees without an LPT instruction)."
    },
    {
      id: "auth-manager", area: "security", status: "yellow", breaking: false,
      title: "getEmployeePaySlips gained Direct-manager access",
      target: "getEmployeePaySlips",
      from: "anyOf( Self , HR_ADMIN )",
      to: "anyOf( Self , Direct manager , HR_ADMIN )",
      note: "Managers can now view their reports' payslips. Widens access (not a tightening)."
    },
    {
      id: "op-added", area: "operations", status: "red", breaking: false,
      title: "New mutation applyPsrSubmissionResponse",
      target: "applyPsrSubmissionResponse",
      from: "— (did not exist)",
      to: "mutation · role: PAYROLL_ADMIN",
      note: "Added by the most recent deploy to ingest Revenue PSR responses."
    },
    {
      id: "intent-changed", area: "logic", status: "yellow", breaking: false, logicKind: "intent",
      title: "getPayrollReadiness intent edited",
      target: "getPayrollReadiness",
      from: "…classify each as AWAITING / PENDING / ACTIVE.",
      to: "…classify each as AWAITING_EMPLOYEE / PENDING_ADMIN / ACTIVE.",
      note: "One-line clarification of the readiness classes — implementation unchanged."
    },
    {
      id: "became-built", area: "logic", status: "built", breaking: false, logicKind: "implemented",
      title: "createIrishEmployeeProfile is now wired",
      target: "createIrishEmployeeProfile",
      from: "◷ TODO_IMPLEMENT",
      to: "✓ wired",
      note: "Real implementation attached in the latest deploy — no longer a placeholder."
    }
  ];

  // per-area change badges {area: {count, severity, breaking}}
  const areaChanges = {
    overview: { count: 7, severity: "red", breaking: true },
    entities: { count: 1, severity: "yellow", breaking: false },
    relationships: { count: 0, severity: null, breaking: false },
    workflows: { count: 2, severity: "red", breaking: true },
    operations: { count: 1, severity: "red", breaking: false },
    logic: { count: 2, severity: "built", breaking: false },
    security: { count: 1, severity: "yellow", breaking: false },
    ui: { count: 0, severity: null, breaking: false }
  };

  /* ---- Navigator areas -------------------------------------------- */
  const areas = [
    { id: "overview", label: "Overview", desc: "Product summary, features & change digest" },
    { id: "entities", label: "Entities & Data", desc: "Entities, fields, references & enums" },
    { id: "relationships", label: "Relationships", desc: "References between entities" },
    { id: "workflows", label: "Workflows", desc: "State machines + simulator", star: true },
    { id: "operations", label: "Operations", desc: "Queries & mutations" },
    { id: "logic", label: "Logic", desc: "Implementation intent & status", star: true },
    { id: "security", label: "Security", desc: "Roles, relations & authorization", priority: true },
    { id: "ui", label: "UI", desc: "Pages & components" }
  ];

  return {
    product, workflow, security, logic, entities, otherEntities,
    diffs, areaChanges, areas, scenarios
  };
})();
