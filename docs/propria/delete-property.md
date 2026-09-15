# Suppression d'un bien Propria

## Pour qui
Action réservée au **CEO** (role='ceo'). Le bouton n'apparaît pour personne d'autre.

## Comment ça marche
- **Soft delete** : pose `deleted_at = NOW()` sur la property et tous ses propria_units.
- **Audit** : INSERT dans `property_deletion_log` avec snapshot complet (property + units) + raison + acteur.
- **Réversible** : aucune perte de données. Voir restauration ci-dessous.

## UI
Sur la fiche bien `/propria/biens/[id]`, bouton rouge "Supprimer ce bien" en haut.
Modal de confirmation exigeant :
- Saisie exacte du nom du bien
- Raison (min 5 chars)

## Sécurité
- Vérification rôle côté **server action** (`assertRole(['ceo'])`)
- Vérification rôle côté **RPC SECURITY DEFINER** (auth.uid() + role='ceo' OR is_super_admin)
- Un chef_projet qui appelle l'API directement (curl) reçoit `EXCEPTION 'Action réservée au CEO'`

## Restauration manuelle (si erreur de suppression)
```sql
-- Annuler le soft-delete d'un bien
UPDATE properties SET deleted_at = NULL WHERE id = '<property_id>';
UPDATE propria_units SET deleted_at = NULL WHERE property_id = '<property_id>';

-- Logger la restauration
UPDATE property_deletion_log
SET restored_at = NOW(), restored_by = '<ton_profile_id>'
WHERE property_id = '<property_id>' AND restored_at IS NULL;
```

## Hard delete impossible
Aucune UI ni RPC ne fait de hard DELETE. Si besoin (RGPD), prévoir une RPC `purge_property` dédiée plus tard avec encore plus de friction.
