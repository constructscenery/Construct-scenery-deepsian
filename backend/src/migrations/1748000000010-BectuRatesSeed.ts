import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026/27 Pact/BECTU Construction Crew Agreement rate card
// effective_from: 2026-04-07 (start of 2026/27 BECTU season)
// OT rate = daily_rate / 10 * 1.5 (time-and-a-half per hour on 10-hr day)
const BECTU_RATES: Array<[string, string, number, number]> = [
  // [trade, rank, daily_rate, overtime_rate]
  ['Carpenters',        'HOD',                  425.00, 63.75],
  ['Carpenters',        'Supervisor',            375.00, 56.25],
  ['Carpenters',        'Chargehand',            350.00, 52.50],
  ['Carpenters',        'Carpenter',             320.00, 48.00],

  ['Machinists',        'HOD',                  425.00, 63.75],
  ['Machinists',        'Supervisor',            375.00, 56.25],
  ['Machinists',        'Chargehand',            350.00, 52.50],
  ['Machinists',        'Machinist',             320.00, 48.00],

  ['Stagehands',        'HOD',                  390.00, 58.50],
  ['Stagehands',        'Supervisor',            345.00, 51.75],
  ['Stagehands',        'Chargehand',            320.00, 48.00],
  ['Stagehands',        'Stagehand NVQ/BLSS',    298.00, 44.70],
  ['Stagehands',        'Stagehand',             280.00, 42.00],

  ['Riggers',           'HOD',                  430.00, 64.50],
  ['Riggers',           'Supervisor',            380.00, 57.00],
  ['Riggers',           'Chargehand',            355.00, 53.25],
  ['Riggers',           'Rigger',               328.00, 49.20],

  ['Plasterers',        'HOD',                  390.00, 58.50],
  ['Plasterers',        'Supervisor',            345.00, 51.75],
  ['Plasterers',        'Chargehand',            320.00, 48.00],
  ['Plasterers',        'Plasterer',             295.00, 44.25],

  ['Scenic Painters',   'HOD',                  420.00, 63.00],
  ['Scenic Painters',   'Supervisor',            370.00, 55.50],
  ['Scenic Painters',   'Chargehand',            345.00, 51.75],
  ['Scenic Painters',   'Painter',              312.00, 46.80],

  ['Sculptors',         'HOD',                  425.00, 63.75],
  ['Sculptors',         'Supervisor',            375.00, 56.25],
  ['Sculptors',         'Chargehand',            348.00, 52.20],
  ['Sculptors',         'Sculptor',             322.00, 48.30],
  ['Sculptors',         'Sculptor Modeller',    305.00, 45.75],

  ['Metal Workers',     'HOD',                  428.00, 64.20],
  ['Metal Workers',     'Supervisor',            378.00, 56.70],
  ['Metal Workers',     'Chargehand',            352.00, 52.80],
  ['Metal Workers',     'Metal Worker',         326.00, 48.90],

  ['Plasterers Lab',    'HOD',                  385.00, 57.75],
  ['Plasterers Lab',    'Supervisor',            338.00, 50.70],
  ['Plasterers Lab',    'Chargehand',            315.00, 47.25],
  ['Plasterers Lab',    'Lab Worker',           285.00, 42.75],

  ['Painters Lab',      'HOD',                  385.00, 57.75],
  ['Painters Lab',      'Supervisor',            338.00, 50.70],
  ['Painters Lab',      'Chargehand',            315.00, 47.25],
  ['Painters Lab',      'Lab Worker',           285.00, 42.75],

  ['Sculptors Lab',     'HOD',                  385.00, 57.75],
  ['Sculptors Lab',     'Supervisor',            338.00, 50.70],
  ['Sculptors Lab',     'Chargehand',            315.00, 47.25],
  ['Sculptors Lab',     'Lab Worker',           285.00, 42.75],

  ['Metal Workers Lab', 'HOD',                  388.00, 58.20],
  ['Metal Workers Lab', 'Supervisor',            340.00, 51.00],
  ['Metal Workers Lab', 'Chargehand',            316.00, 47.40],
  ['Metal Workers Lab', 'Lab Worker',           288.00, 43.20],
];

const APPRENTICE_IMPROVER_RANKS: Array<[string, number, number]> = [
  ['Improver Year 4',   238.00, 35.70],
  ['Improver',          238.00, 35.70],
  ['Apprentice Year 3', 170.00, 25.50],
  ['Apprentice Year 2', 130.00, 19.50],
  ['Apprentice Year 1', 107.00, 16.05],
];

const ALL_TRADES = [
  'Carpenters', 'Machinists', 'Stagehands', 'Riggers', 'Plasterers',
  'Scenic Painters', 'Sculptors', 'Metal Workers', 'Plasterers Lab',
  'Painters Lab', 'Sculptors Lab', 'Metal Workers Lab',
];

for (const trade of ALL_TRADES) {
  for (const [rank, daily, ot] of APPRENTICE_IMPROVER_RANKS) {
    BECTU_RATES.push([trade, rank, daily, ot]);
  }
}

// Non-BECTU roles — daily_rate NULL, configured by MD via admin panel
const NON_BECTU_ROLES: Array<[string]> = [
  ['Construction Accountant'],
  ['Construction Coordinator'],
  ['Construction Manager'],
  ['Luton Driver'],
];

export class BectuRatesSeed1748000000010 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const EFFECTIVE_FROM = '2026-04-07';

    // Upsert BECTU rates
    for (const [trade, rank, daily, ot] of BECTU_RATES) {
      await queryRunner.query(
        `INSERT INTO bectu_rates (trade, rank, daily_rate, overtime_rate, weekly_rate, rate_year, rate_type, effective_from)
         VALUES ($1, $2, $3, $4, $3 * 5, '2026/27', 'bectu', $5)
         ON CONFLICT (trade, rank, rate_year) DO UPDATE
           SET daily_rate    = EXCLUDED.daily_rate,
               overtime_rate = EXCLUDED.overtime_rate,
               weekly_rate   = EXCLUDED.weekly_rate,
               rate_type     = 'bectu',
               effective_from = COALESCE(bectu_rates.effective_from, $5)`,
        [trade, rank, daily, ot, EFFECTIVE_FROM]
      );
    }

    // Insert Non-BECTU roles with NULL daily_rate (configurable by MD)
    for (const [role] of NON_BECTU_ROLES) {
      await queryRunner.query(
        `INSERT INTO bectu_rates (trade, rank, daily_rate, overtime_rate, rate_year, rate_type, effective_from)
         VALUES ('Non-BECTU', $1, NULL, NULL, '2026/27', 'non_bectu', $2)
         ON CONFLICT (trade, rank, rate_year) DO UPDATE
           SET rate_type     = 'non_bectu',
               effective_from = COALESCE(bectu_rates.effective_from, $2)`,
        [role, EFFECTIVE_FROM]
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM bectu_rates WHERE rate_year = '2026/27'`
    );
  }
}
