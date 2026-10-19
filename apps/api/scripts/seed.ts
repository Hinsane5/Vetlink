import 'dotenv/config';
import { createPostgresPool } from '../src/database/postgres-pool.js';

const fixture = {
  farmerId: '00000000-0000-4000-8000-000000000001',
  vetId: '00000000-0000-4000-8000-000000000002',
  farmId: '00000000-0000-4000-8000-000000000011',
  livestockId: '00000000-0000-4000-8000-000000000021',
  payoutDestinationId: '00000000-0000-4000-8000-000000000120',
};

const productFixtures = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'Sikat Kandang Seruni',
    category: 'perawatan',
    species: ['sapi', 'kambing'],
    description: 'Sikat perawatan kandang fiktif untuk penggunaan umum.',
    unitPriceIdr: 18500,
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'Ember Pakan Rinjani',
    category: 'perlengkapan',
    species: ['sapi', 'kambing'],
    description: 'Ember pakan fiktif berkapasitas 12 liter.',
    unitPriceIdr: 42000,
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'Tempat Pakan Fiktif Nonaktif',
    category: 'perlengkapan',
    species: ['sapi'],
    description: 'Fixture katalog nonaktif untuk pemeriksaan filter.',
    unitPriceIdr: 27500,
    active: false,
  },
];

async function main(): Promise<void> {
  const pool = createPostgresPool();
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query(
      `INSERT INTO users (id, email, full_name)
       VALUES ($1, 'budi.fixture@example.invalid', 'Budi Fixture'),
              ($2, 'yuda.fixture@example.invalid', 'Yuda Fixture')
       ON CONFLICT DO NOTHING`,
      [fixture.farmerId, fixture.vetId],
    );
    await connection.query(
      `INSERT INTO role_memberships (user_id, role)
       VALUES ($1, 'farmer'), ($2, 'vet')
       ON CONFLICT DO NOTHING`,
      [fixture.farmerId, fixture.vetId],
    );
    await connection.query(
      `INSERT INTO farmer_profiles (user_id)
       VALUES ($1)
       ON CONFLICT DO NOTHING`,
      [fixture.farmerId],
    );
    await connection.query(
      `INSERT INTO vet_profiles (user_id, professional_name, verification_status)
       VALUES ($1, 'Yuda Fixture', 'not_submitted')
       ON CONFLICT DO NOTHING`,
      [fixture.vetId],
    );
    await connection.query(
      `INSERT INTO farms (id, owner_id, name, species, timezone)
       VALUES ($1, $2, 'Kebun Contoh Budi', ARRAY['sapi'], 'Asia/Jakarta')
       ON CONFLICT DO NOTHING`,
      [fixture.farmId, fixture.farmerId],
    );
    await connection.query(
      `INSERT INTO livestock (id, farmer_id, farm_id, display_code, name, species, sex)
       VALUES ($1, $2, $3, 'FIX-001', 'Mawar Fiktif', 'sapi', 'female')
       ON CONFLICT DO NOTHING`,
      [fixture.livestockId, fixture.farmerId, fixture.farmId],
    );

    const graph = await connection.query(
      `SELECT 1
       FROM users farmer
       JOIN role_memberships farmer_role ON farmer_role.user_id = farmer.id AND farmer_role.role = 'farmer'
       JOIN farmer_profiles fp ON fp.user_id = farmer.id
       JOIN farms farm ON farm.owner_id = fp.user_id AND farm.id = $3
       JOIN livestock animal ON animal.farm_id = farm.id AND animal.farmer_id = fp.user_id AND animal.id = $4
       JOIN users vet ON vet.id = $2
       JOIN role_memberships vet_role ON vet_role.user_id = vet.id AND vet_role.role = 'vet'
       JOIN vet_profiles vp ON vp.user_id = vet.id
       WHERE farmer.id = $1
         AND farmer.email = 'budi.fixture@example.invalid'
         AND vet.email = 'yuda.fixture@example.invalid'`,
      [fixture.farmerId, fixture.vetId, fixture.farmId, fixture.livestockId],
    );
    if (graph.rowCount !== 1) {
      throw new Error('Fixture IDs conflict with existing data; no rows were overwritten');
    }

    await connection.query(
      `INSERT INTO payout_destinations(id,vet_id,label,bank_label,account_masked,account_holder)
       VALUES($1,$2,'Tujuan Lokal Yuda','Bank Contoh','•••• 4321','Yuda Fixture')
       ON CONFLICT DO NOTHING`,
      [fixture.payoutDestinationId, fixture.vetId],
    );
    const payoutDestination = await connection.query<{ id: string; vet_id: string; label: string; bank_label: string; account_masked: string; account_holder: string }>(
      `SELECT id,vet_id,label,bank_label,account_masked,account_holder
       FROM payout_destinations WHERE id=$1`, [fixture.payoutDestinationId],
    );
    const destination = payoutDestination.rows[0];
    if (!destination || destination.vet_id !== fixture.vetId || destination.label !== 'Tujuan Lokal Yuda'
      || destination.bank_label !== 'Bank Contoh' || destination.account_masked !== '•••• 4321'
      || destination.account_holder !== 'Yuda Fixture') {
      throw new Error('Payout destination fixture ID conflicts with existing data; no rows were overwritten');
    }

    for (const product of productFixtures) {
      await connection.query(
        `INSERT INTO products (id, name, category, species, description, unit_price_idr, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [product.id, product.name, product.category, product.species, product.description, product.unitPriceIdr, product.active],
      );
    }
    const seededProducts = await connection.query<{ id: string; name: string; category: string; species: string[]; description: string; unit_price_idr: string; active: boolean }>(
      'SELECT id, name, category, species, description, unit_price_idr::text AS unit_price_idr, active FROM products WHERE id = ANY($1::uuid[])',
      [productFixtures.map((product) => product.id)],
    );
    const productsById = new Map(seededProducts.rows.map((product) => [product.id, product]));
    if (productFixtures.some((product) => {
      const stored = productsById.get(product.id);
      return !stored
        || stored.name !== product.name
        || stored.category !== product.category
        || JSON.stringify(stored.species) !== JSON.stringify(product.species)
        || stored.description !== product.description
        || Number(stored.unit_price_idr) !== product.unitPriceIdr
        || stored.active !== product.active;
    })) {
      throw new Error('Product fixture IDs conflict with existing catalog data; no rows were overwritten');
    }

    await connection.query('COMMIT');
    console.log('Fixture fiktif akun, tujuan pencairan termasking, dan katalog tersedia; existing rows dipertahankan (INSERT ON CONFLICT DO NOTHING).');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown seed error';
  console.error(`Seed gagal: ${message}`);
  process.exitCode = 1;
});
