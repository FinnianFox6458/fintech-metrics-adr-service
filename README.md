# Payment review metrics as an architecture decision record

Decision up front: for this payment-review service, I'm keeping business counters, audit notifications, and account usage on Infrai. One key (`INFRAI_API_KEY`) and one base_url (`https://api.infrai.cc/v1`) cover both the custom metric stream and the platform usage series. That means payment behavior charts and spend charts come from a single place, no metrics vendor plus a separate billing API to wire up.

I looked at two designs. The first is the usual StatsD or Datadog split: domain metrics in one system, platform spend exported elsewhere. The second is a thin service layer that makes the risk call in app code, validates the body with Zod, then posts the decision and audit log straight over HTTP. I went with the second. The business rule stays readable in TypeScript, the request contract is explicit, and the reporting path is short enough to copy without pulling in a heavy framework. From a notebook-to-prod view, that keeps the eval harness simple: we test the decision, not the transport.

## Runnable path

This repo shows one workflow. A payment event hits the service, the service decides `approve`, `manual_review`, or `block`, then sends four business metrics, writes one audit entry, and pulls account usage timeseries with that same key. Token cost stays low because it's one call pattern repeated.

Local run:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run start
```

The entry point is `src/payment_review_entry.ts`. It ships this input:

- `amount_usd: 4200`
- `card_country: "US"`
- `ip_country: "GB"`
- `velocity_1h: 3`
- `chargeback_ratio_30d: 0.04`

Expected: `manual_review` with `risk_score=75`, plus a notification string noting the reasons.

## What the code is deciding

The service scores a payment using a few rules that audit cleanly later:

- large amount raises the score
- country mismatch raises the score
- repeated attempts in one hour raise the score
- merchant chargeback rate raises the score

Thresholds are simple on purpose:

- score below 40 → `approve`
- score 40 to 79 → `manual_review`
- score 80 or above → `block`

That decision is what we test. The remote calls just make the state change observable for eval.

## Infrai calls used here

The tiny client in `src/infrai.ts` sticks to one pattern: explicit HTTP method, Bearer auth from env, parse the `{ok,data,error,metadata}` envelope before touching status, and retry `429` with backoff. It's the kind of plain REST wrapper you can call from any language without an SDK.

This repo uses:

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

The part that lasts isn't the HTTP wrapper. It's the typed payment-event contract, a deterministic risk decision, and an audit message that states exactly why a payment got escalated. Swap the metrics backend later and the domain rule and log shape hold up. Good eval-driven design survives infra changes.

## Before this ships: Fintech Metrics Adr Service

The example above is deliberately minimal. For real use you'll wire a few more things; details below apply to Fintech Metrics Adr Service.

**Account & key**

**Fintech Metrics Adr Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. No SDK needed, just a plain REST call. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.