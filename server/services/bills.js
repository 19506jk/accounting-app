const Decimal = require('decimal.js');
const db      = require('../db');

const dec = (v) => new Decimal(v ?? 0);

const ROUNDING_ACCOUNT_CODE = '59999';
const TOLERANCE = 0.01;

function validateBillData(data, isUpdate = false) {
  const errors = [];

  if (!isUpdate || data.contact_id !== undefined) {
    if (!data.contact_id) errors.push('contact_id (vendor) is required');
  }

  if (!isUpdate || data.date !== undefined) {
    if (!data.date) errors.push('date is required');
  }

  // due_date is now optional - no validation needed

  // description is now optional - no validation needed

  if (!isUpdate || data.amount !== undefined) {
    if (!data.amount) errors.push('amount is required');
    else if (dec(data.amount).lte(0)) errors.push('amount must be greater than 0');
    else if (dec(data.amount).decimalPlaces() > 2) errors.push('amount cannot have more than 2 decimal places');
  }

  if (!isUpdate || data.fund_id !== undefined) {
    if (!data.fund_id) errors.push('fund_id is required');
  }

  if (!isUpdate || data.line_items !== undefined) {
    if (!data.line_items || !Array.isArray(data.line_items)) {
      errors.push('line_items is required and must be an array');
    } else if (data.line_items.length === 0) {
      errors.push('at least one line item is required');
    } else {
      for (let i = 0; i < data.line_items.length; i++) {
        const line = data.line_items[i];
        if (!line.expense_account_id) {
          errors.push(`Line ${i + 1}: expense account is required`);
        }
        if (line.amount === undefined || line.amount === null || line.amount === '') {
          errors.push(`Line ${i + 1}: amount is required`);
        } else {
          const amount = dec(line.amount);
          if (amount.decimalPlaces() > 2) {
            errors.push(`Line ${i + 1}: amount cannot have more than 2 decimal places`);
          }
        }
        // Line description is now optional - no validation needed
      }
    }
  }

  if (data.line_items && data.line_items.length > 0 && data.amount !== undefined) {
    const lineItemTotal = data.line_items.reduce((sum, li) => sum + dec(li.amount).toNumber(), 0);
    const billAmount = dec(data.amount).toNumber();
    const diff = Math.abs(lineItemTotal - billAmount);
    if (diff > TOLERANCE) {
      errors.push(`Line item total ($${lineItemTotal.toFixed(2)}) must equal bill amount ($${billAmount.toFixed(2)})`);
    }
  }

  if (data.date && data.due_date) {
    const billDate = new Date(data.date);
    const dueDate = new Date(data.due_date);
    if (dueDate < billDate) {
      errors.push('due_date cannot be before bill date');
    }
  }

  return errors;
}

async function getBillWithLineItems(billId) {
  const bill = await db('bills as b')
    .leftJoin('contacts as c', 'c.id', 'b.contact_id')
    .leftJoin('funds as f', 'f.id', 'b.fund_id')
    .leftJoin('users as created_by', 'created_by.id', 'b.created_by')
    .leftJoin('users as paid_by', 'paid_by.id', 'b.paid_by')
    .where('b.id', billId)
    .select(
      'b.*',
      'c.name as vendor_name',
      'c.email as vendor_email',
      'c.phone as vendor_phone',
      'f.name as fund_name',
      'created_by.name as created_by_name',
      'paid_by.name as paid_by_name',
    )
    .first();

  if (!bill) return null;

  const lineItems = await db('bill_line_items as bli')
    .join('accounts as a', 'a.id', 'bli.expense_account_id')
    .where('bli.bill_id', billId)
    .select(
      'bli.*',
      'a.code as expense_account_code',
      'a.name as expense_account_name'
    );

  return {
    ...bill,
    amount: parseFloat(bill.amount),
    amount_paid: parseFloat(bill.amount_paid),
    line_items: lineItems.map(li => ({
      id: li.id,
      expense_account_id: li.expense_account_id,
      expense_account_code: li.expense_account_code,
      expense_account_name: li.expense_account_name,
      amount: parseFloat(li.amount),
      description: li.description,
    })),
  };
}

async function createBillLineItems(billId, lineItems, trx) {
  const lineItemRecords = lineItems.map(li => ({
    bill_id: billId,
    expense_account_id: li.expense_account_id,
    amount: dec(li.amount).toFixed(2),
    description: li.description.trim(),
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  }));

  return trx('bill_line_items').insert(lineItemRecords).returning('*');
}

async function createMultiLineJournalEntries(transactionId, billId, lineItems, fundId, apAccountId, contactName, billNumber, trx) {
  const totalAmount = lineItems.reduce((sum, li) => sum + dec(li.amount).toNumber(), 0);
  
  const journalEntries = [];

  for (const line of lineItems) {
    const amount = dec(line.amount).toFixed(2);
    if (dec(amount).gte(0)) {
      journalEntries.push({
        transaction_id: transactionId,
        account_id: line.expense_account_id,
        fund_id: fundId,
        debit: amount,
        credit: 0,
        memo: `Bill ${billNumber || ''} - ${line.description}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    } else {
      journalEntries.push({
        transaction_id: transactionId,
        account_id: line.expense_account_id,
        fund_id: fundId,
        debit: 0,
        credit: Math.abs(parseFloat(amount)).toFixed(2),
        memo: `Bill ${billNumber || ''} - ${line.description}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
    }
  }

  journalEntries.push({
    transaction_id: transactionId,
    account_id: apAccountId,
    fund_id: fundId,
    debit: 0,
    credit: dec(totalAmount).toFixed(2),
    memo: `Bill ${billNumber || ''} - ${contactName}`,
    is_reconciled: false,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  });

  return trx('journal_entries').insert(journalEntries).returning('*');
}

async function validateLineItemAccounts(lineItems) {
  const errors = [];
  const roundingAccount = await db('accounts')
    .where({ code: ROUNDING_ACCOUNT_CODE })
    .where('is_active', true)
    .first();

  for (let i = 0; i < lineItems.length; i++) {
    const line = lineItems[i];
    const account = await db('accounts')
      .where({ id: line.expense_account_id })
      .where('is_active', true)
      .first();

    if (!account) {
      errors.push(`Line ${i + 1}: Expense account not found or inactive`);
      continue;
    }

    if (account.type !== 'EXPENSE') {
      errors.push(`Line ${i + 1}: Selected account must be an EXPENSE type`);
    }

    if (dec(line.amount).lt(0) && account.code !== ROUNDING_ACCOUNT_CODE) {
      errors.push(`Line ${i + 1}: Negative amounts only allowed in account ${ROUNDING_ACCOUNT_CODE} (Rounding & Adjustments)`);
    }
  }

  return errors;
}

async function createBill(payload, userId) {
  const errors = validateBillData(payload);
  if (errors.length) return { errors };

  const contact = await db('contacts')
    .where({ id: payload.contact_id })
    .where('is_active', true)
    .first();

  if (!contact) {
    return { errors: ['Vendor not found or inactive'] };
  }

  if (!['PAYEE', 'BOTH'].includes(contact.type)) {
    return { errors: ['Contact must be a vendor (PAYEE or BOTH type)'] };
  }

  const fund = await db('funds')
    .where({ id: payload.fund_id })
    .where('is_active', true)
    .first();

  if (!fund) {
    return { errors: ['Fund not found or inactive'] };
  }

  const accountErrors = await validateLineItemAccounts(payload.line_items);
  if (accountErrors.length) {
    return { errors: accountErrors };
  }

  const apAccount = await db('accounts')
    .where({ code: '20000' })
    .where('is_active', true)
    .first();

  if (!apAccount) {
    return { errors: ['Accounts Payable account (20000) not found'] };
  }

  const totalAmount = payload.line_items.reduce((sum, li) => sum + dec(li.amount).toNumber(), 0);

  const result = await db.transaction(async (trx) => {
    const [bill] = await trx('bills')
      .insert({
        contact_id: payload.contact_id,
        date: payload.date,
        due_date: payload.due_date,
        bill_number: payload.bill_number?.trim() || null,
        description: payload.description.trim(),
        amount: dec(totalAmount).toFixed(2),
        fund_id: payload.fund_id,
        amount_paid: 0,
        status: 'UNPAID',
        created_by: userId,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*');

    const [transaction] = await trx('transactions')
      .insert({
        date: payload.date,
        description: `Bill: ${payload.description.trim()} (${payload.bill_number?.trim() || 'no #'})`,
        reference_no: payload.bill_number?.trim() || null,
        fund_id: payload.fund_id,
        created_by: userId,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*');

    await trx('bills')
      .where({ id: bill.id })
      .update({ created_transaction_id: transaction.id });

    await createBillLineItems(bill.id, payload.line_items, trx);
    
    await createMultiLineJournalEntries(
      transaction.id,
      bill.id,
      payload.line_items,
      payload.fund_id,
      apAccount.id,
      contact.name,
      payload.bill_number?.trim(),
      trx
    );

    return { bill, transaction };
  });

  const billWithLineItems = await getBillWithLineItems(result.bill.id);
  return { bill: billWithLineItems, transaction: result.transaction };
}

async function updateBill(id, payload, userId) {
  const bill = await db('bills').where({ id }).first();
  if (!bill) {
    return { errors: ['Bill not found'] };
  }

  if (bill.status !== 'UNPAID') {
    return { errors: [`Cannot edit ${bill.status} bills`] };
  }

  const errors = validateBillData(payload, true);
  if (errors.length) return { errors };

  if (payload.contact_id !== undefined) {
    const contact = await db('contacts')
      .where({ id: payload.contact_id })
      .where('is_active', true)
      .first();

    if (!contact) {
      return { errors: ['Vendor not found or inactive'] };
    }

    if (!['PAYEE', 'BOTH'].includes(contact.type)) {
      return { errors: ['Contact must be a vendor (PAYEE or BOTH type)'] };
    }
  }

  if (payload.fund_id !== undefined) {
    const fund = await db('funds')
      .where({ id: payload.fund_id })
      .where('is_active', true)
      .first();

    if (!fund) {
      return { errors: ['Fund not found or inactive'] };
    }
  }

  if (payload.line_items !== undefined) {
    const accountErrors = await validateLineItemAccounts(payload.line_items);
    if (accountErrors.length) {
      return { errors: accountErrors };
    }
  }

  const newLineItems = payload.line_items || [];
  const newTotalAmount = newLineItems.length > 0 
    ? newLineItems.reduce((sum, li) => sum + dec(li.amount).toNumber(), 0)
    : dec(bill.amount).toNumber();

  if (payload.line_items !== undefined || payload.created_transaction_id) {
    await db.transaction(async (trx) => {
      await trx('bill_line_items')
        .where({ bill_id: id })
        .delete();

      if (newLineItems.length > 0) {
        await createBillLineItems(id, newLineItems, trx);
      }

      if (bill.created_transaction_id) {
        await trx('journal_entries')
          .where({ transaction_id: bill.created_transaction_id })
          .delete();

        const apAccount = await trx('accounts')
          .where({ code: '20000' })
          .first();

        const contact = await trx('contacts')
          .where({ id: payload.contact_id || bill.contact_id })
          .first();

        await createMultiLineJournalEntries(
          bill.created_transaction_id,
          id,
          newLineItems,
          payload.fund_id || bill.fund_id,
          apAccount.id,
          contact?.name || '',
          bill.bill_number || '',
          trx
        );
      }
    });
  }

  const updateData = {
    contact_id: payload.contact_id !== undefined ? payload.contact_id : bill.contact_id,
    date: payload.date !== undefined ? payload.date : bill.date,
    due_date: payload.due_date !== undefined ? payload.due_date : bill.due_date,
    bill_number: payload.bill_number !== undefined ? payload.bill_number?.trim() || null : bill.bill_number,
    description: payload.description !== undefined ? payload.description.trim() : bill.description,
    amount: dec(newTotalAmount).toFixed(2),
    fund_id: payload.fund_id !== undefined ? payload.fund_id : bill.fund_id,
    updated_at: db.fn.now(),
  };

  const [updated] = await db('bills')
    .where({ id })
    .update(updateData)
    .returning('*');

  const billWithLineItems = await getBillWithLineItems(id);
  return { bill: billWithLineItems };
}

async function payBill(id, paymentData, userId) {
  const bill = await getBillWithLineItems(id);
  if (!bill) {
    return { errors: ['Bill not found'] };
  }

  if (bill.status !== 'UNPAID') {
    return { errors: [`Cannot pay a ${bill.status} bill`] };
  }

  const errors = [];
  if (!paymentData.payment_date) errors.push('payment_date is required');
  if (!paymentData.bank_account_id) errors.push('bank_account_id is required');
  
  if (errors.length) return { errors };

  const bankAccount = await db('accounts')
    .where({ id: paymentData.bank_account_id })
    .where('is_active', true)
    .first();

  if (!bankAccount) {
    return { errors: ['Bank account not found or inactive'] };
  }

  if (bankAccount.type !== 'ASSET') {
    return { errors: ['Selected account must be an ASSET type (bank account)'] };
  }

  const outstanding = dec(bill.amount).minus(dec(bill.amount_paid));
  
  if (paymentData.amount !== undefined) {
    const paymentAmount = dec(paymentData.amount);
    if (!paymentAmount.equals(outstanding)) {
      return { 
        errors: [`Payment amount must equal outstanding balance ($${outstanding.toFixed(2)})`],
        outstanding: parseFloat(outstanding.toFixed(2))
      };
    }
  }

  const apAccount = await db('accounts')
    .where({ code: '20000' })
    .where('is_active', true)
    .first();

  if (!apAccount) {
    return { errors: ['Accounts Payable account (20000) not found'] };
  }

  const result = await db.transaction(async (trx) => {
    const [transaction] = await trx('transactions')
      .insert({
        date: paymentData.payment_date,
        description: `Payment for bill ${bill.bill_number || `#${bill.id}`} - ${bill.description}`,
        reference_no: paymentData.reference_no?.trim() || null,
        fund_id: bill.fund_id,
        created_by: userId,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*');

    const amount = outstanding.toFixed(2);
    await trx('journal_entries').insert([
      {
        transaction_id: transaction.id,
        account_id: apAccount.id,
        fund_id: bill.fund_id,
        debit: amount,
        credit: 0,
        memo: `Payment for bill ${bill.bill_number || `#${bill.id}`}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      },
      {
        transaction_id: transaction.id,
        account_id: bankAccount.id,
        fund_id: bill.fund_id,
        debit: 0,
        credit: amount,
        memo: `Payment for bill ${bill.bill_number || `#${bill.id}`}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      },
    ]);

    const [updatedBill] = await trx('bills')
      .where({ id })
      .update({
        amount_paid: dec(bill.amount).toFixed(2),
        status: 'PAID',
        transaction_id: transaction.id,
        paid_by: userId,
        paid_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return { transaction, bill: updatedBill };
  });

  const billWithLineItems = await getBillWithLineItems(id);
  return { bill: billWithLineItems, transaction: result.transaction };
}

async function voidBill(id, userId) {
  const bill = await getBillWithLineItems(id);
  if (!bill) {
    return { errors: ['Bill not found'] };
  }

  if (bill.status === 'PAID') {
    return { errors: ['Cannot void a paid bill'] };
  }

  if (bill.status === 'VOID') {
    return { errors: ['Bill is already voided'] };
  }

  const apAccount = await db('accounts')
    .where({ code: '20000' })
    .where('is_active', true)
    .first();

  if (!apAccount) {
    return { errors: ['Accounts Payable account (20000) not found'] };
  }

  const result = await db.transaction(async (trx) => {
    // Set is_voided flag on the original transaction
    if (bill.created_transaction_id) {
      await trx('transactions')
        .where({ id: bill.created_transaction_id })
        .update({
          is_voided: true,
          updated_at: trx.fn.now(),
        });
    }

    const [updatedBill] = await trx('bills')
      .where({ id })
      .update({
        status: 'VOID',
        updated_at: trx.fn.now(),
      })
      .returning('*');

    return { bill: updatedBill };
  });

  const billWithLineItems = await getBillWithLineItems(id);
  return { bill: billWithLineItems, transaction: null };
}

async function getAgingReport(asOfDate = new Date()) {
  const asOf = new Date(asOfDate);
  
  const bills = await db('bills as b')
    .join('contacts as c', 'c.id', 'b.contact_id')
    .where('b.status', 'UNPAID')
    .select(
      'b.id',
      'b.contact_id',
      'c.name as vendor_name',
      'b.bill_number',
      'b.description',
      'b.amount',
      'b.amount_paid',
      'b.due_date',
    );

  const aging = {
    current: [],
    days31_60: [],
    days61_90: [],
    days90_plus: [],
  };

  const today = new Date(asOf).setHours(0, 0, 0, 0);

  bills.forEach(bill => {
    const dueDate = new Date(bill.due_date).setHours(0, 0, 0, 0);
    const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
    const outstanding = parseFloat(dec(bill.amount).minus(dec(bill.amount_paid)).toFixed(2));

    const billData = {
      ...bill,
      amount: parseFloat(bill.amount),
      amount_paid: parseFloat(bill.amount_paid),
      outstanding,
      days_overdue: daysOverdue,
    };

    if (daysOverdue <= 30) {
      aging.current.push(billData);
    } else if (daysOverdue <= 60) {
      aging.days31_60.push(billData);
    } else if (daysOverdue <= 90) {
      aging.days61_90.push(billData);
    } else {
      aging.days90_plus.push(billData);
    }
  });

  const byVendor = {};
  Object.entries(aging).forEach(([bucket, bucketBills]) => {
    bucketBills.forEach(bill => {
      if (!byVendor[bill.vendor_name]) {
        byVendor[bill.vendor_name] = {
          contact_id: bill.contact_id,
          current: 0,
          days31_60: 0,
          days61_90: 0,
          days90_plus: 0,
          total: 0,
        };
      }
      byVendor[bill.vendor_name][bucket] += bill.outstanding;
      byVendor[bill.vendor_name].total += bill.outstanding;
    });
  });

  const vendorAging = Object.entries(byVendor).map(([name, data]) => ({
    vendor_name: name,
    contact_id: data.contact_id,
    current: parseFloat(data.current.toFixed(2)),
    days31_60: parseFloat(data.days31_60.toFixed(2)),
    days61_90: parseFloat(data.days61_90.toFixed(2)),
    days90_plus: parseFloat(data.days90_plus.toFixed(2)),
    total: parseFloat(data.total.toFixed(2)),
  }));

  const totals = {
    current: parseFloat(aging.current.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days31_60: parseFloat(aging.days31_60.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days61_90: parseFloat(aging.days61_90.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days90_plus: parseFloat(aging.days90_plus.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
  };
  totals.total = totals.current + totals.days31_60 + totals.days61_90 + totals.days90_plus;

  return {
    as_of_date: asOf.toISOString().split('T')[0],
    vendor_aging,
    totals,
    buckets: {
      current: aging.current,
      days31_60: aging.days31_60,
      days61_90: aging.days61_90,
      days90_plus: aging.days90_plus,
    },
  };
}

async function getUnpaidSummary() {
  const summary = await db('bills')
    .where('status', 'UNPAID')
    .select(
      db.raw('COUNT(*) as count'),
      db.raw('SUM(amount - amount_paid) as total_outstanding'),
      db.raw('MIN(due_date) as earliest_due'),
    )
    .first();

  return {
    count: parseInt(summary.count, 10),
    total_outstanding: parseFloat(dec(summary.total_outstanding ?? 0).toFixed(2)),
    earliest_due: summary.earliest_due,
  };
}

module.exports = {
  createBill,
  updateBill,
  payBill,
  voidBill,
  getAgingReport,
  getUnpaidSummary,
  getBillWithLineItems,
};