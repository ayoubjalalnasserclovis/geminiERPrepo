-- ============================================================================
-- 12 — Audit triggers sur les tables sensibles
-- ============================================================================

CREATE TRIGGER audit_projects
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_properties
  AFTER INSERT OR UPDATE OR DELETE ON properties
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_travaux_payments
  AFTER INSERT OR UPDATE OR DELETE ON travaux_payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_documents
  AFTER INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_property_proposals
  AFTER INSERT OR UPDATE OR DELETE ON property_proposals
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
