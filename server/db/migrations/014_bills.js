/**
 * Migration 014 — bills
 *
 * Tracks bills owed to vendors (PAYEE contacts) with accrual accounting.
 * 
 * Flow:
 *   1. Create bill → Dr Expense, Cr Accounts Payable
 *   2. Pay bill    → Dr Accounts Payable, Cr Bank Account
 *
 * Only UNPAID bills can be edited. PAID and VOID bills are locked.
 * No partial payments — bills must be paid in full.
 */

exports.up = function(knex) {
  return knex.schema.createTable('bills', (t) => {
    t.increments('id').primary();
    
    // Vendor (PAYEE contact)
    t.integer('contact_id').unsigned()
      .references('id').inTable('contacts')
      .onDelete('RESTRICT'); // Can't delete vendor with bills
    
    // Bill details
    t.date('date').notNullable();
    t.date('due_date').notNullable();
    t.string('bill_number');           // Manual entry, optional
    t.text('description').notNullable();
    t.decimal('amount', 15, 2).notNullable();
    
    // Which expense account to debit
    t.integer('expense_account_id').unsigned()
      .references('id').inTable('accounts')
      .onDelete('RESTRICT');
    
    // Which fund this expense belongs to
    t.integer('fund_id').unsigned()
      .references('id').inTable('funds')
      .onDelete('RESTRICT');
    
    // Payment tracking
    t.decimal('amount_paid', 15, 2).notNullable().defaultTo(0);
    t.enum('status', ['UNPAID', 'PAID', 'VOID'])
      .notNullable().defaultTo('UNPAID');
    
    // Link to payment transaction (created when paid)
    t.integer('transaction_id').unsigned()
      .references('id').inTable('transactions')
      .onDelete('SET NULL');
    
    // Audit trail
    t.integer('created_by').unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.integer('paid_by').unsigned()
      .references('id').inTable('users')
      .onDelete('SET NULL');
    t.timestamp('paid_at');
    
    t.timestamps(true, true);
    
    // Indexes for common queries
    t.index('status');
    t.index('due_date');
    t.index('contact_id');
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('bills');
};
