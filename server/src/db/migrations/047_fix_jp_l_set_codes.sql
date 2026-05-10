-- Correct several wrong JP set codes that had been seeded with bogus names.
--
-- HGSS series in JP:
--   L1 = Heart Gold and Soul Silver
--   L2 = Reviving Legends
--   L3 = Clash at the Summit
--   L4 — does not exist (delete)
--   LL = Lost Link (insert if missing)
--
-- DP series in JP:
--   DP4 was 'time-space creation' → actually Moonlit Pursuit / Dawn Dash
--   DP6 was 'clash at summit' → actually Intense Fight in the Destroyed Sky
--   DP7 was 'offense and defense' → does not exist as a standalone JP set
--     after DP-6 the series transitioned to DPt1 (Galactic's Conquest); delete

UPDATE set_codes
   SET set_name = 'Heart Gold and Soul Silver',
       aliases = ARRAY['heart gold soul silver','hgss jp','hgss1'],
       updated_at = NOW()
 WHERE language = 'JP' AND set_code = 'L1';

UPDATE set_codes
   SET set_name = 'Reviving Legends',
       aliases = ARRAY['reviving legend','hgss2'],
       updated_at = NOW()
 WHERE language = 'JP' AND set_code = 'L2';

UPDATE set_codes
   SET set_name = 'Clash at the Summit',
       aliases = ARRAY['clash at the summit jp','hgss3'],
       updated_at = NOW()
 WHERE language = 'JP' AND set_code = 'L3';

DELETE FROM set_codes
 WHERE language = 'JP' AND set_code = 'L4';

INSERT INTO set_codes (user_id, game, language, set_code, set_name, era, aliases, is_seeded)
SELECT DISTINCT user_id, 'pokemon', 'JP', 'LL', 'Lost Link', 'HGSS',
                ARRAY['lost link jp','hgss-ll']::text[], true
  FROM set_codes
 WHERE language = 'JP'
   AND user_id NOT IN (
     SELECT user_id FROM set_codes WHERE language = 'JP' AND set_code = 'LL'
   );

UPDATE set_codes
   SET set_name = 'Moonlit Pursuit / Dawn Dash',
       aliases = ARRAY['moonlit pursuit','dawn dash','moonlit pursuit dawn dash'],
       updated_at = NOW()
 WHERE language = 'JP' AND set_code = 'DP4';

UPDATE set_codes
   SET set_name = 'Intense Fight in the Destroyed Sky',
       aliases = ARRAY['destroyed sky'],
       updated_at = NOW()
 WHERE language = 'JP' AND set_code = 'DP6';

DELETE FROM set_codes
 WHERE language = 'JP' AND set_code = 'DP7';
