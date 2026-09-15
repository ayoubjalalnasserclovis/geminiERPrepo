-- ============================================================================
-- 07 — Payments (Stoniz) & travaux_payments (artisans)
-- ============================================================================

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('acompte_stoniz','honoraires_compromis','honoraires_livraison','autre')),
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  amount_expected NUMERIC(14,2) NOT NULL,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid','overdue')),
  due_at_phase project_phase,
  due_date DATE,
  paid_at DATE,
  payment_method TEXT,
  notes TEXT,
  invoice_number TEXT UNIQUE,
  reminder_sent_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount_paid >= 0 AND amount_paid <= amount_expected * 1.05)
);

CREATE INDEX payments_project_status_idx
  ON payments (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX payments_due_pending_idx
  ON payments (due_date) WHERE status <> 'paid' AND deleted_at IS NULL;

CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION sync_payment_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_paid >= NEW.amount_expected THEN
    NEW.status := 'paid';
    IF NEW.paid_at IS NULL THEN NEW.paid_at := CURRENT_DATE; END IF;
  ELSIF NEW.amount_paid > 0 THEN
    NEW.status := 'partial';
  ELSIF NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'overdue';
  ELSE
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_sync_status BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION sync_payment_status();

-- ─── Travaux payments (MAD par défaut) ──────────────────────────────────────
CREATE TABLE travaux_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artisan_name TEXT NOT NULL,
  artisan_type TEXT,
  category TEXT CHECK (category IN ('gros_oeuvre','plomberie','electricite','menuiserie','peinture','deco','fournitures','autre')),
  description TEXT,
  currency CHAR(3) NOT NULL DEFAULT 'MAD',
  amount_total NUMERIC(14,2) NOT NULL,
  amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  exchange_rate_eur NUMERIC(10,6),
  exchange_rate_at TIMESTAMPTZ,
  amount_total_eur NUMERIC(14,2) GENERATED ALWAYS AS (
    CASE WHEN exchange_rate_eur IS NOT NULL AND exchange_rate_eur > 0
      THEN ROUND(amount_total / exchange_rate_eur, 2)
      ELSE NULL END
  ) STORED,
  payment_type TEXT CHECK (payment_type IN ('acompte','solde','autre')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid')),
  scheduled_date DATE,
  paid_at DATE,
  notes TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount_paid >= 0 AND amount_paid <= amount_total * 1.05)
);

CREATE INDEX travaux_project_status_idx
  ON travaux_payments (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX travaux_scheduled_idx
  ON travaux_payments (scheduled_date) WHERE status <> 'paid' AND deleted_at IS NULL;

CREATE TRIGGER travaux_set_updated_at BEFORE UPDATE ON travaux_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
