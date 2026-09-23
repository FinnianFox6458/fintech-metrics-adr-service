import test from 'node:test';
import assert from 'node:assert/strict';
import { decidePaymentReview, paymentEventSchema } from '../src/payment_review';

test('high-risk cross-border payment is blocked with audit reasons', () => {
  const input = paymentEventSchema.parse({
    payment_id: 'pay_test_block',
    merchant_id: 'mrc_test',
    customer_id: 'cus_test',
    amount_usd: 12000,
    currency: 'USD',
    card_country: 'US',
    ip_country: 'NG',
    velocity_1h: 6,
    chargeback_ratio_30d: 0.1,
    payment_method: 'card',
    event_time: '2026-01-15T10:00:00.000Z',
    request_id: 'req_test_block'
  });

  const decision = decidePaymentReview(input);

  assert.equal(decision.action, 'block');
  assert.equal(decision.risk_score, 150);
  assert.deepEqual(decision.reasons, [
    'high_amount',
    'geo_mismatch',
    'high_velocity',
    'merchant_chargeback_spike'
  ]);
  assert.match(decision.notification_message, /action=block/);
});
