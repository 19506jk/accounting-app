exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV !== 'test') return;

  await knex('users')
    .insert({
      id: 1,
      email: 'e2e-admin@test.local',
      name: 'E2E Admin',
      role: 'admin',
      is_active: true,
    })
    .onConflict('id')
    .merge();
};
