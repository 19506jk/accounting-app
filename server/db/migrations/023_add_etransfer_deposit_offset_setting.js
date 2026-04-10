exports.up = async function (knex) {
  const existing = await knex('settings')
    .where({ key: 'etransfer_deposit_offset_account_id' })
    .first();
  if (!existing) {
    await knex('settings').insert({
      key:        'etransfer_deposit_offset_account_id',
      label:      'E-Transfer Deposit Offset Account',
      value:      null,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
};

exports.down = async function (knex) {
  await knex('settings').where({ key: 'etransfer_deposit_offset_account_id' }).delete();
};
