-- ============================================================================
-- 00 — Extensions & helpers globaux
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Types ENUM ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE project_phase AS ENUM (
    'onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE property_status AS ENUM (
    'sourcing','disponible','propose','offre','vendu','perdu','a_verifier'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Helper : set_updated_at ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── Helper : audit_log + trigger ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id UUID,
  action TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  actor_id UUID,
  before JSONB,
  after JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_table_row_idx ON audit_log (table_name, row_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);

CREATE OR REPLACE FUNCTION audit_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor uuid;
  v_row_id uuid;
BEGIN
  BEGIN
    v_actor := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor := NULL;
  END;

  IF TG_OP = 'DELETE' THEN
    v_row_id := (to_jsonb(OLD) ->> 'id')::uuid;
  ELSE
    v_row_id := (to_jsonb(NEW) ->> 'id')::uuid;
  END IF;

  INSERT INTO audit_log (table_name, row_id, action, actor_id, before, after)
  VALUES (
    TG_TABLE_NAME,
    v_row_id,
    TG_OP,
    v_actor,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;
