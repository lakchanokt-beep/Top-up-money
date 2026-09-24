const http = require("http");
const fs = require("fs");
const net = require("net");
const path = require("path");

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || path.join(__dirname, "logs", "audit.jsonl");
const DCB_SIT_BASE_URL = process.env.DCB_SIT_BASE_URL || process.env.DCB_BASE_URL || "http://127.0.0.2:8051";
const DCB_UAT_BASE_URL = process.env.DCB_UAT_BASE_URL || process.env.DCB_BASE_URL || "http://localhost:28051";
const DDP_SIT_ACCOUNT_FINANCIAL_URL = process.env.DDP_SIT_ACCOUNT_FINANCIAL_URL || process.env.DDP_ACCOUNT_FINANCIAL_URL || "http://127.0.0.2:8070/payment/v1/internal/deposit-adapter/account-financial";
const DDP_UAT_ACCOUNT_FINANCIAL_URL = process.env.DDP_UAT_ACCOUNT_FINANCIAL_URL || process.env.DDP_ACCOUNT_FINANCIAL_URL || "http://localhost:28070/payment/v1/internal/deposit-adapter/account-financial";
const CARDLESS_WITHDRAWAL_SIT_BASE_URL = process.env.CARDLESS_WITHDRAWAL_SIT_BASE_URL || "http://127.0.0.2:8081";
const CARDLESS_WITHDRAWAL_UAT_BASE_URL = process.env.CARDLESS_WITHDRAWAL_UAT_BASE_URL || "http://localhost:28081";
const CARDLESS_DEPOSIT_SIT_BASE_URL = process.env.CARDLESS_DEPOSIT_SIT_BASE_URL || "http://127.0.0.2:8045";
const CARDLESS_DEPOSIT_UAT_BASE_URL = process.env.CARDLESS_DEPOSIT_UAT_BASE_URL || "http://localhost:28045";
const CARDLESS_DEPOSIT_DEVOPS_KEY = process.env.CARDLESS_DEPOSIT_DEVOPS_KEY || "";
const DCB_TRANSFER_PATH = process.env.DCB_TRANSFER_PATH || "/api/v1/transfer";
const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "";
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || "";

const envConfig = {
  sit: {
    label: "CB SIT",
    awsProfile: "CB",
    region: "ap-southeast-7",
    cluster: "cb-core-bank-th-sit-eks-tm",
    ddpAccountFinancialUrl: DDP_SIT_ACCOUNT_FINANCIAL_URL,
    cardlessWithdrawalBaseUrl: CARDLESS_WITHDRAWAL_SIT_BASE_URL,
    cardlessDepositBaseUrl: CARDLESS_DEPOSIT_SIT_BASE_URL,
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: DCB_SIT_BASE_URL, postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: DCB_SIT_BASE_URL, postingType: "OUTBOUND" }
    }
  },
  uat: {
    label: "CB UAT",
    awsProfile: "CB",
    region: "ap-southeast-7",
    cluster: "cb-core-bank-th-uat-eks-tm",
    ddpAccountFinancialUrl: DDP_UAT_ACCOUNT_FINANCIAL_URL,
    cardlessWithdrawalBaseUrl: CARDLESS_WITHDRAWAL_UAT_BASE_URL,
    cardlessDepositBaseUrl: CARDLESS_DEPOSIT_UAT_BASE_URL,
    services: {
      dcbInbound: { label: "DCB adapter - Inbound", baseUrl: DCB_UAT_BASE_URL, postingType: "INBOUND" },
      dcbOutbound: { label: "DCB adapter - Outbound", baseUrl: DCB_UAT_BASE_URL, postingType: "OUTBOUND" }
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

function getDdpAccountFinancialUrl(envKey) {
  const env = envConfig[envKey];
  if (!env) throw new Error("Unknown environment");
  return env.ddpAccountFinancialUrl;
}

function getCardlessBaseUrl(envKey, flow) {
  const env = envConfig[envKey];
  if (!env) throw new Error("Unknown environment");
  return flow === "withdrawal" ? env.cardlessWithdrawalBaseUrl : env.cardlessDepositBaseUrl;
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

function atmDateParts(date = new Date()) {
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
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return {
    requestDateTime: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${milliseconds}+07:00`,
    transmissionDateTime: `${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`,
    localTransactionDate: `${parts.month}${parts.day}`,
    localTransactionTime: `${parts.hour}${parts.minute}${parts.second}`,
    captureDate: `${parts.year}${parts.month}${parts.day}`
  };
}

function randomDigits(length) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += Math.floor(Math.random() * 10);
  }
  return result;
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
  const requestUrl = getDdpAccountFinancialUrl(options.envKey);
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
  const response = await fetchJson(requestUrl, {
    method: "POST",
    headers: lookupHeaders,
    body: JSON.stringify(lookupBody)
  });

  return {
    requestUrl,
    requestHeaders: lookupHeaders,
    requestBody: lookupBody,
    ...response
  };
}

function parseAccountLines(text) {
  return String(text || "").match(/\d+/g) || [];
}

function parseLimitedAccountLines(text) {
  const accounts = parseAccountLines(text);
  return {
    accounts,
    ignoredAccounts: [],
    originalCount: accounts.length,
    ignoredCount: 0,
    limit: null
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

function cardlessStepResult(name, requestUrl, requestBody, response) {
  return {
    name,
    requestUrl,
    requestBody,
    status: response.status,
    statusText: response.statusText,
    durationMs: response.durationMs,
    body: response.json || response.text
  };
}

function withdrawalHeaders(mti, referenceCode, requestDateTime) {
  return {
    accept: "*/*",
    "content-type": "application/json",
    "user-agent": "top-up-money-tool",
    "x-channel": "ATM",
    "x-devops-dest": "DEV_TEST",
    "x-devops-key": "DEV_TEST",
    "x-devops-src": "DEV_TEST",
    "x-ref-id": `${mti}-0006FFFFFFF-K30001FFFFFFFFFF-${referenceCode}-165842683689`,
    "x-request-date-time": requestDateTime,
    "x-requester": "BASE24",
    "x-traceparent": traceparent()
  };
}

function withdrawalBody({
  mti,
  processingCode,
  transactionAmount,
  fromAccount = "",
  mobile,
  refCode,
  channelFlag,
  rrn,
  currencyCode,
  accessFee,
  systemFee,
  dates
}) {
  return {
    mti,
    cardRef: "",
    familyId: "",
    processingCode,
    transactionAmount,
    cardBillingAmount: "0.00",
    chBillingConvRate: "0.00",
    transmissionDateTime: dates.transmissionDateTime,
    localTransactionDate: dates.localTransactionDate,
    localTransactionTime: dates.localTransactionTime,
    captureDate: dates.captureDate,
    merchantCatCode: "5411",
    accessFee,
    posEntryMode: "051",
    inteface: "KTB",
    acquirerId: "0006",
    terminalId: "K40203",
    traceId: "000001",
    rrn,
    cardAcceptorIdentificationCode: "0006",
    location: "000081KRUNG THAI BANK BANGKOK      010TH",
    currencyCode,
    fromAccount,
    toAccount: "",
    originalDate: "",
    replacementAmount: "",
    panMarking: "888888xxxxxx1912",
    B24fee: accessFee,
    systemFee,
    cardlessInfo: {
      mobile,
      refCode,
      channelFlag
    }
  };
}

function extractWithdrawalState(json, fallback = {}) {
  const data = json && typeof json === "object" ? json.data : null;
  if (!data || typeof data !== "object") return { ...fallback };
  const cardlessInfo = data.cardlessInfo && typeof data.cardlessInfo === "object" ? data.cardlessInfo : {};

  return {
    accountNo: data.accountNo || fallback.accountNo || "",
    mobile: cardlessInfo.mobile || fallback.mobile || "",
    refCode: cardlessInfo.refCode || fallback.refCode || "",
    transactionAmount: data.txnAmount ?? fallback.transactionAmount ?? "",
    retrievalRefNo: data.retrievalRefNo || fallback.retrievalRefNo || ""
  };
}

async function runCardlessWithdrawal(payload) {
  const env = envConfig[payload.env];
  if (!env) throw new Error("Unknown environment");

  const amountNumber = Number(payload.transactionAmount);
  const mobile = String(payload.mobile || "").trim();
  const refCode = String(payload.refCode || "").trim();
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) throw new Error("transactionAmount must be greater than 0");
  if (!/^\d+$/.test(mobile)) throw new Error("mobile must contain numbers only");
  if (!/^\d+$/.test(refCode)) throw new Error("refCode must contain numbers only");

  const baseUrl = getCardlessBaseUrl(payload.env, "withdrawal");
  const amount = amountNumber.toFixed(2);
  const inquiryReference = randomDigits(6);
  const cashoutReference = randomDigits(6);
  const cashoutRrn = randomDigits(12);
  const steps = [];

  const inquiryDates = atmDateParts();
  const inquiryBody = withdrawalBody({
    mti: "0200",
    processingCode: "3V0000",
    transactionAmount: amount,
    mobile,
    refCode,
    channelFlag: "NC",
    rrn: "949131502804",
    currencyCode: "840",
    accessFee: "0",
    systemFee: "10",
    dates: inquiryDates
  });
  const inquiryUrl = new URL("/payment/v1/atm/cardless/inquiry", baseUrl).toString();
  const inquiry = await fetchJson(inquiryUrl, {
    method: "POST",
    headers: withdrawalHeaders("0200", inquiryReference, inquiryDates.requestDateTime),
    body: JSON.stringify(inquiryBody)
  });
  steps.push(cardlessStepResult("Inquiry withdrawal info", inquiryUrl, inquiryBody, inquiry));
  if (!inquiry.ok) {
    return { ok: false, env: env.label, flow: "Cardless Withdrawal", failedStep: 1, steps };
  }

  let state = extractWithdrawalState(inquiry.json);
  const missingInquiryFields = ["accountNo", "mobile", "refCode", "transactionAmount"].filter((field) => state[field] === "" || state[field] === null || state[field] === undefined);
  if (missingInquiryFields.length) {
    return {
      ok: false,
      env: env.label,
      flow: "Cardless Withdrawal",
      failedStep: 1,
      error: `Missing response fields: ${missingInquiryFields.join(", ")}`,
      steps
    };
  }

  const withdrawalDates = atmDateParts();
  const withdrawalRequestBody = withdrawalBody({
    mti: "0200",
    processingCode: "0V0000",
    transactionAmount: String(state.transactionAmount),
    fromAccount: String(state.accountNo),
    mobile: String(state.mobile),
    refCode: String(state.refCode),
    channelFlag: "VV",
    rrn: cashoutRrn,
    currencyCode: "764",
    accessFee: "0.00",
    systemFee: "0.00",
    dates: withdrawalDates
  });
  const withdrawalUrl = new URL("/payment/v1/atm/cardless/withdrawal", baseUrl).toString();
  const withdrawal = await fetchJson(withdrawalUrl, {
    method: "POST",
    headers: withdrawalHeaders("0200", cashoutReference, withdrawalDates.requestDateTime),
    body: JSON.stringify(withdrawalRequestBody)
  });
  steps.push(cardlessStepResult("Cardless withdrawal", withdrawalUrl, withdrawalRequestBody, withdrawal));
  if (!withdrawal.ok) {
    return { ok: false, env: env.label, flow: "Cardless Withdrawal", failedStep: 2, steps };
  }

  state = extractWithdrawalState(withdrawal.json, state);
  const confirmDates = atmDateParts();
  const confirmBody = withdrawalBody({
    mti: "0220",
    processingCode: "0V0000",
    transactionAmount: String(state.transactionAmount),
    fromAccount: String(state.accountNo),
    mobile: String(state.mobile),
    refCode: String(state.refCode),
    channelFlag: "VV",
    rrn: cashoutRrn,
    currencyCode: "764",
    accessFee: "0.00",
    systemFee: "0.00",
    dates: confirmDates
  });
  const confirmUrl = new URL("/payment/v1/atm/cardless/confirm", baseUrl).toString();
  const confirm = await fetchJson(confirmUrl, {
    method: "POST",
    headers: withdrawalHeaders("0220", cashoutReference, confirmDates.requestDateTime),
    body: JSON.stringify(confirmBody)
  });
  steps.push(cardlessStepResult("Confirm cashout", confirmUrl, confirmBody, confirm));

  return {
    ok: confirm.ok,
    env: env.label,
    flow: "Cardless Withdrawal",
    failedStep: confirm.ok ? null : 3,
    mapped: state,
    steps
  };
}

function depositHeaders(requestDateTime) {
  return {
    "content-type": "application/json",
    "x-ref-id": uuid(),
    "x-requester": "VB",
    "x-channel": "BASE24",
    "x-product": "ESAVINGS",
    "x-traceparent": traceparent(),
    "x-request-date-time": requestDateTime,
    "x-service": "Deposit",
    "x-devops-src": "vfs",
    "x-devops-dest": "vb-payment",
    "x-devops-key": CARDLESS_DEPOSIT_DEVOPS_KEY
  };
}

function depositBody({ mti, processingCode, transactionAmount, toAccount, location, dates }) {
  return {
    mti,
    cardRef: "8888880842345678",
    familyId: "FAM001",
    processingCode,
    transactionAmount,
    cardBillingAmount: 50.00,
    chBillingConvRate: "1.00",
    transmissionDateTime: dates.transmissionDateTime,
    localTransactionDate: dates.localTransactionDate,
    localTransactionTime: dates.localTransactionTime,
    captureDate: dates.captureDate,
    merchantCatCode: "",
    accessFee: 0.00,
    posEntryMode: "051",
    inteface: "KTB",
    acquirerId: "0006",
    terminalId: "TERMSIT001",
    traceId: "000123",
    rrn: "null",
    cardAcceptorIdentificationCode: "006",
    location,
    currencyCode: "764",
    toAccount,
    originalDate: dates.captureDate,
    replacementAmount: "123456789012000000001500",
    panMarking: "XXXXXXXXXXXX1234",
    B24fee: 0.00,
    cardlessInfo: {
      mobile: "0619515013",
      refCode: "123456",
      channelFlag: "NC"
    },
    acqFee: 0,
    issFee: 0,
    toFee: 0
  };
}

async function runCardlessDeposit(payload) {
  const env = envConfig[payload.env];
  if (!env) throw new Error("Unknown environment");
  if (!CARDLESS_DEPOSIT_DEVOPS_KEY) throw new Error("CARDLESS_DEPOSIT_DEVOPS_KEY is required");

  const transactionAmount = Number(payload.transactionAmount);
  const toAccount = String(payload.toAccount || "").trim();
  if (!Number.isFinite(transactionAmount) || transactionAmount <= 0) throw new Error("transactionAmount must be greater than 0");
  if (!/^\d+$/.test(toAccount)) throw new Error("toAccount must contain numbers only");

  const baseUrl = getCardlessBaseUrl(payload.env, "deposit");
  const requestUrl = new URL("/payment/v1/atm/card/deposit", baseUrl).toString();
  const steps = [];
  const inquiryDates = atmDateParts();
  const inquiryBody = depositBody({
    mti: "0200",
    processingCode: "2I0000",
    transactionAmount,
    toAccount,
    location: "000157KRUNGTHAI BANK CITYXXXXXXXXXX010TH",
    dates: inquiryDates
  });
  const inquiry = await fetchJson(requestUrl, {
    method: "POST",
    headers: depositHeaders(inquiryDates.requestDateTime),
    body: JSON.stringify(inquiryBody)
  });
  steps.push(cardlessStepResult("Deposit inquiry", requestUrl, inquiryBody, inquiry));
  if (!inquiry.ok) {
    return { ok: false, env: env.label, flow: "Cardless Deposit", failedStep: 1, steps };
  }

  const mappedAccountNo = inquiry.json?.data?.accountNo;
  if (!mappedAccountNo) {
    return {
      ok: false,
      env: env.label,
      flow: "Cardless Deposit",
      failedStep: 1,
      error: "Missing response field: accountNo",
      steps
    };
  }

  const depositDates = atmDateParts();
  const depositRequestBody = depositBody({
    mti: "0220",
    processingCode: "2E0000",
    transactionAmount,
    toAccount: String(mappedAccountNo),
    location: "000107KRUNGTHAI BANK CITYXXXXXXXXXX010TH",
    dates: depositDates
  });
  const deposit = await fetchJson(requestUrl, {
    method: "POST",
    headers: depositHeaders(depositDates.requestDateTime),
    body: JSON.stringify(depositRequestBody)
  });
  steps.push(cardlessStepResult("Deposit money", requestUrl, depositRequestBody, deposit));

  return {
    ok: deposit.ok,
    env: env.label,
    flow: "Cardless Deposit",
    failedStep: deposit.ok ? null : 2,
    mapped: { accountNo: String(mappedAccountNo) },
    steps
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
    envKey: payload.env,
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
      requestUrl: lookup.requestUrl,
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
    const lookup = await lookupAccountFinancial(account, { envKey: payload.env, requestDateTime, channel });
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
    const lookup = await lookupAccountFinancial(account, { envKey: payload.env, requestDateTime, channel });
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
    const lookup = await lookupAccountFinancial(account, { envKey: payload.env, requestDateTime, channel });
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

    if (route.pathname === "/api/cardless-withdrawal" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await runCardlessWithdrawal(payload);
      writeAuditLog(req, "cardless-withdrawal", payload, result);
      sendJson(res, result.ok ? 200 : 502, result);
      return;
    }

    if (route.pathname === "/api/cardless-deposit" && req.method === "POST") {
      const payload = JSON.parse(await readBody(req) || "{}");
      const result = await runCardlessDeposit(payload);
      writeAuditLog(req, "cardless-deposit", payload, result);
      sendJson(res, result.ok ? 200 : 502, result);
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
