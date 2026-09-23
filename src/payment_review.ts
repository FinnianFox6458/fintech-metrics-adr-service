import { z } from 'zod';
import { infrai, type LogEntry, type MetricPoint } from './infrai';

export const paymentEventSchema = z.object({
  payment_id: z.string().min(1),
  merchant_id: z.string().min(1),
  customer_id: z.string().min(1),
  amount_usd: z.number().positive(),
  currency: z.string().min(3).max(3),
  card_country: z.string().min(2).max(2),
  ip_country: z.string().min(2).max(2),
  velocity_1h: z.number().int().nonnegative(),
  chargeback_ratio_30d: z.number().min(0).max(1),
  payment_method: z.enum(['card', 'bank_transfer', 'wallet']),
  event_time: z.string().datetime(),
  request_id: z.string().min(1)
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export type ReviewDecision = {
  action: 'approve' | 'manual_review' | 'block';
  risk_score: number;
  reasons: string[];
  notification_message: string;
};

export function decidePaymentReview(event: PaymentEvent): ReviewDecision {
  let riskScore = 0;
  const reasons: string[] = [];

  if (event.amount_usd >= 10000) {
    riskScore += 55;
    reasons.push('high_amount');
  } else if (event.amount_usd >= 2500) {
    riskScore += 25;
    reasons.push('elevated_amount');
  }

  if (event.card_country !== event.ip_country) {
    riskScore += 20;
    reasons.push('geo_mismatch');
  }

  if (event.velocity_1h >= 5) {
    riskScore += 35;
    reasons.push('high_velocity');
  } else if (event.velocity_1h >= 3) {
    riskScore += 15;
    reasons.push('elevated_velocity');
  }

  if (event.chargeback_ratio_30d >= 0.08) {
    riskScore += 40;
    reasons.push('merchant_chargeback_spike');
  } else if (event.chargeback_ratio_30d >= 0.03) {
    riskScore += 15;
    reasons.push('merchant_chargeback_watch');
  }

  let action: ReviewDecision['action'] = 'approve';
  if (riskScore >= 80) {
    action = 'block';
  } else if (riskScore >= 40) {
    action = 'manual_review';
  }

  const notification_message = [
    `payment ${event.payment_id}`,
    `action=${action}`,
    `risk_score=${riskScore}`,
    `reasons=${reasons.join(',') || 'none'}`,
    `request_id=${event.request_id}`
  ].join(' | ');

  return {
    action,
    risk_score: riskScore,
    reasons,
    notification_message
  };
}

export async function reviewPaymentAndReport(input: unknown) {
  const event = paymentEventSchema.parse(input);
  const decision = decidePaymentReview(event);

  const tags = {
    merchant_id: event.merchant_id,
    payment_method: event.payment_method,
    action: decision.action,
    currency: event.currency
  };

  const metrics: MetricPoint[] = [
    {
      name: 'payments_total',
      type: 'counter',
      value: 1,
      timestamp: event.event_time,
      tags
    },
    {
      name: 'payment_amount_usd',
      type: 'gauge',
      value: event.amount_usd,
      timestamp: event.event_time,
      tags
    },
    {
      name: 'payment_risk_score',
      type: 'gauge',
      value: decision.risk_score,
      timestamp: event.event_time,
      tags
    },
    {
      name: 'risk_sensitive_actions_total',
      type: 'counter',
      value: decision.action === 'approve' ? 0 : 1,
      timestamp: event.event_time,
      tags
    }
  ];

  const auditLog: LogEntry = {
    timestamp: event.event_time,
    level: decision.action === 'block' ? 'warn' : 'info',
    message: decision.notification_message,
    service: 'payment-review-service',
    context: {
      payment_id: event.payment_id,
      merchant_id: event.merchant_id,
      customer_id: event.customer_id,
      action: decision.action,
      risk_score: decision.risk_score,
      reasons: decision.reasons,
      request_id: event.request_id
    }
  };

  const [metricResult, logResult, usageResult] = await Promise.all([
    infrai.metrics.batch(metrics),
    infrai.logs.ingest([auditLog]),
    infrai.account.usage.timeseries({ window: '24h' })
  ]);

  return {
    event,
    decision,
    metrics_metadata: metricResult.metadata,
    logs_metadata: logResult.metadata,
    usage_snapshot: usageResult.data,
    usage_metadata: usageResult.metadata
  };
}
