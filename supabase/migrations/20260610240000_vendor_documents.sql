-- Cf migration prod : table vendor_documents + FK sur achats_lots, travaux_lots, travaux_payments
-- CEO 2026-06-10.

CREATE TABLE IF NOT EXISTS public.vendor_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type        text NOT NULL CHECK (doc_type IN ('facture','devis')),
  vendor_kind     text NOT NULL CHECK (vendor_kind IN ('partner','artisan')),
  partner_id      uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  artisan_id      uuid REFERENCES public.artisans(id) ON DELETE SET NULL,
  vendor_label    text,
  reference       text,
  document_date   date,
  total_amount    numeric,
  currency        text DEFAULT 'MAD',
  file_path       text,
  notes           text,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT vendor_documents_vendor_present
    CHECK (partner_id IS NOT NULL OR artisan_id IS NOT NULL OR vendor_label IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vendor_documents_partner   ON public.vendor_documents(partner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_documents_artisan   ON public.vendor_documents(artisan_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_documents_recent    ON public.vendor_documents(created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.vendor_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read vendor_documents"   ON public.vendor_documents;
DROP POLICY IF EXISTS "staff insert vendor_documents" ON public.vendor_documents;
DROP POLICY IF EXISTS "staff update vendor_documents" ON public.vendor_documents;
DROP POLICY IF EXISTS "staff delete vendor_documents" ON public.vendor_documents;
CREATE POLICY "staff read vendor_documents"   ON public.vendor_documents FOR SELECT USING (public.is_staff());
CREATE POLICY "staff insert vendor_documents" ON public.vendor_documents FOR INSERT WITH CHECK (public.is_staff());
CREATE POLICY "staff update vendor_documents" ON public.vendor_documents FOR UPDATE USING (public.is_staff());
CREATE POLICY "staff delete vendor_documents" ON public.vendor_documents FOR DELETE USING (public.is_staff());

ALTER TABLE public.achats_lots
  ADD COLUMN IF NOT EXISTS invoice_doc_id uuid REFERENCES public.vendor_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_doc_id   uuid REFERENCES public.vendor_documents(id) ON DELETE SET NULL;
ALTER TABLE public.travaux_lots
  ADD COLUMN IF NOT EXISTS quote_doc_id   uuid REFERENCES public.vendor_documents(id) ON DELETE SET NULL;
ALTER TABLE public.travaux_payments
  ADD COLUMN IF NOT EXISTS invoice_doc_id uuid REFERENCES public.vendor_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_achats_lots_invoice_doc      ON public.achats_lots(invoice_doc_id) WHERE invoice_doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_achats_lots_quote_doc        ON public.achats_lots(quote_doc_id) WHERE quote_doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_travaux_lots_quote_doc       ON public.travaux_lots(quote_doc_id) WHERE quote_doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_travaux_payments_invoice_doc ON public.travaux_payments(invoice_doc_id) WHERE invoice_doc_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
