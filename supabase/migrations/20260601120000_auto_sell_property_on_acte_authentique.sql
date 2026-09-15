-- ============================================================================
-- Auto : un bien passe en 'vendu' dès que l'acte authentique est signé.
--
-- Contexte : la vente se matérialise à la signature de l'acte authentique
-- (qui a lieu PENDANT que le projet est encore actif), pas à la fin du projet.
-- Rien ne faisait avancer properties.status de 'offre' (retenu) à 'vendu' à ce
-- moment-là → les KPI de sourcing (conversion, ventes par partenaire, prix/m²)
-- étaient décalés.
--
-- Règle : quand projects.acte_authentique_date est renseignée et qu'un bien est
-- rattaché, le bien passe en 'vendu'. On NE rebascule PAS si la date est effacée
-- (annulation d'acte = cas exceptionnel, traité manuellement).
--
-- Idempotent : CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ============================================================================

create or replace function set_property_sold_on_acte() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.acte_authentique_date is not null
     and new.property_id is not null
     and (
       tg_op = 'INSERT'
       or old.acte_authentique_date is distinct from new.acte_authentique_date
       or old.property_id is distinct from new.property_id
     )
  then
    update properties
       set status = 'vendu', updated_at = now()
     where id = new.property_id
       and deleted_at is null
       and status <> 'vendu';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_property_sold_on_acte on projects;
create trigger trg_property_sold_on_acte
  after insert or update of acte_authentique_date, property_id on projects
  for each row execute function set_property_sold_on_acte();
