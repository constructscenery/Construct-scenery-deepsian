require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../config/db');
const { encrypt } = require('../config/crypto');

async function seed() {
  console.log('Seeding role contacts and containers...');

  // 1. Seed Role Contacts
  const roleContacts = [
    {
      role_type: 'designer',
      full_name: 'Warren Lever',
      company_or_production: 'Construct Scenery Ltd',
      notes: 'Lead scenic designer on internal projects and bespoke set elements.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'designer',
      full_name: 'Kevin Phipps',
      company_or_production: 'Commercial - LG (Smuggler London)',
      notes: 'Experienced film and commercial production designer.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'designer',
      full_name: 'Will Field',
      company_or_production: 'Commercial - Shreddies (Agile Films)',
      notes: 'Commercial art department & production design lead.',
      call_priority: 'backup',
      is_favourite: false,
    },
    {
      role_type: 'designer',
      full_name: 'Damien Creagh',
      company_or_production: 'Commercial - Sky (Merman London)',
      notes: 'Feature and high-end commercial designer.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'designer',
      full_name: 'Mike Carlin',
      company_or_production: 'Oslo (Redcastle Productions)',
      notes: 'Feature film production designer.',
      call_priority: 'first_call',
      is_favourite: false,
    },
    {
      role_type: 'supv_art',
      full_name: 'David Allday',
      company_or_production: 'Warner Bros / Leavesden',
      notes: 'Supervising art director for large-scale stage builds & backlot structures.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'supv_art',
      full_name: 'Helen Xenopoulos',
      company_or_production: 'Pinewood Studios',
      notes: 'High-end series supervising art director.',
      call_priority: 'first_call',
      is_favourite: false,
    },
    {
      role_type: 'art_dir',
      full_name: 'Oliver Goodier',
      company_or_production: 'Shepperton Studios',
      notes: 'Art director specialising in practical set construction drawing packages.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'art_dir',
      full_name: 'Chloe Kletwich',
      company_or_production: 'Longcross Studios',
      notes: 'Standby & construction art director.',
      call_priority: 'backup',
      is_favourite: false,
    },
    {
      role_type: 'fin_control',
      full_name: 'Marcus Sterling',
      company_or_production: 'Shoe Bucket Ltd',
      notes: 'Production financial controller on episodic drama.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'fin_control',
      full_name: 'Rachel Vance',
      company_or_production: 'Minim UK Productions',
      notes: 'Lead production accountant & financial controller.',
      call_priority: 'backup',
      is_favourite: false,
    },
    {
      role_type: 'producer',
      full_name: 'Simon Emanuel',
      company_or_production: 'Lucasfilm / Disney',
      notes: 'Executive producer / lead physical production.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'producer',
      full_name: 'Sarah Bradshaw',
      company_or_production: 'Universal Pictures',
      notes: 'Feature film producer.',
      call_priority: 'first_call',
      is_favourite: false,
    },
    {
      role_type: 'upm',
      full_name: 'Mark Mostyn',
      company_or_production: 'Warner Bros',
      notes: 'Unit production manager handling studio stage allocation and crew logistics.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'upm',
      full_name: 'Tania Windsor',
      company_or_production: 'Netflix UK',
      notes: 'UPM on UK drama series.',
      call_priority: 'backup',
      is_favourite: false,
    },
    {
      role_type: 'line_prod',
      full_name: 'Guy Heeley',
      company_or_production: 'Shoebox Films',
      notes: 'Line producer managing overall build schedules and department budgets.',
      call_priority: 'first_call',
      is_favourite: true,
    },
    {
      role_type: 'line_prod',
      full_name: 'Fiona Hampton',
      company_or_production: 'BBC Film / BFI',
      notes: 'Independent feature line producer.',
      call_priority: 'first_call',
      is_favourite: false,
    },
  ];

  for (const rc of roleContacts) {
    await db.query(
      `INSERT INTO crew_role_contacts (role_type, full_name, company_or_production, notes, is_favourite, call_priority)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        rc.role_type,
        rc.full_name,
        rc.company_or_production,
        rc.notes ? encrypt(rc.notes) : null,
        rc.is_favourite,
        rc.call_priority,
      ]
    );
  }
  console.log(`✅ Seeded ${roleContacts.length} role contacts`);

  // 2. Seed Containers
  const { rows: prods } = await db.query('SELECT id, name FROM productions LIMIT 5');
  const prodId1 = prods[0]?.id || null;
  const prodId2 = prods[1]?.id || null;

  const containers = [
    {
      container_number: 'CONT-001',
      container_type: '20ft Storage Container',
      size: '20ft',
      status: 'available',
      ownership_status: 'owned',
      location: 'Construct Scenery Main Yard',
      assigned_production_id: null,
      supplier: null,
      weekly_cost: null,
      condition: 'good',
      contents_description: 'Standard scenic timber offcuts, mouldings, plywood sheets.',
      notes: 'Master lock key held in main workshop office lockbox.',
    },
    {
      container_number: 'CONT-002',
      container_type: '20ft Storage Container',
      size: '20ft',
      status: 'in_use',
      ownership_status: 'owned',
      location: 'Pinewood Studios - Lot 3',
      assigned_production_id: prodId1,
      supplier: null,
      weekly_cost: null,
      condition: 'good',
      contents_description: 'Carpentry hand tools, router jigs, power tools, extension leads.',
      notes: 'Site container for lead carpentry crew.',
    },
    {
      container_number: 'CONT-003',
      container_type: '40ft High Cube Container',
      size: '40ft',
      status: 'in_use',
      ownership_status: 'hired',
      location: 'Longcross Stage 2 Backlot',
      assigned_production_id: prodId2,
      supplier: 'Mobile Mini UK',
      hire_start_date: '2026-08-01',
      hire_end_date: '2026-12-15',
      weekly_cost: 65.00,
      condition: 'good',
      contents_description: 'Pre-assembled architectural scenic steel frames and flats.',
      notes: 'Supplier agreement #MM-884920. Off-hire inspection booked for December.',
    },
    {
      container_number: 'CONT-004',
      container_type: 'Site Office Container',
      size: '20ft',
      status: 'in_use',
      ownership_status: 'hired',
      location: 'Shepperton Studios Lot 1',
      assigned_production_id: prodId1,
      supplier: 'Willbox Containers',
      hire_start_date: '2026-07-15',
      hire_end_date: '2026-11-30',
      weekly_cost: 95.00,
      condition: 'good',
      contents_description: 'Construction manager site desk, plan drawing chest, electrical heater, WiFi router.',
      notes: 'Desk power certified. Lock code: 4421.',
    },
    {
      container_number: 'CONT-005',
      container_type: 'Chemical / Flammables Storage',
      size: '10ft',
      status: 'available',
      ownership_status: 'owned',
      location: 'Construct Scenery Paint Yard',
      assigned_production_id: null,
      supplier: null,
      weekly_cost: null,
      condition: 'good',
      contents_description: 'COSHH compliant storage for solvent paints, spirit glues, resin hardeners.',
      notes: 'Vented bunded chemical store. COSHH safety signage affixed on door.',
    },
    {
      container_number: 'CONT-006',
      container_type: 'Store / Workshop Container',
      size: '20ft',
      status: 'maintenance',
      ownership_status: 'owned',
      location: 'Main Yard - Maintenance Bay',
      assigned_production_id: null,
      supplier: null,
      weekly_cost: null,
      condition: 'needs_repair',
      contents_description: 'Empty container undergoing door seal and corner casting repair.',
      notes: 'Scheduled for rubber weather-seal replacement this Friday.',
    },
  ];

  for (const c of containers) {
    await db.query(
      `INSERT INTO containers (
        container_number, container_type, size, status, ownership_status,
        location, assigned_production_id, supplier, hire_start_date, hire_end_date,
        weekly_cost, condition, contents_description, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        c.container_number,
        c.container_type,
        c.size,
        c.status,
        c.ownership_status,
        c.location,
        c.assigned_production_id,
        c.supplier,
        c.hire_start_date || null,
        c.hire_end_date || null,
        c.weekly_cost,
        c.condition,
        c.contents_description,
        c.notes,
      ]
    );
  }
  console.log(`✅ Seeded ${containers.length} containers`);

  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
