// API Function for Vercel: api/license/purchase.ts
// Handles Stripe payment and license generation

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PurchaseRequest {
  tier: 'hub' | 'enterprise'; // No user account, just tier
  email: string; // For license contact only
  organization_name?: string;
  billing_cycle: 'monthly' | 'annual';
}

interface PurchaseResponse {
  checkout_url?: string;
  error?: string;
  trial_license?: string;
}

const PRICING = {
  hub: {
    monthly: 9900, // $99.00
    annual: 99900, // $999.00
  },
  enterprise: {
    monthly: 49900, // $499.00
    annual: 499900, // $4,999.00
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse<PurchaseResponse>
) {
  if (req.method === 'POST' && req.body.action === 'start-trial') {
    // Generate trial license (14 day offline-only)
    const trialKey = `TRIAL-${crypto
      .randomBytes(16)
      .toString('hex')
      .toUpperCase()}`;

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const { error } = await supabase.from('licenses').insert({
      license_key: trialKey,
      tier: req.body.tier,
      status: 'active',
      email: req.body.email,
      organization_name: req.body.organization_name || 'Trial',
      expires_at: trialEnd.toISOString(),
    });

    if (error) {
      return res
        .status(500)
        .json({ error: 'Failed to create trial license' });
    }

    return res.status(200).json({ trial_license: trialKey });
  }

  if (req.method !== 'POST' || req.body.action !== 'checkout') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tier, email, organization_name, billing_cycle } =
    req.body as PurchaseRequest;

  if (!tier || !email) {
    return res.status(400).json({ error: 'Missing tier or email' });
  }

  try {
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `OpenBio ${tier === 'hub' ? 'Hub' : 'Enterprise'} License`,
              description: `${billing_cycle === 'annual' ? 'Annual' : 'Monthly'} subscription`,
            },
            recurring: {
              interval: billing_cycle === 'annual' ? 'year' : 'month',
              interval_count: 1,
            },
            unit_amount: PRICING[tier][billing_cycle],
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.VERCEL_URL}/license/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VERCEL_URL}/license/cancel`,
      customer_email: email,
      metadata: {
        tier,
        organization_name: organization_name || 'Unknown',
      },
    });

    return res.status(200).json({ checkout_url: session.url });
  } catch (error) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
