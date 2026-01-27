/*
 * Business Model Setup for OpenBio
 * Instance-based licensing without user accounts
 */

-- Supabase Schema (PostgreSQL)

CREATE TABLE licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key VARCHAR(255) UNIQUE NOT NULL,
  tier VARCHAR(50) NOT NULL, -- 'hub' or 'enterprise'
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'expired', 'revoked'
  email VARCHAR(255) NOT NULL, -- For contact only, not for login
  organization_name VARCHAR(255),
  
  -- Server binding (optional, for enforcement)
  server_id VARCHAR(255), -- Machine fingerprint
  
  -- Dates
  created_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  last_validated_at TIMESTAMP,
  
  -- Stripe integration
  stripe_payment_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  
  -- Metadata
  metadata JSONB, -- Custom data like seat count, etc
  
  CONSTRAINT valid_tier CHECK (tier IN ('hub', 'enterprise'))
);

CREATE TABLE license_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key VARCHAR(255) NOT NULL REFERENCES licenses(license_key),
  server_id VARCHAR(255),
  validated_at TIMESTAMP DEFAULT now(),
  valid BOOLEAN NOT NULL,
  reason VARCHAR(255) -- Why validation failed (expired, revoked, etc)
);

CREATE TABLE stripe_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_licenses_key ON licenses(license_key);
CREATE INDEX idx_licenses_status ON licenses(status);
CREATE INDEX idx_licenses_expires ON licenses(expires_at);
CREATE INDEX idx_validations_key ON license_validations(license_key);

-- Trial license that works offline for 14 days
INSERT INTO licenses (
  license_key,
  tier,
  status,
  email,
  organization_name,
  expires_at
) VALUES (
  'TRIAL-' || gen_random_uuid()::text,
  'hub',
  'active',
  'trial@openbio.app',
  'Trial Account',
  NOW() + INTERVAL '14 days'
);
