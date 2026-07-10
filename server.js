const http = require("http");
const fs = require("fs");
const net = require("net");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || path.join(__dirname, "logs", "audit.jsonl");
const DCB_BASE_URL = process.env.DCB_BASE_URL || "http://localhost:8051";
const DDP_ACCOUNT_FINANCIAL_URL = process.env.DDP_ACCOUNT_FINANCIAL_URL || "http://localhost:8070/payment/v1/internal/deposit-adapter/account-financial";
const DCB_TRANSFER_PATH = process.env.DCB_TRANSFER_PATH || "/api/v1/transfer";
const BULK_ACCOUNT_LIMIT = Number(process.env.BULK_ACCOUNT_LIMIT || 20);
const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "";
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || "";

const envConfig = {
  sit: {
    label: "VB SIT",
    awsProfile: "vb",
    region: "ap-southeast-1",
    cluster: "vb-core-bank-sit-eks",
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: DCB_BASE_URL, postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: DCB_BASE_URL, postingType: "OUTBOUND" }
    }
  },
  uat: {
    label: "CB UAT",
    awsProfile: "CB",
    region: "ap-southeast-7",
    cluster: "cb-core-bank-th-uat-eks-tm",
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: DCB_BASE_URL, postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: DCB_BASE_URL, postingType: "OUTBOUND" }
    }
  }
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(body);
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  res.end(text);
}

function isBasicAuthEnabled() {
  return Boolean(BASIC_AUTH_USER && BASIC_AUTH_PASSWORD);
}

function isAuthorized(req) {
  if (!isBasicAuthEnabled()) return true;

  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;

  const raw = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = raw.indexOf(":");
  if (separator === -1) return false;

  const user = raw.slice(0, separator);
  const password = raw.slice(separator + 1);
  return user === BASIC_AUTH_USER && password === BASIC_AUTH_PASSWORD;
}

function requireAuth(req, res) {
  if (isAuthorized(req)) return true;
  sendText(res, 401, "Authentication required", {
    "www-authenticate": 'Basic realm="Top-up Money Tool"'
  });
  return false;
}

function getActor(req) {
  if (!isBasicAuthEnabled()) return "local-user";
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return "unknown";
  const raw = Buffer.from(header.slice(6), "base64").toString("utf8");
  return raw.split(":")[0] || "unknown";
}

function summarizeMoneyAction(result) {
  if (Array.isArray(result.results)) {
    return result.results.map((item) => ({
      account: item.account,
      ok: item.ok,
      skipped: item.skipped,
      balance: item.balance,
      targetBalance: item.targetBalance,
      transferAmount: item.transferAmount,
      transferStatus: item.transfer?.status || null,
      error: item.error || ""
    }));
  }

  return {
    ok: result.ok,
    env: result.env,
    service: result.service,
    tmAccountId: result.tmAccountId || null,
    pocketNumber: result.pocketNumber || null,
    transferStatus: result.transfer?.status || null,
    transferAmount: result.transfer?.requestBody?.transactionAmount || null,
    postingType: result.transfer?.requestBody?.postingType || null
  };
}

function writeAuditLog(req, action, payload, result) {
  const record = {
    at: new Date().toISOString(),
    actor: getActor(req),
    action,
    env: payload.env || "",
    service: payload.service || "",
    ok: Boolean(result.ok),
    summary: summarizeMoneyAction(result)
  };

  fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true }, (mkdirError) => {
    if (mkdirError) return;
    fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(record)}\n`, () => {});
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function getTarget(envKey, serviceKey, requestPath = "/") {
  const env = envConfig[envKey];
  if (!env) throw new Error("Unknown environment");
  const service = env.services[serviceKey];
  if (!service) throw new Error("Unknown service");

  const safePath = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return {
    env,
    service,
    url: new URL(safePath, service.baseUrl)
  };
}

async function proxyRequest(payload) {
  const { env, service, url } = getTarget(payload.env, payload.service, payload.path || "/");
  const method = String(payload.method || "POST").toUpperCase();
  const headers = Object.assign({}, payload.headers || {});
  const hasBody = !["GET", "HEAD"].includes(method);
  const startedAt = Date.now();

  if (hasBody && payload.body && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: hasBody ? payload.body || "" : undefined
  });

  const responseText = await response.text();
  return {
    env: env.label,
    service: service.label,
    requestUrl: url.toString(),
    status: response.status,
    statusText: response.statusText,
    durationMs: Date.now() - startedAt,
    headers: Object.fromEntries(response.headers.entries()),
    body: responseText
  };
}

function checkTcpPort(baseUrl) {
  return new Promise((resolve) => {
    const target = new URL(baseUrl);
    const startedAt = Date.now();
    const host = target.hostname === "localhost" ? "127.0.0.1" : target.hostname;
    const socket = net.createConnection({
      host,
      port: Number(target.port || 80)
    });

    socket.setTimeout(2000);
    socket.on("connect", () => {
      socket.destroy();
      resolve({
        connected: true,
        host: target.hostname,
        port: target.port,
        durationMs: Date.now() - startedAt
      });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        connected: false,
        host: target.hostname,
        port: target.port,
        durationMs: Date.now() - startedAt,
        error: "Connection timed out"
      });
    });
    socket.on("error", (error) => {
      resolve({
        connected: false,
        host: target.hostname,
        port: target.port,
        durationMs: Date.now() - startedAt,
        error: error.message
      });
    });
  });
}

function uuid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    return (char === "x" ? value : (value & 0x3 | 0x8)).toString(16);
  });
}

function randomHex(length) {
  const chars = "abcdef0123456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function traceparent() {
  const traceId = randomHex(32);
  const parentId = randomHex(16);
  const traceFlags = "01";
  return `00-${traceId}-${parentId}-${traceFlags}`;
}

function bangkokDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const requestDateTime = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`;
  const effectiveDate = `${parts.year}${parts.month}${parts.day}`;
  return { requestDateTime, effectiveDate };
}

function findField(value, fieldName) {
  if (!value || typeof value !== "object") return "";
  if (typeof value[fieldName] === "string" && value[fieldName]) return value[fieldName];
  if (typeof value[fieldName] === "number") return String(value[fieldName]);

  for (const item of Object.values(value)) {
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = findField(child, fieldName);
        if (found) return found;
      }
    } else if (item && typeof item === "object") {
      const found = findField(item, fieldName);
      if (found) return found;
    }
  }

  return "";
}

function findTmAccountId(value) {
  return findField(value, "tmAccountId");
}

function findPocketNumber(value) {
  return findField(value, "pocketNumber");
}

function findFirstNumberField(value, fieldNames) {
  if (!value || typeof value !== "object") return null;

  for (const fieldName of fieldNames) {
    const raw = value[fieldName];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw.replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  for (const item of Object.values(value)) {
    if (Array.isArray(item)) {
      for (const child of item) {
        const found = findFirstNumberField(child, fieldNames);
        if (found !== null) return found;
      }
    } else if (item && typeof item === "object") {
      const found = findFirstNumberField(item, fieldNames);
      if (found !== null) return found;
    }
  }

  return null;
}

function findBalance(value) {
  return findFirstNumberField(value, [
    "availableBalance",
    "available_bal",
    "availableBal",
    "currentBalance",
    "current_bal",
    "currentBal",
    "ledgerBalance",
    "ledger_bal",
    "ledgerBal",
    "balance",
    "amount"
  ]);
}

async function lookupAccountFinancial(entityNumberFrom, options = {}) {
  const requestDateTime = options.requestDateTime || bangkokDateParts().requestDateTime;
  const channel = options.channel || "VB";
  const lookupHeaders = {
    "content-type": "application/json",
    "user-agent": "top-up-money-tool",
    "x-ref-id": uuid(),
    "x-traceparent": options.traceparent || traceparent(),
    "x-channel": channel,
    "x-request-date-time": requestDateTime,
    "x-requester": channel
  };
  const lookupBody = {
    entityNumberFrom: String(entityNumberFrom).trim(),
    typeFrom: options.typeFrom || "ACCOUNT"
  };
  const response = await fetchJson(DDP_ACCOUNT_FINANCIAL_URL, {
    method: "POST",
    headers: lookupHeaders,
    body: JSON.stringify(lookupBody)
  });

  return {
    requestUrl: DDP_ACCOUNT_FINANCIAL_URL,
    requestHeaders: lookupHeaders,
    requestBody: lookupBody,
    ...response
  };
}

function parseAccountLines(text) {
  return String(text || "")
    .split(/\r?\n|,|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLimitedAccountLines(text) {
  const accounts = parseAccountLines(text);
  return {
    accounts: accounts.slice(0, BULK_ACCOUNT_LIMIT),
    ignoredAccounts: accounts.slice(BULK_ACCOUNT_LIMIT),
    originalCount: accounts.length,
    ignoredCount: Math.max(0, accounts.length - BULK_ACCOUNT_LIMIT),
    limit: BULK_ACCOUNT_LIMIT
  };
}

async function fetchJson(url, options) {
  const startedAt = Date.now();
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    durationMs: Date.now() - startedAt,
    headers: Object.fromEntries(response.headers.entries()),
    text,
    json
  };
}

async function runTopup(payload) {
  const { env, service, url } = getTarget(payload.env, payload.service, DCB_TRANSFER_PATH);
  const servicePostingType = service.postingType || "INBOUND";
  const isOutbound = servicePostingType === "OUTBOUND";
  const { requestDateTime, effectiveDate } = bangkokDateParts();
  const channel = payload.channel || "VB";
  const transferTraceparent = payload.traceparent || traceparent();
  const amount = Number(payload.amount);
  const token = String(payload.authorization || "").trim().replace(/^Bearer\s+/i, "");

  if (!payload.entityNumberFrom) throw new Error("entityNumberFrom is required");
  if (!Number.isFinite(amount) || amount < 0) throw new Error("amount must be 0 or greater");
  if (!isOutbound && amount <= 0) throw new Error("amount must be greater than 0 for inbound");

  const lookup = await lookupAccountFinancial(payload.entityNumberFrom, {
    requestDateTime,
    channel,
    typeFrom: payload.typeFrom || "ACCOUNT",
    traceparent: payload.lookupTraceparent
  });

  if (!lookup.ok) {
    return {
      ok: false,
      env: env.label,
      service: service.label,
      failedStep: "lookupTmAccountId",
      lookup
    };
  }

  const tmAccountId = findTmAccountId(lookup.json);
  const pocketNumber = findPocketNumber(lookup.json);
  if (!tmAccountId) {
    return {
      ok: false,
      env: env.label,
      service: service.label,
      failedStep: "extractTmAccountId",
      lookup,
      error: "tmAccountId was not found in DDP response"
    };
  }

  const requestId = uuid();
  const transactionRefId = payload.transactionRefId || `e2e-${uuid()}`;
  const transferHeaders = {
    "content-type": "application/json",
    "x-request-id": uuid(),
    "x-traceparent": transferTraceparent,
    "x-channel": channel,
    "x-requester": payload.requester || "DPP",
    "x-request-date-time": requestDateTime,
    "x-ref-id": uuid()
  };
  if (token) {
    transferHeaders.authorization = `Bearer ${token}`;
  }
  if (isOutbound && !pocketNumber) {
    return {
      ok: false,
      env: env.label,
      service: service.label,
      failedStep: "extractPocketNumber",
      tmAccountId,
      lookup,
      error: "pocketNumber was not found in DDP response"
    };
  }

  const transferSideKey = isOutbound ? "outbound" : "inbound";
  const transferSideBody = isOutbound
    ? {
        fromAccountId: tmAccountId,
        pocketNumber,
        fromAddress: payload.fromAddress || "DEFAULT",
        transactionCode: "MSTOAIN",
        internalAccountId: "FUND_TRANSFER",
        transactionClass: payload.transactionClass || "D"
      }
    : {
        toAccountId: tmAccountId,
        transactionCode: "MSTIANN",
        internalAccountId: "FUND_TRANSFER",
        transactionClass: payload.transactionClass || "D"
      };
  const transferBody = {
    requestId,
    clientId: payload.clientId || "DigitalPaymentProcessorClientID",
    transactionRefId,
    [transferSideKey]: transferSideBody,
    transactionType: payload.transactionType || "FUND_TRANSFER",
    postingType: servicePostingType,
    transactionAmount: amount,
    denomination: payload.denomination || "THB",
    transactionDatetime: requestDateTime,
    effectiveDate,
    reversalFlag: false
  };

  const transfer = await fetchJson(url.toString(), {
    method: "POST",
    headers: transferHeaders,
    body: JSON.stringify(transferBody)
  });

  return {
    ok: transfer.ok,
    env: env.label,
    service: service.label,
    tmAccountId,
    pocketNumber: pocketNumber || null,
    lookup: {
      requestUrl: DDP_ACCOUNT_FINANCIAL_URL,
      requestBody: lookup.requestBody,
      status: lookup.status,
      statusText: lookup.statusText,
      durationMs: lookup.durationMs,
      body: lookup.json || lookup.text
    },
    transfer: {
      requestUrl: url.toString(),
      requestBody: transferBody,
      status: transfer.status,
      statusText: transfer.statusText,
      durationMs: transfer.durationMs,
      body: transfer.json || transfer.text
    }
  };
}

async function previewBulkTransferOut(payload) {
  const parsedAccounts = parseLimitedAccountLines(payload.accounts);
  const accounts = parsedAccounts.accounts;
  const targetBalance = Number(payload.targetBalance ?? 0);
  const channel = payload.channel || "VB";
  const { requestDateTime } = bangkokDateParts();

  if (!accounts.length) throw new Error("accounts are required");
  if (!Number.isFinite(targetBalance) || targetBalance < 0) throw new Error("targetBalance must be 0 or greater");

  const results = [];
  for (const account of accounts) {
    const lookup = await lookupAccountFinancial(account, { requestDateTime, channel });
    const tmAccountId = lookup.ok ? findTmAccountId(lookup.json) : "";
    const pocketNumber = lookup.ok ? findPocketNumber(lookup.json) : "";
    const balance = lookup.ok ? findBalance(lookup.json) : null;
    const transferAmount = balance === null ? null : Math.max(0, Number((balance - targetBalance).toFixed(2)));

    results.push({
      account,
      ok: lookup.ok && Boolean(tmAccountId) && Boolean(pocketNumber) && balance !== null,
      tmAccountId: tmAccountId || null,
      pocketNumber: pocketNumber || null,
      balance,
      targetBalance,
      transferAmount,
      skipped: transferAmount === 0,
      error: lookup.ok
        ? (!tmAccountId ? "tmAccountId not found" : !pocketNumber ? "pocketNumber not found" : balance === null ? "balance field not found" : "")
        : `Lookup failed: ${lookup.status} ${lookup.statusText}`,
      lookup: {
        requestUrl: lookup.requestUrl,
        requestBody: lookup.requestBody,
        status: lookup.status,
        statusText: lookup.statusText,
        durationMs: lookup.durationMs,
        body: lookup.json || lookup.text
      }
    });
  }

  return {
    ok: results.every((item) => item.ok || item.skipped),
    count: results.length,
    originalCount: parsedAccounts.originalCount,
    ignoredCount: parsedAccounts.ignoredCount,
    ignoredAccounts: parsedAccounts.ignoredAccounts,
    limit: parsedAccounts.limit,
    readyCount: results.filter((item) => item.ok && !item.skipped).length,
    skippedCount: results.filter((item) => item.skipped).length,
    errorCount: results.filter((item) => !item.ok && !item.skipped).length,
    results
  };
}

async function runBulkTransferOut(payload) {
  const preview = await previewBulkTransferOut(payload);
  const { env, service, url } = getTarget(payload.env, "dcbOutbound", DCB_TRANSFER_PATH);
  const { requestDateTime, effectiveDate } = bangkokDateParts();
  const channel = payload.channel || "VB";
  const token = String(payload.authorization || "").trim().replace(/^Bearer\s+/i, "");
  const transferResults = [];

  for (const item of preview.results) {
    if (!item.ok || item.skipped) {
      transferResults.push({
        ...item,
        transfer: null
      });
      continue;
    }

    const transferHeaders = {
      "content-type": "application/json",
      "x-request-id": uuid(),
      "x-traceparent": traceparent(),
      "x-channel": channel,
      "x-requester": payload.requester || "DPP",
      "x-request-date-time": requestDateTime,
      "x-ref-id": uuid()
    };
    if (token) {
      transferHeaders.authorization = `Bearer ${token}`;
    }

    const transferBody = {
      requestId: uuid(),
      clientId: payload.clientId || "DigitalPaymentProcessorClientID",
      transactionRefId: `e2e-${uuid()}`,
      outbound: {
        fromAccountId: item.tmAccountId,
        pocketNumber: item.pocketNumber,
        fromAddress: "DEFAULT",
        transactionCode: "MSTOAIN",
        internalAccountId: "FUND_TRANSFER",
        transactionClass: "D"
      },
      transactionType: payload.transactionType || "FUND_TRANSFER",
      postingType: "OUTBOUND",
      transactionAmount: item.transferAmount,
      denomination: payload.denomination || "THB",
      transactionDatetime: requestDateTime,
      effectiveDate,
      reversalFlag: false
    };

    const transfer = await fetchJson(url.toString(), {
      method: "POST",
      headers: transferHeaders,
      body: JSON.stringify(transferBody)
    });

    transferResults.push({
      ...item,
      transfer: {
        requestUrl: url.toString(),
        requestBody: transferBody,
        status: transfer.status,
        statusText: transfer.statusText,
        durationMs: transfer.durationMs,
        body: transfer.json || transfer.text
      },
      ok: transfer.ok
    });
  }

  return {
    ok: transferResults.every((item) => item.ok || item.skipped),
    env: env.label,
    service: service.label,
    count: transferResults.length,
    successCount: transferResults.filter((item) => item.ok && !item.skipped).length,
    skippedCount: transferResults.filter((item) => item.skipped).length,
    errorCount: transferResults.filter((item) => !item.ok && !item.skipped).length,
    results: transferResults
  };
}

async function previewBulkTransferIn(payload) {
  const parsedAccounts = parseLimitedAccountLines(payload.accounts);
  const accounts = parsedAccounts.accounts;
  const targetBalance = Number(payload.targetBalance ?? 0);
  const channel = payload.channel || "VB";
  const { requestDateTime } = bangkokDateParts();

  if (!accounts.length) throw new Error("accounts are required");
  if (!Number.isFinite(targetBalance) || targetBalance < 0) throw new Error("targetBalance must be 0 or greater");

  const results = [];
  for (const account of accounts) {
    const lookup = await lookupAccountFinancial(account, { requestDateTime, channel });
    const tmAccountId = lookup.ok ? findTmAccountId(lookup.json) : "";
    const balance = lookup.ok ? findBalance(lookup.json) : null;
    const transferAmount = balance === null ? null : Math.max(0, Number((targetBalance - balance).toFixed(2)));

    results.push({
      account,
      ok: lookup.ok && Boolean(tmAccountId) && balance !== null,
      tmAccountId: tmAccountId || null,
      pocketNumber: null,
      balance,
      targetBalance,
      transferAmount,
      skipped: transferAmount === 0,
      error: lookup.ok
        ? (!tmAccountId ? "tmAccountId not found" : balance === null ? "balance field not found" : "")
        : `Lookup failed: ${lookup.status} ${lookup.statusText}`,
      lookup: {
        requestUrl: lookup.requestUrl,
        requestBody: lookup.requestBody,
        status: lookup.status,
        statusText: lookup.statusText,
        durationMs: lookup.durationMs,
        body: lookup.json || lookup.text
      }
    });
  }

  return {
    ok: results.every((item) => item.ok || item.skipped),
    count: results.length,
    originalCount: parsedAccounts.originalCount,
    ignoredCount: parsedAccounts.ignoredCount,
    ignoredAccounts: parsedAccounts.ignoredAccounts,
    limit: parsedAccounts.limit,
    readyCount: results.filter((item) => item.ok && !item.skipped).length,
    skippedCount: results.filter((item) => item.skipped).length,
    errorCount: results.filter((item) => !item.ok && !item.skipped).length,
    results
  };
}

async function runBulkTransferIn(payload) {
  const preview = await previewBulkTransferIn(payload);
  const { env, service, url } = getTarget(payload.env, "dcbInbound", DCB_TRANSFER_PATH);
  const { requestDateTime, effectiveDate } = bangkokDateParts();
  const channel = payload.channel || "VB";
  const token = String(payload.authorization || "").trim().replace(/^Bearer\s+/i, "");
  const transferResults = [];

  for (const item of preview.results) {
    if (!item.ok || item.skipped) {
      transferResults.push({
        ...item,
        transfer: null
      });
      continue;
    }

    const transferHeaders = {
      "content-type": "application/json",
      "x-request-id": uuid(),
      "x-traceparent": traceparent(),
      "x-channel": channel,
      "x-requester": payload.requester || "DPP",
      "x-request-date-time": requestDateTime,
      "x-ref-id": uuid()
    };
    if (token) {
      transferHeaders.authorization = `Bearer ${token}`;
    }

    const transferBody = {
      requestId: uuid(),
      clientId: payload.clientId || "DigitalPaymentProcessorClientID",
      transactionRefId: `e2e-${uuid()}`,
      inbound: {
        toAccountId: item.tmAccountId,
        transactionCode: "MSTIANN",
        internalAccountId: "FUND_TRANSFER",
        transactionClass: "D"
      },
      transactionType: payload.transactionType || "FUND_TRANSFER",
      postingType: "INBOUND",
      transactionAmount: item.transferAmount,
      denomination: payload.denomination || "THB",
      transactionDatetime: requestDateTime,
      effectiveDate,
      reversalFlag: false
    };

    const transfer = await fetchJson(url.toString(), {
      method: "POST",
      headers: transferHeaders,
      body: JSON.stringify(transferBody)
    });

    transferResults.push({
      ...item,
      transfer: {
        requestUrl: url.toString(),
        requestBody: transferBody,
        status: transfer.status,
        statusText: transfer.statusText,
        durationMs: transfer.durationMs,
        body: transfer.json || transfer.text
      },
      ok: transfer.ok
    });
  }

  return {
    ok: transferResults.every((item) => item.ok || item.skipped),
    env: env.label,
    service: service.label,
    count: transferResults.length,
    successCount: transferResults.filter((item) => item.ok && !item.skipped).length,
    skippedCount: transferResults.filter((item) => item.skipped).length,
    errorCount: transferResults.filter((item) => !item.ok && !item.skipped).length,
    results: transferResults
  };
}

async function checkBalances(payload) {
  const parsedAccounts = parseLimitedAccountLines(payload.accounts);
  const accounts = parsedAccounts.accounts;
  const channel = payload.channel || "VB";
  const { requestDateTime } = bangkokDateParts();

  if (!accounts.length) throw new Error("accounts are required");

  const results = [];
  for (const account of accounts) {
    const lookup = await lookupAccountFinancial(account, { requestDateTime, channel });
    const availableBalance = lookup.ok ? findFirstNumberField(lookup.json, ["availableBalance"]) : null;

    results.push({
      account,
      ok: lookup.ok && availableBalance !== null,
      availableBalance,
      error: lookup.ok
        ? (availableBalance === null ? "availableBalance field not found" : "")
        : `Lookup failed: ${lookup.status} ${lookup.statusText}`,
      lookup: {
        requestUrl: lookup.requestUrl,
        requestBody: lookup.requestBody,
        status: lookup.status,
        statusText: lookup.statusText,
        durationMs: lookup.durationMs,
        body: lookup.json || lookup.text
      }
    });
  }

  return {
    ok: results.every((item) => item.ok),
    count: results.length,
    originalCount: parsedAccounts.originalCount,
    ignoredCount: parsedAccounts.ignoredCount,
    limit: parsedAccounts.limit,
    successCount: results.filter((item) => item.ok).length,
    errorCount: results.filter((item) => !item.ok).length,
    summary: results.map((item) => `${item.account} : ${item.availableBalance ?? "-"}`),
    results
  };
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = urlPath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, urlPath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(normalized, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(normalized).toLowerCase();
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const route = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (!requireAuth(req, res)) {
      return;
    }

    if (route.pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, envConfig);
      return;
    }

    if (route.pathname === "/api/health" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const { env, service } = getTarget(payload.env, payload.service, "/");
      const result = {
        env: env.label,
        service: service.label,
        baseUrl: service.baseUrl,
        ...(await checkTcpPort(service.baseUrl))
      };
      sendJson(res, 200, result);
      return;
    }

    if (route.pathname === "/api/send" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await proxyRequest(payload);
      sendJson(res, 200, result);
      return;
    }

    if (route.pathname === "/api/topup" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await runTopup(payload);
      writeAuditLog(req, "one-step-transfer", payload, result);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }

    if (route.pathname === "/api/bulk-preview" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await previewBulkTransferOut(payload);
      sendJson(res, result.ok ? 200 : 422, result);
      return;
    }

    if (route.pathname === "/api/bulk-transfer-out" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await runBulkTransferOut(payload);
      writeAuditLog(req, "bulk-transfer-out", payload, result);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }

    if (route.pathname === "/api/bulk-in-preview" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await previewBulkTransferIn(payload);
      sendJson(res, result.ok ? 200 : 422, result);
      return;
    }

    if (route.pathname === "/api/bulk-transfer-in" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await runBulkTransferIn(payload);
      writeAuditLog(req, "bulk-transfer-in", payload, result);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }

    if (route.pathname === "/api/balance-check" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await checkBalances(payload);
      sendJson(res, result.ok ? 200 : 422, result);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message,
      hint: "Check that the selected batch port-forward is running and the API path is correct."
    });
  }
});

server.listen(PORT, () => {
  console.log(`Top-up money tool is running at http://localhost:${PORT}`);
});
