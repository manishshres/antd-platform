-- Per-store auto-accept toggle for marketplace orders. Default true preserves the
-- existing behavior (orders auto-accept on import); set false to require a manual
-- accept/deny from the POS or dashboard within the provider's accept window.

ALTER TABLE "integration_accounts" ADD COLUMN IF NOT EXISTS "auto_accept_orders" boolean DEFAULT true NOT NULL;
