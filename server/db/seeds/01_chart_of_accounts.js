const fs = require('fs');
const path = require('path');

/**
 * Seed — Chart of Accounts
 * Loads data from a private JSON file if available to protect sensitive chart details.
 */
exports.seed = async function (knex) {
  const dataPath = path.join(__dirname, 'data/accounts.json');
  
  // 1. Define fallback "Example" accounts for GitHub/Public use
  let ACCOUNTS = [
    { code: '1000', name: 'General Checking', type: 'ASSET' },
    { code: '3000', name: 'Net Assets',       type: 'EQUITY' },
    { code: '4001', name: 'General Offering', type: 'INCOME' },
    { code: '5001', name: 'General Expense',  type: 'EXPENSE' }
  ];

  // 2. Try to load the private data from the git-ignored JSON file
  if (fs.existsSync(dataPath)) {
    try {
      const privateData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      ACCOUNTS = privateData;
      console.log(`📂 Loaded ${ACCOUNTS.length} accounts from private data file.`);
    } catch (err) {
      console.error('❌ Error parsing private accounts.json, using defaults.');
    }
  } else {
    console.log('ℹ️ No private data found at seeds/data/accounts.json. Using public templates.');
  }

  // 3. Idempotent Sync Logic (No Deletions)
  for (const account of ACCOUNTS) {
    const existing = await knex('accounts').where({ code: account.code }).first();
    if (!existing) {
      await knex('accounts').insert({
        ...account,
        is_active:  true,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    } else {
      // Update existing names/types to keep DB in sync with your JSON
      await knex('accounts').where({ id: existing.id }).update({
        name: account.name,
        type: account.type,
        updated_at: knex.fn.now()
      });
    }
  }
  console.log('✅ Account synchronization complete.');
};
