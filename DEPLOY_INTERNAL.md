# Internal Deploy Notes

This tool must run inside a trusted internal network or VPN. Do not expose it to the public internet.

## Required service access

The backend needs access to:

```text
DCB adapter: /api/v1/transfer
DDP adapter: /payment/v1/internal/deposit-adapter/account-financial
Cardless withdrawal: /payment/v1/atm/cardless/*
Cardless deposit: /payment/v1/atm/card/deposit
```

Local defaults use port-forward:

```text
CB SIT DCB: http://127.0.0.2:8051
CB SIT DDP: http://127.0.0.2:8070/payment/v1/internal/deposit-adapter/account-financial
CB UAT DCB: http://localhost:28051
CB UAT DDP: http://localhost:28070/payment/v1/internal/deposit-adapter/account-financial
CB SIT Cardless withdrawal: http://127.0.0.2:8081
CB UAT Cardless withdrawal: http://localhost:28081
CB SIT Cardless deposit: http://127.0.0.2:8045
CB UAT Cardless deposit: http://localhost:28045
```

For in-cluster deployment, set environment variables to Kubernetes service DNS names:

```powershell
$env:DCB_SIT_BASE_URL="http://payment-internal-common-dcb-adapter.payment-internal.svc.cluster.local:8080"
$env:DCB_UAT_BASE_URL="http://payment-internal-common-dcb-adapter.payment-internal.svc.cluster.local:8080"
$env:DDP_SIT_ACCOUNT_FINANCIAL_URL="http://payment-internal-common-deposit-adapter.payment-internal.svc.cluster.local:8080/payment/v1/internal/deposit-adapter/account-financial"
$env:DDP_UAT_ACCOUNT_FINANCIAL_URL="http://payment-internal-common-deposit-adapter.payment-internal.svc.cluster.local:8080/payment/v1/internal/deposit-adapter/account-financial"
$env:CARDLESS_DEPOSIT_DEVOPS_KEY="replace-with-internal-key"
$env:BASIC_AUTH_USER="topup"
$env:BASIC_AUTH_PASSWORD="change-me"
npm start
```

## Security checklist

- Keep the app behind VPN/internal network.
- Enable `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`.
- Review `AUDIT_LOG_PATH` regularly. Money-changing actions are logged as JSON lines.
- Prefer SIT/UAT-only credentials and network policies.

## Local run

```powershell
cd "C:\Users\User\OneDrive\Documents\Top-up money"
Copy-Item .env.example .env
# Edit .env and replace CARDLESS_DEPOSIT_DEVOPS_KEY with the internal value.
npm start
```

Then open:

```text
http://localhost:3000
```
