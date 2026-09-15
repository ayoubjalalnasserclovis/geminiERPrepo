DELETE FROM travaux_encaissements WHERE notes ILIKE '[DEMO]%';
DELETE FROM travaux_payments      WHERE notes ILIKE '[DEMO]%';
DELETE FROM travaux_lots          WHERE description ILIKE '[DEMO]%';
DELETE FROM payments              WHERE notes ILIKE '[DEMO]%';
DELETE FROM project_phases_history WHERE project_id IN (
  SELECT id FROM projects WHERE client_id IN (
    SELECT id FROM clients WHERE email LIKE '%@demo.stoniz.co'));
DELETE FROM projects WHERE client_id IN (
  SELECT id FROM clients WHERE email LIKE '%@demo.stoniz.co');
DELETE FROM properties WHERE drive_url = 'demo-seed';
DELETE FROM clients WHERE email LIKE '%@demo.stoniz.co';