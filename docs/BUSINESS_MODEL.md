# OpenBio Business Model: Instance-Based Licensing

## Executive Summary

**Instance-based licensing without user accounts**
- Charge per server/deployment, not per user
- No user management overhead
- Compliance-friendly for enterprises
- Aligns with actual resource usage

## Pricing Tiers

### Solo Mode (FREE)
- Single researcher deployments
- Unlimited data
- No license required
- Forever free

### Hub Mode ($99-$990/year)
- Multi-researcher lab deployments
- Shared server
- $99/month or $990/year per instance
- 14-day free trial
- License key required after trial

### Enterprise Docker ($499-$4,990/year)
- Docker containerized deployment
- $499/month or $4,990/year per instance
- 14-day free trial
- Tied to specific Docker instance

## How It Works

### User Flow

```
1. Download & Install
   ↓
2. Choose Deployment Mode
   ├─ Solo → Free, no license needed
   └─ Hub/Enterprise → Show payment options
      ├─ Start 14-day trial (generates offline license)
      └─ Go to openbio.app/pricing → Pay with Stripe → Get license key
   ↓
3. Enter License Key in Setup
   ↓
4. Validation
   ├─ Online: Check with backend API, cache locally
   └─ Offline: Use cached license (30-day grace period)
   ↓
5. License renews automatically (Stripe subscription)
```

### License Key Format

```
Example: LIC-A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6

- Generated cryptographically
- Base58 encoded for readability
- Single key per instance
- Non-transferable between servers
```

### Server Identification

Each server gets a unique fingerprint:
- **macOS**: IOPlatformUUID
- **Linux**: /etc/machine-id
- **Windows**: WMIC UUID

License validates server ID on online check. Offline mode doesn't check server ID (grace period).

## Tech Stack

### Frontend (Tauri App)
- Detect deployment mode
- Show license dialog if needed
- Generate server ID
- Validate license (online/offline)
- Store cached license locally

### Backend (Vercel + Supabase)
- **API Endpoints:**
  - `POST /api/license/validate` - Check license validity
  - `POST /api/license/purchase` - Start checkout or trial
  - `POST /api/stripe/webhook` - Handle payments
- **Database:** Supabase PostgreSQL
- **Payments:** Stripe subscriptions

### Database Tables

```sql
licenses
├── license_key (unique)
├── tier (hub, enterprise)
├── status (active, inactive, expired, revoked)
├── email (contact only)
├── organization_name
├── server_id (optional, for binding)
├── expires_at
├── stripe_subscription_id
└── metadata (JSONB)

license_validations
├── license_key (FK)
├── server_id
├── validated_at
├── valid (bool)
└── reason

stripe_webhooks
├── event_id (unique)
├── event_type
└── data
```

## Revenue Model

### Example Scenarios

**Small Lab (Hub Mode, Annual)**
- $990/year = $82.50/month
- 3 researchers sharing 1 instance

**Enterprise Docker**
- $4,990/year = $415/month
- On-premise deployment

### Projected Unit Economics (100 users)

| Tier | Users | Annual Revenue |
|------|-------|-----------------|
| Solo | 60 | $0 |
| Hub | 35 | $34,650 |
| Enterprise | 5 | $24,950 |
| **Total** | **100** | **$59,600** |

(This is conservative - many hub users may upgrade)

## Implementation Roadmap

### Phase 1: MVP (NOW)
- [ ] Supabase setup
- [ ] Vercel functions deployed
- [ ] Stripe account configured
- [ ] Basic license validation in app
- [ ] Trial license generation

### Phase 2: Payment Flow (2-4 weeks)
- [ ] Landing page with pricing
- [ ] Stripe checkout integration
- [ ] License generation on payment
- [ ] Email notification system

### Phase 3: Management Portal (1-2 months)
- [ ] View active licenses
- [ ] Manage subscriptions
- [ ] See usage/validation logs
- [ ] Support dashboard

### Phase 4: Advanced Features (Ongoing)
- [ ] License transfer/upgrade
- [ ] Volume discounts
- [ ] Multi-server deployments
- [ ] API for license management

## Security Considerations

### Key Protection
- Private keys stored in Supabase with encryption
- License validation requires HTTPS
- Stripe handles PCI compliance
- No sensitive data in client app

### Fraud Prevention
- Server ID binding prevents key sharing
- Online validation every 30 days required
- License revocation on payment failure
- Audit trail of all validations

### No Data Collection
- No user tracking (no user accounts)
- License validation doesn't expose data
- Anonymous usage statistics only
- GDPR compliant (minimal data collection)

## Monetization Mechanics

### Why This Works

1. **No User Accounts**
   - Eliminates account management overhead
   - Privacy-friendly for labs
   - Simpler compliance

2. **Instance-Based**
   - Easy to enforce (one server = one license)
   - Fair pricing model
   - Scales with actual usage

3. **Soft Enforcement**
   - 14-day trial gets people invested
   - 30-day offline grace prevents anger
   - Non-blocking nags (not full lockout)
   - Focus on value, not punishment

4. **Open Source Trust**
   - Users know source is auditable
   - No hidden data collection
   - Support community adoption

## Comparison to Alternatives

| Model | Pros | Cons |
|-------|------|------|
| **Instance-based (Ours)** | Simple, fair, easy audit | Lower ARPU than per-user |
| Per-user licensing | Higher revenue | Complex tracking, privacy issues |
| AGPL dual-license | Compliance-based | Legal complexity |
| Hosted SaaS only | Highest revenue | Abandons open source benefits |
| Pure open source | Perfect adoption | Zero revenue |

## Go-to-Market

### Initial Target: Academic Labs
- Price-sensitive (❌ expensive SaaS)
- Value open source (✅ reproducibility)
- Want on-premise (✅ Hub mode)
- Small teams (✅ $99/month not a blocker)

### Secondary: Enterprise Biotech
- Need on-premise (✅ Docker)
- Have budgets (✅ $499/month OK)
- Compliance requirements (✅ audit trail)
- Support needs (✅ documentation)

## Support & Maintenance

### Free Users (Solo)
- Community forums
- Documentation
- GitHub issues

### Paid Users (Hub/Enterprise)
- Email support
- Guaranteed response time
- Priority updates
- Custom deployment help

## Next Steps

1. **Set up Supabase** (free tier works initially)
2. **Deploy Vercel functions** (serverless, pay-per-call)
3. **Configure Stripe** (no monthly fee, per-transaction)
4. **Integrate into app** (use licensing.rs module)
5. **Test end-to-end** (trial → purchase → validate)
6. **Create pricing landing page** (simple, clear)
