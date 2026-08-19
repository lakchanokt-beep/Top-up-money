const fallbackConfig = {
  sit: {
    label: "VB SIT",
    awsProfile: "vb",
    region: "ap-southeast-1",
    cluster: "vb-core-bank-sit-eks",
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: "http://localhost:8051", postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: "http://localhost:8051", postingType: "OUTBOUND" }
    }
  },
  uat: {
    label: "CB UAT",
    awsProfile: "CB",
    region: "ap-southeast-7",
    cluster: "cb-core-bank-th-uat-eks-tm",
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: "http://localhost:8051", postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: "http://localhost:8051", postingType: "OUTBOUND" }
    }
  }
};

const state = {
  config: {},
  env: "sit",
  service: ""
};

const apiBase = window.location.protocol === "file:" ? "http://localhost:3000" : "";

const els = {
  envSelect: document.querySelector("#envSelect"),
  serviceSelect: document.querySelector("#serviceSelect"),
  awsProfile: document.querySelector("#awsProfile"),
  awsRegion: document.querySelector("#awsRegion"),
  awsCluster: document.querySelector("#awsCluster"),
  serviceUrl: document.querySelector("#serviceUrl"),
  connectionStatus: document.querySelector("#connectionStatus"),
  summaryEnv: document.querySelector("#summaryEnv"),
  summaryPort: document.querySelector("#summaryPort"),
  summaryProfile: document.querySelector("#summaryProfile"),
  healthButton: document.querySelector("#healthButton"),
  requestForm: document.querySelector("#requestForm"),
  entityNumberFrom: document.querySelector("#entityNumberFrom"),
  amountInput: document.querySelector("#amountInput"),
  transactionCodeInput: document.querySelector("#transactionCodeInput"),
  internalAccountInput: document.querySelector("#internalAccountInput"),
  submitButton: document.querySelector("#submitButton"),
  checkOneStepBalanceButton: document.querySelector("#checkOneStepBalanceButton"),
  resetButton: document.querySelector("#resetButton"),
  bulkPanel: document.querySelector("#bulkPanel"),
  bulkAccountsInput: document.querySelector("#bulkAccountsInput"),
  targetBalanceInput: document.querySelector("#targetBalanceInput"),
  previewBulkButton: document.querySelector("#previewBulkButton"),
  transferAllButton: document.querySelector("#transferAllButton"),
  clearBulkOutButton: document.querySelector("#clearBulkOutButton"),
  bulkPreview: document.querySelector("#bulkPreview"),
  bulkInPanel: document.querySelector("#bulkInPanel"),
  bulkInAccountsInput: document.querySelector("#bulkInAccountsInput"),
  targetInBalanceInput: document.querySelector("#targetInBalanceInput"),
  previewBulkInButton: document.querySelector("#previewBulkInButton"),
  transferInAllButton: document.querySelector("#transferInAllButton"),
  clearBulkInButton: document.querySelector("#clearBulkInButton"),
  bulkInPreview: document.querySelector("#bulkInPreview"),
  balanceAccountsInput: document.querySelector("#balanceAccountsInput"),
  checkBalanceButton: document.querySelector("#checkBalanceButton"),
  clearBalanceButton: document.querySelector("#clearBalanceButton"),
  clearButton: document.querySelector("#clearButton"),
  responseMeta: document.querySelector("#responseMeta"),
  responseOutput: document.querySelector("#responseOutput")
};

function setStatus(text, tone = "neutral") {
  els.connectionStatus.textContent = `Status: ${text}`;
  els.connectionStatus.dataset.tone = tone;
}

function prettyJson(value) {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function parseAccountsText(text) {
  return String(text || "").match(/\d+/g) || [];
}

function normalizeAccountInput(input) {
  const normalized = parseAccountsText(input.value).join("\n");
  if (input.value !== normalized) {
    input.value = normalized;
  }
}

function bindAccountNormalizer(input, onChange) {
  input.addEventListener("input", () => {
    normalizeAccountInput(input);
    if (onChange) onChange();
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderEnvOptions() {
  els.envSelect.innerHTML = Object.entries(state.config)
    .map(([key, env]) => `<option value="${key}">${env.label}</option>`)
    .join("");
  els.envSelect.value = state.env;
}

function renderServiceOptions() {
  const env = state.config[state.env];
  els.serviceSelect.innerHTML = `<option value="">Select service</option>` + Object.entries(env.services)
    .map(([key, service]) => `<option value="${key}">${service.label}</option>`)
    .join("");

  els.serviceSelect.value = state.service;
}

function renderDetails() {
  const env = state.config[state.env];
  const service = state.service ? env.services[state.service] : null;

  els.awsProfile.textContent = env.awsProfile;
  els.awsRegion.textContent = env.region;
  els.awsCluster.textContent = env.cluster;
  els.summaryEnv.textContent = env.label;
  els.summaryProfile.textContent = env.awsProfile;

  if (!service) {
    els.serviceUrl.textContent = "-";
    els.summaryPort.textContent = "-";
    els.requestForm.hidden = true;
    els.bulkPanel.hidden = true;
    els.bulkInPanel.hidden = true;
    els.healthButton.disabled = true;
    return;
  }

  const port = new URL(service.baseUrl).port || "-";
  const isOutbound = service.postingType === "OUTBOUND";

  els.serviceUrl.textContent = `${service.baseUrl}/api/v1/transfer`;
  els.summaryPort.textContent = port;
  els.requestForm.hidden = false;
  els.healthButton.disabled = false;
  els.submitButton.textContent = isOutbound ? "Transfer Out" : "Top-up Now";
  els.submitButton.classList.toggle("danger-button", isOutbound);
  els.amountInput.min = isOutbound ? "0" : "0.01";
  els.bulkPanel.hidden = !isOutbound;
  els.bulkInPanel.hidden = isOutbound;
  if (!els.transactionCodeInput.dataset.touched) {
    els.transactionCodeInput.value = isOutbound ? "MSTOAIN" : "MSTIANN";
  }
}

function renderAll() {
  renderEnvOptions();
  renderServiceOptions();
  renderDetails();
  setStatus("Ready");
}

async function postJson(url, payload) {
  try {
    const response = await fetch(`${apiBase}${url}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Backend returned non-JSON response (${response.status}): ${text}`);
    }
  } catch (error) {
    if (error.message.includes("non-JSON")) throw error;
    throw new Error("Backend is not reachable. Please run `npm start` and open http://localhost:3000.");
  }
}

async function loadConfig() {
  try {
    const response = await fetch(`${apiBase}/api/config`);
    if (!response.ok) throw new Error("Config request failed");
    state.config = await response.json();
  } catch {
    state.config = fallbackConfig;
    if (window.location.protocol === "file:") {
      els.responseMeta.textContent = "Backend is offline";
      els.responseOutput.textContent = prettyJson({
        message: "The page is open as a file. Start the backend with npm start, then use http://localhost:3000 for top-up requests."
      });
    }
  }
  renderAll();
}

async function checkHealth() {
  setStatus("Checking", "pending");
  els.responseMeta.textContent = "Checking DCB adapter port";
  els.responseOutput.textContent = "{}";

  const result = await postJson("/api/health", {
    env: state.env,
    service: state.service
  });

  els.responseMeta.textContent = `${result.connected ? "Connected" : "Not connected"} · ${result.durationMs || 0} ms`;
  els.responseOutput.textContent = prettyJson(result);
  setStatus(result.connected ? "Connected" : "Check failed", result.connected ? "ok" : "error");
}

async function sendRequest(event) {
  event.preventDefault();
  setStatus("Sending", "pending");

  try {
    const selectedService = state.config[state.env].services[state.service];
    const defaultTransactionCode = selectedService.postingType === "OUTBOUND" ? "MSTOAIN" : "MSTIANN";
    const result = await postJson("/api/topup", {
      env: state.env,
      service: state.service,
      entityNumberFrom: els.entityNumberFrom.value.trim(),
      amount: Number(els.amountInput.value),
      channel: "VB",
      requester: "DPP",
      transactionCode: els.transactionCodeInput.value.trim() || defaultTransactionCode,
      internalAccountId: els.internalAccountInput.value.trim() || "FUND_TRANSFER",
      authorization: ""
    });

    const transferStatus = result.transfer?.status || result.lookup?.status || "Error";
    const lookupMs = result.lookup?.durationMs || 0;
    const transferMs = result.transfer?.durationMs || 0;
    els.responseMeta.textContent = `${transferStatus} · lookup ${lookupMs} ms · transfer ${transferMs} ms`;
    els.responseOutput.textContent = prettyJson(result);
    setStatus(result.ok ? "Done" : "Failed", result.ok ? "ok" : "error");
  } catch (error) {
    els.responseMeta.textContent = "Top-up failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Failed", "error");
  }
}

function renderBulkPreview(result, options = {}) {
  const previewEl = options.previewEl || els.bulkPreview;
  const accountsText = options.accountsText || els.bulkAccountsInput.value;
  const transferLabel = options.transferLabel || "Transfer Out";
  const actionButton = options.actionButton || els.transferAllButton;
  const rows = result.results || [];
  if (!rows.length) {
    previewEl.innerHTML = "";
    actionButton.disabled = true;
    return;
  }

  const fallbackIgnoredAccounts = [];
  const ignoredAccounts = (result.ignoredAccounts && result.ignoredAccounts.length)
    ? result.ignoredAccounts
    : fallbackIgnoredAccounts;
  const ignoredText = ignoredAccounts.length
    ? ignoredAccounts.map(escapeHtml).join("<br>")
    : "No ignored accounts";
  const body = rows.map((item, index) => {
    const rowClass = item.skipped ? "skip-row" : item.ok ? "ready-row" : "error-row";
    return `
    <tr class="${rowClass}">
      <td class="num">${index + 1}</td>
      <td>${item.account}</td>
      <td>${item.tmAccountId || "-"}</td>
      <td>${item.pocketNumber || "-"}</td>
      <td class="num">${item.balance ?? "-"}</td>
      <td class="num">${item.transferAmount ?? "-"}</td>
      <td>${item.skipped ? "Skip" : item.ok ? "Ready" : item.error || "Error"}</td>
    </tr>
  `;
  }).join("");

  previewEl.innerHTML = `
    <div class="bulk-summary">
      Ready ${result.readyCount || result.successCount || 0} · Skip ${result.skippedCount || 0} · Error ${result.errorCount || 0} ·
      <span class="ignored-count" tabindex="0">
        Ignored ${result.ignoredCount || 0}
        <span class="ignored-tooltip">${ignoredText}</span>
      </span>
    </div>
    <div class="table-wrap">
      <table class="bulk-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>Account</th>
            <th>tmAccountId</th>
            <th>Pocket</th>
            <th>Balance</th>
            <th>${transferLabel}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
  actionButton.disabled = (result.readyCount || 0) === 0 || (result.errorCount || 0) > 0;
}

async function previewBulk() {
  setStatus("Previewing", "pending");
  els.transferAllButton.disabled = true;
  els.bulkPreview.innerHTML = "";

  const result = await postJson("/api/bulk-preview", {
    env: state.env,
    accounts: els.bulkAccountsInput.value,
    targetBalance: Number(els.targetBalanceInput.value || 0)
  });

  renderBulkPreview(result);
  els.responseMeta.textContent = `Bulk preview · ${result.count || 0} accounts`;
  els.responseOutput.textContent = prettyJson(result);
  setStatus(result.errorCount ? "Preview has errors" : "Preview ready", result.errorCount ? "error" : "ok");
}

async function transferBulk() {
  setStatus("Bulk sending", "pending");
  els.transferAllButton.disabled = true;

  const result = await postJson("/api/bulk-transfer-out", {
    env: state.env,
    accounts: els.bulkAccountsInput.value,
    targetBalance: Number(els.targetBalanceInput.value || 0)
  });

  renderBulkPreview(result);
  els.responseMeta.textContent = `Bulk transfer · success ${result.successCount || 0} · error ${result.errorCount || 0}`;
  els.responseOutput.textContent = prettyJson(result);
  setStatus(result.ok ? "Bulk done" : "Bulk failed", result.ok ? "ok" : "error");
}

async function previewBulkIn() {
  setStatus("Previewing", "pending");
  els.transferInAllButton.disabled = true;
  els.bulkInPreview.innerHTML = "";

  const result = await postJson("/api/bulk-in-preview", {
    env: state.env,
    accounts: els.bulkInAccountsInput.value,
    targetBalance: Number(els.targetInBalanceInput.value || 0)
  });

  renderBulkPreview(result, {
    previewEl: els.bulkInPreview,
    accountsText: els.bulkInAccountsInput.value,
    transferLabel: "Transfer In",
    actionButton: els.transferInAllButton
  });
  els.responseMeta.textContent = `Bulk transfer in preview · ${result.count || 0} accounts`;
  els.responseOutput.textContent = prettyJson(result);
  setStatus(result.errorCount ? "Preview has errors" : "Preview ready", result.errorCount ? "error" : "ok");
}

async function transferBulkIn() {
  setStatus("Bulk sending", "pending");
  els.transferInAllButton.disabled = true;

  const result = await postJson("/api/bulk-transfer-in", {
    env: state.env,
    accounts: els.bulkInAccountsInput.value,
    targetBalance: Number(els.targetInBalanceInput.value || 0)
  });

  renderBulkPreview(result, {
    previewEl: els.bulkInPreview,
    accountsText: els.bulkInAccountsInput.value,
    transferLabel: "Transfer In",
    actionButton: els.transferInAllButton
  });
  els.responseMeta.textContent = `Bulk transfer in · success ${result.successCount || 0} · error ${result.errorCount || 0}`;
  els.responseOutput.textContent = prettyJson(result);
  setStatus(result.ok ? "Bulk done" : "Bulk failed", result.ok ? "ok" : "error");
}

async function checkBalance() {
  setStatus("Checking balance", "pending");

  const result = await postJson("/api/balance-check", {
    env: state.env,
    accounts: els.balanceAccountsInput.value
  });

  els.responseMeta.textContent = `Balance check · success ${result.successCount || 0} · error ${result.errorCount || 0} · ignored ${result.ignoredCount || 0}`;
  els.responseOutput.textContent = (result.summary || []).join("\n");
  if (result.errorCount) {
    els.responseOutput.textContent += `\n\n${prettyJson(result)}`;
  }
  setStatus(result.ok ? "Balance ready" : "Balance has errors", result.ok ? "ok" : "error");
}

async function checkOneStepBalance() {
  setStatus("Checking balance", "pending");

  const account = parseAccountsText(els.entityNumberFrom.value)[0] || "";
  if (account) {
    els.entityNumberFrom.value = account;
  }

  const result = await postJson("/api/balance-check", {
    env: state.env,
    accounts: account
  });

  els.responseMeta.textContent = `One-step balance · success ${result.successCount || 0} · error ${result.errorCount || 0}`;
  els.responseOutput.textContent = (result.summary || []).join("\n");
  if (result.errorCount) {
    els.responseOutput.textContent += `\n\n${prettyJson(result)}`;
  }
  setStatus(result.ok ? "Balance ready" : "Balance has errors", result.ok ? "ok" : "error");
}

els.envSelect.addEventListener("change", () => {
  state.env = els.envSelect.value;
  state.service = "";
  renderServiceOptions();
  renderDetails();
});

els.serviceSelect.addEventListener("change", () => {
  state.service = els.serviceSelect.value;
  delete els.transactionCodeInput.dataset.touched;
  renderDetails();
});

els.transactionCodeInput.addEventListener("input", () => {
  els.transactionCodeInput.dataset.touched = "true";
});

bindAccountNormalizer(els.bulkAccountsInput, () => {
  els.bulkPreview.innerHTML = "";
  els.transferAllButton.disabled = true;
});

bindAccountNormalizer(els.bulkInAccountsInput, () => {
  els.bulkInPreview.innerHTML = "";
  els.transferInAllButton.disabled = true;
});

bindAccountNormalizer(els.balanceAccountsInput);

els.healthButton.addEventListener("click", () => {
  checkHealth().catch((error) => {
    els.responseMeta.textContent = "Port check failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Check failed", "error");
  });
});

els.requestForm.addEventListener("submit", sendRequest);

els.checkOneStepBalanceButton.addEventListener("click", () => {
  checkOneStepBalance().catch((error) => {
    els.responseMeta.textContent = "One-step balance failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Balance failed", "error");
  });
});

els.previewBulkButton.addEventListener("click", () => {
  previewBulk().catch((error) => {
    els.responseMeta.textContent = "Bulk preview failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Preview failed", "error");
  });
});

els.transferAllButton.addEventListener("click", () => {
  transferBulk().catch((error) => {
    els.responseMeta.textContent = "Bulk transfer failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Bulk failed", "error");
  });
});

els.clearBulkOutButton.addEventListener("click", () => {
  els.bulkAccountsInput.value = "";
  els.targetBalanceInput.value = "0";
  els.bulkPreview.innerHTML = "";
  els.transferAllButton.disabled = true;
});

els.previewBulkInButton.addEventListener("click", () => {
  previewBulkIn().catch((error) => {
    els.responseMeta.textContent = "Bulk transfer in preview failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Preview failed", "error");
  });
});

els.transferInAllButton.addEventListener("click", () => {
  transferBulkIn().catch((error) => {
    els.responseMeta.textContent = "Bulk transfer in failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Bulk failed", "error");
  });
});

els.clearBulkInButton.addEventListener("click", () => {
  els.bulkInAccountsInput.value = "";
  els.targetInBalanceInput.value = "0";
  els.bulkInPreview.innerHTML = "";
  els.transferInAllButton.disabled = true;
});

els.checkBalanceButton.addEventListener("click", () => {
  checkBalance().catch((error) => {
    els.responseMeta.textContent = "Balance check failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Balance failed", "error");
  });
});

els.clearBalanceButton.addEventListener("click", () => {
  els.balanceAccountsInput.value = "";
});

els.resetButton.addEventListener("click", () => {
  els.entityNumberFrom.value = "";
  els.amountInput.value = "";
  delete els.transactionCodeInput.dataset.touched;
  els.transactionCodeInput.value = state.config[state.env].services[state.service].postingType === "OUTBOUND" ? "MSTOAIN" : "MSTIANN";
  els.internalAccountInput.value = "FUND_TRANSFER";
  setStatus("Ready");
});

els.clearButton.addEventListener("click", () => {
  els.responseMeta.textContent = "No request yet";
  els.responseOutput.textContent = "{}";
  setStatus("Ready");
});

loadConfig().catch((error) => {
  els.responseOutput.textContent = prettyJson({ error: error.message });
  setStatus("Config error", "error");
});
