// API Function for Vercel: api/license/validate.ts
// Deploy this to Vercel and connect to Supabase

import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ValidateRequest {
  license_key: string;
  server_id?: string; // Machine fingerprint
}

interface ValidateResponse {
  valid: boolean;
  tier?: string;
  expires_at?: string;
  reason?: string;
  organization_name?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse<ValidateResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, reason: 'Method not allowed' });
  }

  const { license_key, server_id } = req.body as ValidateRequest;

  if (!license_key) {
    return res.status(400).json({ valid: false, reason: 'Missing license_key' });
  }

  try {
    // Fetch license from database
    const { data: license, error } = await supabase
      .from('licenses')
      .select('*')
      .eq('license_key', license_key)
      .single();

    if (error || !license) {
      await logValidation(license_key, server_id, false, 'License not found');
      return res
        .status(404)
        .json({ valid: false, reason: 'License not found' });
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(license.expires_at);
    if (now > expiresAt) {
      await logValidation(license_key, server_id, false, 'License expired');
      return res
        .status(401)
        .json({ valid: false, reason: 'License expired' });
    }

    // Check if revoked/inactive
    if (license.status !== 'active') {
      await logValidation(
        license_key,
        server_id,
        false,
        `License ${license.status}`
      );
      return res
        .status(403)
        .json({ valid: false, reason: `License ${license.status}` });
    }

    // Check server binding (if set)
    if (license.server_id && license.server_id !== server_id) {
      await logValidation(license_key, server_id, false, 'Server ID mismatch');
      return res.status(403).json({
        valid: false,
        reason: 'This license is bound to a different server',
      });
    }

    // Update last validated
    await supabase
      .from('licenses')
      .update({ last_validated_at: now.toISOString() })
      .eq('license_key', license_key);

    // Log successful validation
    await logValidation(license_key, server_id, true);

    return res.status(200).json({
      valid: true,
      tier: license.tier,
      expires_at: license.expires_at,
      organization_name: license.organization_name,
    });
  } catch (error) {
    console.error('Validation error:', error);
    return res
      .status(500)
      .json({ valid: false, reason: 'Internal server error' });
  }
}

async function logValidation(
  licenseKey: string,
  serverId: string | undefined,
  valid: boolean,
  reason?: string
) {
  await supabase.from('license_validations').insert({
    license_key: licenseKey,
    server_id: serverId,
    valid,
    reason,
  });
}
