# Internal Deploy Notes

This tool must run inside a trusted internal network or VPN. Do not expose it to the public internet.

## Required service access

The backend needs access to:

```text
DCB adapter: /api/v1/transfer
DDP adapter: /payment/v1/internal/deposit-adapter/account-financial
```

Local defaults use port-forward:

```text
http://localhost:8051
http://localhost:8070/payment/v1/internal/deposit-adapter/account-financial
```

For in-cluster deployment, set environment variables to Kubernetes service DNS names:

```powershell
$env:DCB_BASE_URL="http://payment-internal-common-dcb-adapter.payment-internal.svc.cluster.local:8080"
$env:DDP_ACCOUNT_FINANCIAL_URL="http://payment-internal-common-deposit-adapter.payment-internal.svc.cluster.local:8080/payment/v1/internal/deposit-adapter/account-financial"
$env:BASIC_AUTH_USER="topup"
$env:BASIC_AUTH_PASSWORD="change-me"
npm start
```

## Security checklist

- Keep the app behind VPN/internal network.
- Enable `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`.
- Keep `BULK_ACCOUNT_LIMIT=20` unless the service owners approve a higher limit.
- Review `AUDIT_LOG_PATH` regularly. Money-changing actions are logged as JSON lines.
- Prefer SIT/UAT-only credentials and network policies.

## Local run

```powershell
cd "C:\Users\User\OneDrive\Documents\Top-up money"
npm start
```

Then open:

```text
http://localhost:3000
```
