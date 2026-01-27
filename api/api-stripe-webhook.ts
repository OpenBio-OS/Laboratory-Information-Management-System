// API Function for Vercel: api/stripe/webhook.ts
// Handles Stripe webhooks for license activation

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook Error: ${err}`);
  }

  // Handle subscription created/updated
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'invoice.payment_succeeded'
  ) {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.subscription) {
      // Generate license key for activated subscription
      const licenseKey = `LIC-${crypto
        .randomBytes(16)
        .toString('hex')
        .toUpperCase()}`;

      // License valid for 1 year
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      const { error } = await supabase.from('licenses').insert({
        license_key: licenseKey,
        tier: (session.metadata?.tier as string) || 'hub',
        status: 'active',
        email: session.customer_email,
        organization_name: session.metadata?.organization_name,
        stripe_subscription_id: session.subscription as string,
        expires_at: expiresAt.toISOString(),
      });

      if (error) {
        console.error('Failed to create license:', error);
        return res.status(500).send('Failed to create license');
      }

      console.log(`License generated: ${licenseKey}`);
    }
  }

  // Handle subscription cancelled
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;

    // Mark associated licenses as inactive
    await supabase
      .from('licenses')
      .update({ status: 'inactive' })
      .eq('stripe_subscription_id', subscription.id);
  }

  return res.status(200).json({ received: true });
}
