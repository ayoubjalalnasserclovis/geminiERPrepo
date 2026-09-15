-- ============================================================================
-- Caisse Stoniz — extension édition collaborative (ceo, achats, finance,
-- chef_projet) avec règle "chacun n'édite que ses propres dépenses" + CEO admin
-- ============================================================================
-- Cible : public.stoniz_wallet_expenses (les "entrées" cash que la team saisit).
-- Wallets et dotations restent inchangés (gérés par CEO/chef_projet/finance via
-- server actions, pas modifiables ici).
--
-- Avant cette migration :
--   - SELECT  : ceo, chef_projet, finance, assistante  (via is_staff)
--   - INSERT  : idem
--   - UPDATE  : idem (toute ligne, pas de restriction d'auteur)
--   - DELETE  : ceo seulement
--   - colonnes : pas de created_by / updated_by / deleted_at / deleted_by
--
-- Après :
--   - colonnes : ajout created_by, updated_by, deleted_at, deleted_by
--   - SELECT  : ceo, chef_projet, finance, achats, developer (lecture étendue)
--               (assistante retirée — n'apparaît pas dans la cible métier
--                ceo/achats/finance/chef_projet ; developer = lecture seule)
--   - INSERT  : ceo, chef_projet, finance, achats  (created_by forcé = auth.uid)
--   - UPDATE  : CEO toute ligne · ceo/chef_projet/finance/achats uniquement les
--               lignes qu'ils ont créées
--   - DELETE  : reste CEO uniquement (la suppression métier passe par
--               UPDATE deleted_at = now() — soft-delete)
-- ============================================================================

-- ─── 1. Colonnes manquantes (idempotent) ──────────────────────────────────
ALTER TABLE public.stoniz_wallet_expenses
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.stoniz_wallet_expenses
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.stoniz_wallet_expenses
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE public.stoniz_wallet_expenses
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stoniz_wallet_expenses_created_by_idx
  ON public.stoniz_wallet_expenses (created_by)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS stoniz_wallet_expenses_deleted_at_idx
  ON public.stoniz_wallet_expenses (deleted_at);

COMMENT ON COLUMN public.stoniz_wallet_expenses.created_by IS
  'Auteur de la dépense. Forcé à auth.uid() par RLS à l''insert. Permet la règle "chacun édite/supprime ses propres entrées" pour les rôles non-CEO.';
COMMENT ON COLUMN public.stoniz_wallet_expenses.updated_by IS
  'Dernier auteur d''une modification (set côté server action).';
COMMENT ON COLUMN public.stoniz_wallet_expenses.deleted_at IS
  'Soft-delete. NULL = active. Set par server action, jamais via DELETE physique.';
COMMENT ON COLUMN public.stoniz_wallet_expenses.deleted_by IS
  'Auteur du soft-delete.';

-- ─── 2. Trigger updated_at déjà présent (stoniz_wallet_expenses_updated_at)
-- On le recrée par sécurité pour garantir l'idempotence.
DROP TRIGGER IF EXISTS stoniz_wallet_expenses_updated_at ON public.stoniz_wallet_expenses;
CREATE TRIGGER stoniz_wallet_expenses_updated_at
  BEFORE UPDATE ON public.stoniz_wallet_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. RLS étendues ──────────────────────────────────────────────────────
-- On drop d'abord les 4 anciennes policies (read/write/update/delete) puis on
-- recrée la nouvelle matrice. RLS est déjà ENABLE sur la table.

DROP POLICY IF EXISTS stoniz_wallet_expenses_staff_read   ON public.stoniz_wallet_expenses;
DROP POLICY IF EXISTS stoniz_wallet_expenses_staff_write  ON public.stoniz_wallet_expenses;
DROP POLICY IF EXISTS stoniz_wallet_expenses_staff_update ON public.stoniz_wallet_expenses;
DROP POLICY IF EXISTS stoniz_wallet_expenses_staff_delete ON public.stoniz_wallet_expenses;

-- SELECT : ceo + finance + chef_projet + achats + developer (lecture seule pour dev)
CREATE POLICY stoniz_wallet_expenses_staff_read
  ON public.stoniz_wallet_expenses
  FOR SELECT
  USING (
    is_staff(ARRAY['ceo','chef_projet','finance','achats','developer'])
  );

-- INSERT : ceo + finance + chef_projet + achats  (developer EXCLU — read only)
-- created_by est forcé = auth.uid() par le WITH CHECK.
CREATE POLICY stoniz_wallet_expenses_staff_write
  ON public.stoniz_wallet_expenses
  FOR INSERT
  WITH CHECK (
    is_staff(ARRAY['ceo','chef_projet','finance','achats'])
    AND created_by = auth.uid()
  );

-- UPDATE : CEO peut tout · les autres rôles autorisés uniquement leurs lignes
CREATE POLICY stoniz_wallet_expenses_staff_update
  ON public.stoniz_wallet_expenses
  FOR UPDATE
  USING (
    is_staff(ARRAY['ceo'])
    OR (
      is_staff(ARRAY['chef_projet','finance','achats'])
      AND created_by = auth.uid()
    )
  )
  WITH CHECK (
    is_staff(ARRAY['ceo'])
    OR (
      is_staff(ARRAY['chef_projet','finance','achats'])
      AND created_by = auth.uid()
    )
  );

-- DELETE : CEO uniquement (les autres passent par soft-delete via UPDATE).
CREATE POLICY stoniz_wallet_expenses_staff_delete
  ON public.stoniz_wallet_expenses
  FOR DELETE
  USING (
    is_staff(ARRAY['ceo'])
  );

-- ─── 4. Backfill created_by ───────────────────────────────────────────────
-- Aucune information historique sur l'auteur (15 lignes pré-existantes).
-- created_by reste NULL → en pratique seul le CEO pourra les éditer (les autres
-- policies exigent created_by = auth.uid(), donc NULL ne match jamais). C'est
-- voulu et acceptable.

-- ─── 5. Audit trigger : déjà en place (audit_stoniz_wallet_expenses).
-- Pas de modification.

COMMENT ON TABLE public.stoniz_wallet_expenses IS
  'Dépenses cash STONIZ. expense_type=achat/travaux/autre pour le P&L projet. Auteur tracé via created_by ; édition/suppression "ses propres" pour ceo/chef_projet/finance/achats ; CEO admin total ; developer lecture seule.';
