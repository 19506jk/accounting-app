/**
 * Migration 022 — account_class + normal_balance
 *
 * Adds account metadata required for Trial Balance diagnostics:
 *   - account_class: supports contra-account classification
 *   - normal_balance: optional explicit DEBIT/CREDIT override
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('accounts', (t) => {
    t.enu(
      'account_class',
      [
        'ASSET',
        'CONTRA_ASSET',
        'LIABILITY',
        'CONTRA_LIABILITY',
        'EQUITY',
        'CONTRA_EQUITY',
        'INCOME',
        'CONTRA_INCOME',
        'EXPENSE',
        'CONTRA_EXPENSE',
      ],
      { useNative: true, enumName: 'account_class_enum' }
    ).nullable();
    t.enu('normal_balance', ['DEBIT', 'CREDIT'], { useNative: true, enumName: 'normal_balance_enum' }).nullable();
  });

  await knex.raw(`
    UPDATE accounts
    SET account_class = CASE type
      WHEN 'ASSET' THEN 'ASSET'::account_class_enum
      WHEN 'LIABILITY' THEN 'LIABILITY'::account_class_enum
      WHEN 'EQUITY' THEN 'EQUITY'::account_class_enum
      WHEN 'INCOME' THEN 'INCOME'::account_class_enum
      WHEN 'EXPENSE' THEN 'EXPENSE'::account_class_enum
      ELSE NULL
    END
    WHERE account_class IS NULL
  `);

  await knex.raw(`
    UPDATE accounts
    SET account_class = 'CONTRA_ASSET'::account_class_enum
    WHERE LOWER(name) LIKE '%accumulated depreciation%'
       OR LOWER(name) LIKE '%allowance for%'
  `);

  await knex.raw(`
    UPDATE accounts
    SET account_class = 'CONTRA_INCOME'::account_class_enum
    WHERE LOWER(name) LIKE '%sales return%'
       OR LOWER(name) LIKE '%sales discount%'
       OR LOWER(name) LIKE '%discounts allowed%'
  `);

  await knex.raw(`
    UPDATE accounts
    SET account_class = 'CONTRA_EQUITY'::account_class_enum
    WHERE LOWER(name) LIKE '%draw%'
       OR LOWER(name) LIKE '%distribution%'
  `);
};

exports.down = async function (knex) {
  await knex.schema.alterTable('accounts', (t) => {
    t.dropColumn('normal_balance');
    t.dropColumn('account_class');
  });

  await knex.raw('DROP TYPE IF EXISTS normal_balance_enum');
  await knex.raw('DROP TYPE IF EXISTS account_class_enum');
};
