import { reviewPaymentAndReport } from './payment_review';

const examplePayment = {
  payment_id: 'pay_1001',
  merchant_id: 'mrc_bookstore',
  customer_id: 'cus_42',
  amount_usd: 4200,
  currency: 'USD',
  card_country: 'US',
  ip_country: 'GB',
  velocity_1h: 3,
  chargeback_ratio_30d: 0.04,
  payment_method: 'card',
  event_time: '2026-01-15T10:00:00.000Z',
  request_id: 'req_pay_1001'
};

async function main() {
  const result = await reviewPaymentAndReport(examplePayment);
  console.log(JSON.stringify({
    payment_id: result.event.payment_id,
    action: result.decision.action,
    risk_score: result.decision.risk_score,
    notification_message: result.decision.notification_message,
    usage_snapshot: result.usage_snapshot
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
