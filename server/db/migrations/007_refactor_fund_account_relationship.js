/**
 * Migration 007 — Refactor fund-account relationship
 *
 * Changes:
 *  1. Add fund_id to journal_entries (nullable first, then NOT NULL)
 *  2. Seed "General Fund" + its Net Asset equity account if none exist
 *  3. Assign all existing journal entries to General Fund
 *  4. Enforce NOT NULL on journal_entries.fund_id
 *  5. Remove fund_id from accounts (fund lives on the transaction/entry)
 *  6. Add net_asset_account_id to funds
 */

exports.up = async function (knex) {
  // ── Step 1: Add fund_id to journal_entries as nullable ──────────────────
  await knex.schema.alterTable('journal_entries', (t) => {
    t.integer('fund_id').unsigned().nullable()
      .references('id').inTable('funds').onDelete('RESTRICT');
  });

  // ── Step 2: Ensure a General Fund exists ────────────────────────────────
  let [generalFund] = await knex('funds').limit(1);

  if (!generalFund) {
    // Create the General Fund equity account first (code 3000)
    const [equityAccount] = await knex('accounts')
      .insert({
        code:       '3000',
        name:       'General Fund - Net Assets',
        type:       'EQUITY',
        is_active:  true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning('*');

    // Create General Fund linked to the equity account
    const [fund] = await knex('funds')
      .insert({
        name:        'General Fund',
        description: 'Main operating fund',
        is_active:   true,
        created_at:  knex.fn.now(),
        updated_at:  knex.fn.now(),
      })
      .returning('*');

    generalFund = fund;

    // We'll link net_asset_account_id after adding the column (step 6)
    // Store for use below
    generalFund._equityAccountId = equityAccount.id;
  }

  // ── Step 3: Assign all existing journal entries to General Fund ─────────
  await knex('journal_entries').update({ fund_id: generalFund.id });

  // ── Step 4: Enforce NOT NULL on journal_entries.fund_id ─────────────────
  await knex.schema.alterTable('journal_entries', (t) => {
    t.integer('fund_id').unsigned().notNullable().alter();
  });

  // ── Step 5: Remove fund_id from accounts ────────────────────────────────
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('fund_id');
  });

  // ── Step 6: Add net_asset_account_id to funds ───────────────────────────
  await knex.schema.alterTable('funds', (t) => {
    t.integer('net_asset_account_id').unsigned().nullable()
      .references('id').inTable('accounts').onDelete('RESTRICT');
  });

  // ── Step 7: Link General Fund to its equity account ─────────────────────
  if (generalFund._equityAccountId) {
    await knex('funds')
      .where({ id: generalFund.id })
      .update({ net_asset_account_id: generalFund._equityAccountId });
  }
};

exports.down = async function (knex) {
  // Reverse in opposite order
  await knex.schema.alterTable('funds', (t) => {
    t.dropColumn('net_asset_account_id');
  });

  await knex.schema.alterTable('accounts', (t) => {
    t.integer('fund_id').unsigned().nullable()
      .references('id').inTable('funds').onDelete('SET NULL');
  });

  await knex.schema.alterTable('journal_entries', (t) => {
    t.dropColumn('fund_id');
  });
};
