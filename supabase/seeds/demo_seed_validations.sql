-- Nettoyage : retire les demandes demo existantes
DELETE FROM payment_approvals WHERE request_notes ILIKE '[DEMO]%';

DO $$
DECLARE
  v_ceo_id        UUID;
  v_finance_id    UUID;
  v_chef_id       UUID;
  v_project       RECORD;
  v_tpay          RECORD;
  v_apay          RECORD;
  i               INTEGER := 0;
  v_scenario      INTEGER;
  v_approval_id   UUID;
BEGIN
  -- ─── Profils acteurs ──────────────────────────────────────────────────
  SELECT id INTO v_ceo_id FROM profiles WHERE role = 'ceo' AND is_active = true ORDER BY created_at LIMIT 1;
  SELECT id INTO v_finance_id FROM profiles WHERE role = 'finance' AND is_active = true ORDER BY created_at LIMIT 1;
  SELECT id INTO v_chef_id FROM profiles WHERE role = 'chef_projet' AND is_active = true ORDER BY created_at LIMIT 1;
  IF v_chef_id IS NULL THEN v_chef_id := v_ceo_id; END IF;
  IF v_finance_id IS NULL THEN v_finance_id := v_ceo_id; END IF;

  IF v_ceo_id IS NULL THEN
    RAISE NOTICE 'Aucun profil CEO trouve - skipping validations seed';
    RETURN;
  END IF;

  -- ─── Pour chaque projet demo, generer 2-3 demandes dans des etats varies ──
  FOR v_project IN
    SELECT p.id, p.reference FROM projects p
    JOIN clients c ON c.id = p.client_id
    WHERE c.email LIKE '%@demo.stoniz.co'
      AND p.deleted_at IS NULL
    ORDER BY p.created_at
  LOOP
    i := i + 1;
    v_scenario := ((i - 1) % 6) + 1;
    -- scenarios :
    --   1 = pending Finance + urgent
    --   2 = pending Finance + normal
    --   3 = Finance approved, pending CEO
    --   4 = CEO approved (skip Finance), prêt à payer
    --   5 = Fully paid (preuve)
    --   6 = Rejected by Finance

    -- ─── Demande sur un acompte travaux ───────────────────────────────
    SELECT * INTO v_tpay
      FROM travaux_payments
      WHERE project_id = v_project.id
        AND status != 'paid'
        AND deleted_at IS NULL
        AND lot_id IS NOT NULL
      ORDER BY created_at
      LIMIT 1;

    IF v_tpay.id IS NOT NULL THEN
      v_approval_id := gen_random_uuid();
      INSERT INTO payment_approvals (
        id, travaux_payment_id, project_id,
        amount, currency, beneficiary_name, description,
        urgency, requested_by, requested_at, request_notes,
        finance_status, finance_reviewer, finance_reviewed_at, finance_notes,
        ceo_status, ceo_reviewer, ceo_reviewed_at, ceo_notes,
        paid_at, paid_by, payment_method, payment_reference
      ) VALUES (
        v_approval_id, v_tpay.id, v_project.id,
        v_tpay.amount_total, v_tpay.currency, v_tpay.artisan_name,
        '[DEMO] ' || COALESCE(v_tpay.description, 'Acompte artisan'),
        CASE WHEN v_scenario = 1 THEN 'urgent' ELSE 'normal' END,
        v_chef_id,
        (now() - (v_scenario || ' days')::interval)::timestamptz,
        '[DEMO] Demande generee pour la demo',
        -- Finance
        CASE
          WHEN v_scenario IN (3) THEN 'approved'
          WHEN v_scenario = 4 THEN 'skipped'
          WHEN v_scenario = 5 THEN 'approved'
          WHEN v_scenario = 6 THEN 'rejected'
          ELSE 'pending'
        END,
        CASE WHEN v_scenario IN (3, 5, 6) THEN v_finance_id ELSE NULL END,
        CASE WHEN v_scenario IN (3, 5, 6) THEN (now() - ((v_scenario - 1) || ' days')::interval)::timestamptz END,
        CASE
          WHEN v_scenario = 6 THEN '[DEMO] Montant trop eleve, demander un devis revise'
          WHEN v_scenario = 3 THEN '[DEMO] OK avec moi, validation CEO requise'
          ELSE NULL
        END,
        -- CEO
        CASE
          WHEN v_scenario IN (4, 5) THEN 'approved'
          ELSE 'pending'
        END,
        CASE WHEN v_scenario IN (4, 5) THEN v_ceo_id ELSE NULL END,
        CASE WHEN v_scenario IN (4, 5) THEN (now() - '1 day'::interval)::timestamptz END,
        CASE WHEN v_scenario = 4 THEN '[DEMO] Validation directe CEO sans passer par Finance' END,
        -- Paiement effectue (scenario 5 uniquement)
        CASE WHEN v_scenario = 5 THEN (now() - '6 hours'::interval)::timestamptz END,
        CASE WHEN v_scenario = 5 THEN v_finance_id END,
        CASE WHEN v_scenario = 5 THEN 'Virement Wise' END,
        CASE WHEN v_scenario = 5 THEN 'WISE-2026-' || LPAD(i::text, 4, '0') END
      );

      -- Si paye, refleter sur le travaux_payment source
      IF v_scenario = 5 THEN
        UPDATE travaux_payments
          SET amount_paid = amount_total,
              paid_at = (now() - '6 hours'::interval)::date,
              status = 'paid'
          WHERE id = v_tpay.id;
      END IF;
    END IF;

    -- ─── Demande sur un acompte achat (alterne) ───────────────────────
    IF i % 2 = 0 THEN
      SELECT * INTO v_apay
        FROM achats_payments
        WHERE project_id = v_project.id
          AND status != 'paid'
          AND deleted_at IS NULL
          AND lot_id IS NOT NULL
        ORDER BY created_at
        LIMIT 1;

      IF v_apay.id IS NOT NULL THEN
        -- Pour les achats, on alterne entre pending Finance et CEO approved
        v_approval_id := gen_random_uuid();
        DECLARE
          v_a_scenario INTEGER := CASE WHEN i % 4 = 0 THEN 4 ELSE 2 END;
        BEGIN
          INSERT INTO payment_approvals (
            id, achats_payment_id, project_id,
            amount, currency, beneficiary_name, description,
            urgency, requested_by, requested_at, request_notes,
            finance_status, finance_reviewer, finance_reviewed_at, finance_notes,
            ceo_status, ceo_reviewer, ceo_reviewed_at, ceo_notes,
            paid_at, paid_by, payment_method, payment_reference
          ) VALUES (
            v_approval_id, v_apay.id, v_project.id,
            v_apay.amount_total, v_apay.currency, v_apay.supplier_name,
            '[DEMO] ' || COALESCE(v_apay.description, 'Acompte fournisseur'),
            'normal',
            v_chef_id,
            (now() - '2 days'::interval)::timestamptz,
            '[DEMO] Mobilier / equipement',
            CASE WHEN v_a_scenario = 4 THEN 'skipped' ELSE 'pending' END,
            NULL, NULL, NULL,
            CASE WHEN v_a_scenario = 4 THEN 'approved' ELSE 'pending' END,
            CASE WHEN v_a_scenario = 4 THEN v_ceo_id ELSE NULL END,
            CASE WHEN v_a_scenario = 4 THEN (now() - '1 day'::interval)::timestamptz ELSE NULL END,
            CASE WHEN v_a_scenario = 4 THEN '[DEMO] Achat prioritaire' ELSE NULL END,
            NULL, NULL, NULL, NULL
          );
        END;
      END IF;
    END IF;

  END LOOP;

  RAISE NOTICE 'Demo seed validations termine : % demandes creees', i;
END $$;
