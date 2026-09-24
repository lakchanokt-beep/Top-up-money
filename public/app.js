const fallbackConfig = {
  sit: {
    label: "CB SIT",
    awsProfile: "CB",
    region: "ap-southeast-7",
    cluster: "cb-core-bank-th-sit-eks-tm",
    ddpAccountFinancialUrl: "http://127.0.0.2:8070/payment/v1/internal/deposit-adapter/account-financial",
    cardlessWithdrawalBaseUrl: "http://127.0.0.2:8081",
    cardlessDepositBaseUrl: "http://127.0.0.2:8045",
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: "http://127.0.0.2:8051", postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: "http://127.0.0.2:8051", postingType: "OUTBOUND" }
    }
  },
  uat: {
    label: "CB UAT",
    awsProfile: "CB",
    region: "ap-southeast-7",
    cluster: "cb-core-bank-th-uat-eks-tm",
    ddpAccountFinancialUrl: "http://localhost:28070/payment/v1/internal/deposit-adapter/account-financial",
    cardlessWithdrawalBaseUrl: "http://localhost:28081",
    cardlessDepositBaseUrl: "http://localhost:28045",
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: "http://localhost:28051", postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: "http://localhost:28051", postingType: "OUTBOUND" }
    }
  }
};

const state = {
  config: {},
  env: "sit",
  service: "",
  workspace: "topup"
};

const apiBase = window.location.protocol === "file:" ? "http://localhost:3000" : "";

const els = {
  workspaceTabs: document.querySelectorAll(".workspace-tab"),
  topupWorkspace: document.querySelector("#topupWorkspace"),
  withdrawalWorkspace: document.querySelector("#withdrawalWorkspace"),
  depositWorkspace: document.querySelector("#depositWorkspace"),
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
  copyButton: document.querySelector("#copyButton"),
  clearButton: document.querySelector("#clearButton"),
  responseMeta: document.querySelector("#responseMeta"),
  responseOutput: document.querySelector("#responseOutput"),
  cardlessWithdrawalForm: document.querySelector("#cardlessWithdrawalForm"),
  withdrawalEnvSelect: document.querySelector("#withdrawalEnvSelect"),
  withdrawalServiceUrl: document.querySelector("#withdrawalServiceUrl"),
  withdrawalAmount: document.querySelector("#withdrawalAmount"),
  withdrawalMobile: document.querySelector("#withdrawalMobile"),
  withdrawalRefCode: document.querySelector("#withdrawalRefCode"),
  cardlessWithdrawalButton: document.querySelector("#cardlessWithdrawalButton"),
  clearCardlessWithdrawalButton: document.querySelector("#clearCardlessWithdrawalButton"),
  withdrawalResponseMeta: document.querySelector("#withdrawalResponseMeta"),
  withdrawalResponseOutput: document.querySelector("#withdrawalResponseOutput"),
  copyWithdrawalResponseButton: document.querySelector("#copyWithdrawalResponseButton"),
  clearWithdrawalResponseButton: document.querySelector("#clearWithdrawalResponseButton"),
  cardlessDepositForm: document.querySelector("#cardlessDepositForm"),
  depositEnvSelect: document.querySelector("#depositEnvSelect"),
  depositServiceUrl: document.querySelector("#depositServiceUrl"),
  depositAmount: document.querySelector("#depositAmount"),
  depositToAccount: document.querySelector("#depositToAccount"),
  cardlessDepositButton: document.querySelector("#cardlessDepositButton"),
  clearCardlessDepositButton: document.querySelector("#clearCardlessDepositButton"),
  depositResponseMeta: document.querySelector("#depositResponseMeta"),
  depositResponseOutput: document.querySelector("#depositResponseOutput"),
  copyDepositResponseButton: document.querySelector("#copyDepositResponseButton"),
  clearDepositResponseButton: document.querySelector("#clearDepositResponseButton")
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

async function copyResponse(outputElement, button) {
  const text = outputElement.textContent || "";
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
  } else {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(outputElement);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("copy");
    selection.removeAllRanges();
  }

  const originalText = button.textContent;
  button.textContent = "Copied";
  setStatus("Response copied", "ok");
  window.setTimeout(() => {
    button.textContent = originalText;
  }, 1400);
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

function bindDigitsOnly(input) {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "");
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
  const options = Object.entries(state.config)
    .map(([key, env]) => `<option value="${key}">${env.label}</option>`)
    .join("");
  els.envSelect.innerHTML = options;
  els.withdrawalEnvSelect.innerHTML = options;
  els.depositEnvSelect.innerHTML = options;
  els.envSelect.value = state.env;
  els.withdrawalEnvSelect.value = state.env;
  els.depositEnvSelect.value = state.env;
}

function renderCardlessDetails() {
  const env = state.config[state.env];
  els.withdrawalServiceUrl.textContent = `${env.cardlessWithdrawalBaseUrl}/payment/v1/atm/cardless/...`;
  els.depositServiceUrl.textContent = `${env.cardlessDepositBaseUrl}/payment/v1/atm/card/deposit`;
}

function selectWorkspace(workspace) {
  state.workspace = workspace;
  els.topupWorkspace.hidden = workspace !== "topup";
  els.withdrawalWorkspace.hidden = workspace !== "withdrawal";
  els.depositWorkspace.hidden = workspace !== "deposit";
  els.workspaceTabs.forEach((tab) => {
    const active = tab.dataset.workspace === workspace;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  setStatus("Ready");
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
  renderCardlessDetails();
  selectWorkspace(state.workspace);
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

function updateEnvironment(envKey) {
  state.env = envKey;
  state.service = "";
  renderEnvOptions();
  renderServiceOptions();
  renderDetails();
  renderCardlessDetails();
}

function renderCardlessResult(result, metaElement, outputElement) {
  const completedSteps = Array.isArray(result.steps) ? result.steps.length : 0;
  metaElement.textContent = result.ok
    ? `Completed · ${completedSteps} steps`
    : `Failed${result.failedStep ? ` at step ${result.failedStep}` : ""} · ${completedSteps} steps completed`;
  outputElement.textContent = prettyJson(result);
  setStatus(result.ok ? "Done" : "Failed", result.ok ? "ok" : "error");
}

async function submitCardlessWithdrawal(event) {
  event.preventDefault();
  setStatus("Withdrawing", "pending");
  els.cardlessWithdrawalButton.disabled = true;
  els.withdrawalResponseMeta.textContent = "Running 3-step withdrawal";
  els.withdrawalResponseOutput.textContent = "{}";

  try {
    const result = await postJson("/api/cardless-withdrawal", {
      env: state.env,
      transactionAmount: Number(els.withdrawalAmount.value),
      mobile: els.withdrawalMobile.value,
      refCode: els.withdrawalRefCode.value
    });
    renderCardlessResult(result, els.withdrawalResponseMeta, els.withdrawalResponseOutput);
  } catch (error) {
    els.withdrawalResponseMeta.textContent = "Cardless withdrawal failed";
    els.withdrawalResponseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Failed", "error");
  } finally {
    els.cardlessWithdrawalButton.disabled = false;
  }
}

async function submitCardlessDeposit(event) {
  event.preventDefault();
  setStatus("Depositing", "pending");
  els.cardlessDepositButton.disabled = true;
  els.depositResponseMeta.textContent = "Running 2-step deposit";
  els.depositResponseOutput.textContent = "{}";

  try {
    const result = await postJson("/api/cardless-deposit", {
      env: state.env,
      transactionAmount: Number(els.depositAmount.value),
      toAccount: els.depositToAccount.value
    });
    renderCardlessResult(result, els.depositResponseMeta, els.depositResponseOutput);
  } catch (error) {
    els.depositResponseMeta.textContent = "Cardless deposit failed";
    els.depositResponseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Failed", "error");
  } finally {
    els.cardlessDepositButton.disabled = false;
  }
}

els.envSelect.addEventListener("change", () => {
  updateEnvironment(els.envSelect.value);
});

els.withdrawalEnvSelect.addEventListener("change", () => updateEnvironment(els.withdrawalEnvSelect.value));
els.depositEnvSelect.addEventListener("change", () => updateEnvironment(els.depositEnvSelect.value));

els.workspaceTabs.forEach((tab) => {
  tab.addEventListener("click", () => selectWorkspace(tab.dataset.workspace));
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
bindDigitsOnly(els.withdrawalMobile);
bindDigitsOnly(els.withdrawalRefCode);
bindDigitsOnly(els.depositToAccount);

els.healthButton.addEventListener("click", () => {
  checkHealth().catch((error) => {
    els.responseMeta.textContent = "Port check failed";
    els.responseOutput.textContent = prettyJson({ error: error.message });
    setStatus("Check failed", "error");
  });
});

els.requestForm.addEventListener("submit", sendRequest);
els.cardlessWithdrawalForm.addEventListener("submit", submitCardlessWithdrawal);
els.cardlessDepositForm.addEventListener("submit", submitCardlessDeposit);

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

els.copyButton.addEventListener("click", () => {
  copyResponse(els.responseOutput, els.copyButton).catch((error) => {
    setStatus(`Copy failed: ${error.message}`, "error");
  });
});

els.clearCardlessWithdrawalButton.addEventListener("click", () => {
  els.withdrawalAmount.value = "";
  els.withdrawalMobile.value = "";
  els.withdrawalRefCode.value = "";
  setStatus("Ready");
});

els.clearWithdrawalResponseButton.addEventListener("click", () => {
  els.withdrawalResponseMeta.textContent = "No request yet";
  els.withdrawalResponseOutput.textContent = "{}";
  setStatus("Ready");
});

els.copyWithdrawalResponseButton.addEventListener("click", () => {
  copyResponse(els.withdrawalResponseOutput, els.copyWithdrawalResponseButton).catch((error) => {
    setStatus(`Copy failed: ${error.message}`, "error");
  });
});

els.clearCardlessDepositButton.addEventListener("click", () => {
  els.depositAmount.value = "";
  els.depositToAccount.value = "";
  setStatus("Ready");
});

els.clearDepositResponseButton.addEventListener("click", () => {
  els.depositResponseMeta.textContent = "No request yet";
  els.depositResponseOutput.textContent = "{}";
  setStatus("Ready");
});

els.copyDepositResponseButton.addEventListener("click", () => {
  copyResponse(els.depositResponseOutput, els.copyDepositResponseButton).catch((error) => {
    setStatus(`Copy failed: ${error.message}`, "error");
  });
});

loadConfig().catch((error) => {
  els.responseOutput.textContent = prettyJson({ error: error.message });
  setStatus("Config error", "error");
});
