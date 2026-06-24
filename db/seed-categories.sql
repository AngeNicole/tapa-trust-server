-- TaPa Trust — non-destructive skill-category seed.
-- Pure idempotent INSERTs only. No DDL (no DROP/CREATE/ALTER/TRUNCATE):
-- safe to run against production without touching any other data.
-- Re-running is a no-op thanks to ON CONFLICT on the UNIQUE name column.

INSERT INTO skill_categories (name, description) VALUES
  ('Plumbing',                 'Leaks, taps, drains, and general plumbing fixes.')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO skill_categories (name, description) VALUES
  ('Cleaning',                 'Home and space cleaning jobs.')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO skill_categories (name, description) VALUES
  ('Moving / Lifting',         'Carrying, loading, and moving heavy items.')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO skill_categories (name, description) VALUES
  ('Electrical',               'Wiring, fixtures, and basic electrical work.')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO skill_categories (name, description) VALUES
  ('Furniture assembly',       'Assembling flat-pack and other furniture.')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO skill_categories (name, description) VALUES
  ('Mounting / Installation',  'Mounting TVs, shelves, and fittings.')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO skill_categories (name, description) VALUES
  ('Basic tech setup',         'Setting up devices, networks, and software.')
  ON CONFLICT (name) DO NOTHING;
