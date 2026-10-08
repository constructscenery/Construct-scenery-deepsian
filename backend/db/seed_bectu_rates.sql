-- ============================================================
-- CS HQ — BECTU 2026/27 Rate Card
-- Fill in daily_rate and overtime_rate from your rate card
-- then paste the whole thing into Render SQL Console
--
-- HOW TO ACCESS RENDER SQL CONSOLE:
--   1. Go to https://dashboard.render.com
--   2. Click on your PostgreSQL database (cshq_db_dev)
--   3. Click the "Connect" button (top right)
--   4. Click "PSQL Command" — OR — scroll down to find "SQL Console" tab
--   5. Copy-paste this entire file and click Run
-- ============================================================

-- ─── QUICK CHECK — see current rates before updating ─────────────────────────
-- Run this first to confirm all rows exist and are currently 0:
-- SELECT trade, rank, daily_rate, overtime_rate FROM bectu_rates ORDER BY trade, rank;


-- ─── SINGLE BULK UPDATE (most efficient — one query) ─────────────────────────
-- Replace each 0.00 pair with: daily_rate, overtime_rate from your 2026/27 card
-- Format: daily rate is the standard BECTU daily rate (£)
--         overtime rate is the per-hour overtime rate (£/hr)

-- ⚠️  DEMO RATES — Replace with actual 2026/27 Pact/BECTU rate card figures
--     when available. OT rate = daily ÷ 10 × 1.5 (time-and-a-half per hour).

UPDATE bectu_rates AS b
SET
  daily_rate    = v.daily_rate,
  overtime_rate = v.overtime_rate
FROM (VALUES
  -- ── Carpenters ──────────────────────────────────────────────────
  ('Carpenters',        'HOD',                 557.00,  70.00),
  ('Carpenters',        'Supervisor',          473.00,  70.00),
  ('Carpenters',        'Chargehand',          391.00,  68.00),
  ('Carpenters',        'Carpenter',           331.00,  59.07),

  -- ── Machinists ──────────────────────────────────────────────────
  ('Machinists',        'HOD',                 557.00,  70.00),
  ('Machinists',        'Supervisor',          473.00,  70.00),
  ('Machinists',        'Chargehand',          391.00,  68.00),
  ('Machinists',        'Machinist',           331.00,  59.07),

  -- ── Stagehands ──────────────────────────────────────────────────
  ('Stagehands',        'HOD',                 473.00,  70.00),
  ('Stagehands',        'Supervisor',          391.00,  68.00),
  ('Stagehands',        'Chargehand',          331.00,  68.00),
  ('Stagehands',        'Stagehand NVQ/BLSS',  312.00,  55.68),
  ('Stagehands',        'Stagehand',           305.00,  54.43),

  -- ── Riggers ─────────────────────────────────────────────────────
  ('Riggers',           'HOD',                 557.00,  70.00),
  ('Riggers',           'Supervisor',          473.00,  70.00),
  ('Riggers',           'Chargehand',          391.00,  68.00),
  ('Riggers',           'Rigger',              331.00,  59.07),

  -- ── Plasterers ──────────────────────────────────────────────────
  ('Plasterers',        'HOD',                 557.00,  70.00),
  ('Plasterers',        'Supervisor',          473.00,  70.00),
  ('Plasterers',        'Chargehand',          391.00,  68.00),
  ('Plasterers',        'Plasterer',           331.00,  59.07),

  -- ── Scenic Painters ─────────────────────────────────────────────
  ('Scenic Painters',   'HOD',                 557.00,  70.00),
  ('Scenic Painters',   'Supervisor',          473.00,  70.00),
  ('Scenic Painters',   'Chargehand',          391.00,  68.00),
  ('Scenic Painters',   'Painter',             331.00,  59.07),

  -- ── Sculptors ───────────────────────────────────────────────────
  ('Sculptors',         'HOD',                 557.00,  70.00),
  ('Sculptors',         'Supervisor',          473.00,  70.00),
  ('Sculptors',         'Chargehand',          391.00,  68.00),
  ('Sculptors',         'Sculptor',            391.00,  68.00),
  ('Sculptors',         'Sculptor Modeller',   331.00,  59.07),

  -- ── Metal Workers ───────────────────────────────────────────────
  ('Metal Workers',     'HOD',                 557.00,  70.00),
  ('Metal Workers',     'Supervisor',          473.00,  70.00),
  ('Metal Workers',     'Chargehand',          391.00,  68.00),
  ('Metal Workers',     'Metal Worker',        331.00,  59.07),

  -- ── Plasterers Lab ──────────────────────────────────────────────
  ('Plasterers Lab',    'HOD',                 473.00,  70.00),
  ('Plasterers Lab',    'Supervisor',          391.00,  68.00),
  ('Plasterers Lab',    'Chargehand',          331.00,  68.00),
  ('Plasterers Lab',    'Lab Worker',          305.00,  54.43),

  -- ── Painters Lab ────────────────────────────────────────────────
  ('Painters Lab',      'HOD',                 473.00,  70.00),
  ('Painters Lab',      'Supervisor',          391.00,  68.00),
  ('Painters Lab',      'Chargehand',          331.00,  68.00),
  ('Painters Lab',      'Lab Worker',          305.00,  54.43),

  -- ── Sculptors Lab ───────────────────────────────────────────────
  ('Sculptors Lab',     'HOD',                 473.00,  70.00),
  ('Sculptors Lab',     'Supervisor',          391.00,  68.00),
  ('Sculptors Lab',     'Chargehand',          331.00,  68.00),
  ('Sculptors Lab',     'Lab Worker',          305.00,  54.43),

  -- ── Metal Workers Lab ───────────────────────────────────────────
  ('Metal Workers Lab', 'HOD',                 473.00,  70.00),
  ('Metal Workers Lab', 'Supervisor',          391.00,  68.00),
  ('Metal Workers Lab', 'Chargehand',          331.00,  68.00),
  ('Metal Workers Lab', 'Lab Worker',          305.00,  54.43),

  -- ── Non-BECTU (directly agreed with Warren) ─────────────────────
  ('Non-BECTU',         'Construction Accountant',  480.00,  72.00),
  ('Non-BECTU',         'Construction Coordinator', 420.00,  63.00),
  ('Non-BECTU',         'Construction Manager',     550.00,  82.50),
  ('Non-BECTU',         'Luton Driver',             255.00,  38.25)

) AS v(trade, rank, daily_rate, overtime_rate)
WHERE b.trade     = v.trade
  AND b.rank      = v.rank
  AND b.rate_year = '2026/27';

-- ── Insert Apprentice and Improver rates across BECTU trades ──────────────
INSERT INTO bectu_rates (trade, rank, daily_rate, overtime_rate, weekly_rate, rate_year, rate_type)
SELECT t.trade, r.rank, r.daily_rate, r.overtime_rate, r.weekly_rate, '2026/27', 'bectu'
FROM (
  VALUES
    ('Carpenters'), ('Machinists'), ('Stagehands'), ('Riggers'),
    ('Plasterers'), ('Scenic Painters'), ('Sculptors'), ('Metal Workers'),
    ('Plasterers Lab'), ('Painters Lab'), ('Sculptors Lab'), ('Metal Workers Lab')
) AS t(trade)
CROSS JOIN (
  VALUES
    ('Improver Year 4',   238.00, 35.70, 1190.00),
    ('Improver',          238.00, 35.70, 1190.00),
    ('Apprentice Year 3', 170.00, 25.50,  850.00),
    ('Apprentice Year 2', 130.00, 19.50,  650.00),
    ('Apprentice Year 1', 107.00, 16.05,  535.00)
) AS r(rank, daily_rate, overtime_rate, weekly_rate)
ON CONFLICT (trade, rank, rate_year) DO UPDATE
  SET daily_rate    = EXCLUDED.daily_rate,
      overtime_rate = EXCLUDED.overtime_rate,
      weekly_rate   = EXCLUDED.weekly_rate,
      rate_type     = 'bectu';


-- ─── VERIFY AFTER RUNNING ────────────────────────────────────────────────────
-- Run this to confirm all rates updated correctly:
SELECT trade, rank, daily_rate, overtime_rate
FROM   bectu_rates
WHERE  rate_year = '2026/27'
ORDER  BY trade, rank;
