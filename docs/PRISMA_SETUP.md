# Prisma Client Generation

This project uses [prisma-client-rust](https://github.com/Brendonovich/prisma-client-rust) for database access.

## Workflow for Schema Changes

When you modify `database/schema.prisma`:

1. **Create a migration:**
   ```bash
   cargo prisma migrate dev --name describe_your_change
   ```
   This generates:
   - A migration SQL file in `database/migrations/`
   - Updates the Prisma client

2. **Update the migrations module:**
   Add the new migration to `crates/openbio-server/src/db/migrations.rs`:
   ```rust
   Migration {
       name: "YYYYMMDDHHMMSS_your_migration".to_string(),
       sql: include_str!("../../../../database/migrations/YYYYMMDDHHMMSS_your_migration/migration.sql"),
   },
   ```

3. **Build and test:**
   ```bash
   cargo build
   ```

The app will automatically apply all pending migrations on startup!

## How It Works

- **Development**: Migrations are embedded at compile-time from `database/migrations/`
- **Runtime**: On app startup, the migration system:
  1. Creates `_prisma_migrations` tracking table
  2. Checks which migrations have been applied
  3. Applies pending migrations in order
  4. Each user's local database is automatically migrated

## Manual Commands

Generate Prisma client only (without creating migration):
```bash
cargo prisma generate
```

Reset database (CAUTION - deletes all data):
```bash
cargo prisma migrate reset
```

## Notes

- Migrations are embedded in the binary - no separate migration files needed at runtime
- Each user gets automatic database migrations on first launch
- Migration tracking is compatible with Prisma's standard `_prisma_migrations` table
- Never edit generated files in `database/migrations/` manually

