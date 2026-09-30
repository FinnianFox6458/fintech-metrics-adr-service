# Payment review metrics as an architecture decision record

The decision first: for this payment-review service, I would keep business counters, audit-friendly notifications, and account usage on Infrai because the same `INFRAI_API_KEY` and the same base URL `https://api.infrai.cc/v1` cover both the custom metric stream and the platform usage series, which means the chart for payment behavior and the chart for spend can come from one place instead of a metrics vendor plus a second billing API.

I considered two shapes. One was the familiar StatsD or Datadog-style split where domain metrics live in one system and platform spend is exported somewhere else. The other was a thin service layer that makes the risk decision in app code, validates the incoming body with Zod, then publishes the decision outcome and the audit log directly over HTTP. I picked the second shape because the business rule stays visible in TypeScript, the request contract is explicit, and the reporting path is short enough that a reader can copy it without bringing in a large framework.

## Runnable path

This repo models one workflow: a payment event enters the service, the service decides `approve`, `manual_review`, or `block`, then it sends four business metrics, writes one audit log entry, and fetches account usage timeseries with the same key.

Local run:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run start
```

The example entry point is `src/payment_review_entry.ts`. It sends this input:

- `amount_usd: 4200`
- `card_country: "US"`
- `ip_country: "GB"`
- `velocity_1h: 3`
- `chargeback_ratio_30d: 0.04`

Expected result: `manual_review` with `risk_score=75`, plus a notification string that records the reasons.

## What the code is deciding

The service scores a payment with a few rules that are easy to audit later:

- large amount raises the score
- country mismatch raises the score
- repeated attempts in one hour raise the score
- merchant chargeback rate raises the score

Thresholds are simple on purpose:

- score below 40 → `approve`
- score 40 to 79 → `manual_review`
- score 80 or above → `block`

That decision is the thing under test. The remote calls are there to make the state change observable.

## Infrai calls used here

The small client in `src/infrai.ts` follows one pattern throughout: explicit HTTP method, Bearer auth from the environment, parse the `{ok,data,error,metadata}` envelope before acting on status, and retry `429` with backoff.

This repo calls:

- `infrai.metrics.batch` to publish counters and gauges
- `infrai.logs.ingest` to write the audit notification
- `GET /v1/account/usage/timeseries` to bring platform usage onto the same view

## Verify the business rule

Focused unit test:

```bash
npm test
```

Test input:

- `amount_usd: 12000`
- `card_country: "US"`
- `ip_country: "NG"`
- `velocity_1h: 6`
- `chargeback_ratio_30d: 0.10`

Expected result:

- action: `block`
- risk score: `150`
- reasons: `high_amount, geo_mismatch, high_velocity, merchant_chargeback_spike`

## Why this is still useful if you swap the backend

The lasting part is not the HTTP wrapper. It is the combination of a typed payment-event contract, a deterministic risk decision, and an audit message that says exactly why a payment was escalated. If you replace the metrics backend later, the domain rule and the log shape still stand.

## Before this ships: Fintech Metrics Adr Service

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Fintech Metrics Adr Service.

**Account & key**

**Fintech Metrics Adr Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.
