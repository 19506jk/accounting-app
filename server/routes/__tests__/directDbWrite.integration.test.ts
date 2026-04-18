import dotenv from 'dotenv';
import type { Router } from 'express';
import type { Knex } from 'knex';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requestMountedRoute } from '../routeTestHelpers.js';

process.env.NODE_ENV = 'development';

dotenv.config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret';

const db = require('../../db') as Knex;

const createdTransactionIds: number[] = [];
const createdFundIds: number[] = [];
const createdAccountIds: number[] = [];

let accountsRouter: Router;
let fundsRouter: Router;

beforeAll(async () => {
  await db.raw('select 1');

  const [accountsModule, fundsModule] = await Promise.all([
    import('../accounts.js'),
    import('../funds.js'),
  ]);

  accountsRouter = accountsModule.default as unknown as Router;
  fundsRouter = fundsModule.default as unknown as Router;
});

afterEach(async () => {
  if (createdTransactionIds.length > 0) {
    await db('transactions').whereIn('id', createdTransactionIds).delete();
    createdTransactionIds.length = 0;
  }

  if (createdFundIds.length > 0) {
    await db('funds').whereIn('id', createdFundIds).delete();
    createdFundIds.length = 0;
  }

  if (createdAccountIds.length > 0) {
    await db('accounts').whereIn('id', createdAccountIds).delete();
    createdAccountIds.length = 0;
  }
});

async function requestRoute({
  mountPath,
  probePath,
  method,
  router,
  role = 'admin',
  body,
}: {
  mountPath: string;
  probePath: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  router: Router;
  role?: 'admin' | 'editor' | 'viewer';
  body?: unknown;
}) {
  return requestMountedRoute({
    mountPath,
    probePath,
    method,
    router,
    role,
    body,
  });
}

function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function createTransaction({
  date,
  description,
  fundId,
  entries,
}: {
  date: string;
  description: string;
  fundId: number;
  entries: Array<{
    account_id: number;
    fund_id: number;
    debit: string;
    credit: string;
    memo?: string;
  }>;
}) {
  const [transaction] = await db('transactions')
    .insert({
      date,
      description,
      reference_no: null,
      fund_id: fundId,
      created_by: null,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning('*') as Array<{ id: number }>;
  if (!transaction) throw new Error('Failed to create route write transaction fixture');
  createdTransactionIds.push(transaction.id);

  await db('journal_entries').insert(entries.map((entry) => ({
    ...entry,
    transaction_id: transaction.id,
    is_reconciled: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  })));

  return transaction.id;
}

describe('direct DB route write integration smoke checks', () => {
  it('creates an account using the development database', async () => {
    const suffix = uniqueSuffix();
    const payload = {
      code: `ITA-${suffix}`,
      name: `Integration Account ${suffix}`,
      type: 'EXPENSE',
    };

    const res = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: payload,
    });

    expect(res.status).toBe(201);
    expect(res.body.account).toEqual(expect.objectContaining({
      id: expect.any(Number),
      code: payload.code,
      name: payload.name,
      type: 'EXPENSE',
      account_class: 'EXPENSE',
      normal_balance: null,
      is_active: true,
    }));

    createdAccountIds.push(res.body.account.id);
  });

  it('lists inactive accounts only when include_inactive is true', async () => {
    const suffix = uniqueSuffix();
    const active = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {
        code: `ITL-A-${suffix}`,
        name: `Listed Active Account ${suffix}`,
        type: 'EXPENSE',
      },
    });
    const inactive = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {
        code: `ITL-I-${suffix}`,
        name: `Listed Inactive Account ${suffix}`,
        type: 'EXPENSE',
      },
    });
    expect(active.status).toBe(201);
    expect(inactive.status).toBe(201);
    createdAccountIds.push(active.body.account.id, inactive.body.account.id);

    const deactivated = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${inactive.body.account.id}`,
      method: 'PUT',
      router: accountsRouter,
      role: 'editor',
      body: { is_active: false },
    });
    expect(deactivated.status).toBe(200);

    const defaultList = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/?type=EXPENSE`,
      method: 'GET',
      router: accountsRouter,
      role: 'viewer',
    });
    expect(defaultList.status).toBe(200);
    expect(defaultList.body.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: active.body.account.id, is_active: true }),
    ]));
    expect(defaultList.body.accounts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: inactive.body.account.id }),
    ]));

    const inactiveList = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/?type=EXPENSE&include_inactive=true`,
      method: 'GET',
      router: accountsRouter,
      role: 'viewer',
    });
    expect(inactiveList.status).toBe(200);
    expect(inactiveList.body.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: inactive.body.account.id, is_active: false }),
    ]));
  });

  it('creates a fund and linked equity account using the development database', async () => {
    const suffix = uniqueSuffix();
    const payload = {
      name: `Integration Fund ${suffix}`,
      description: 'Integration test temporary fund',
      code: `ITF-${suffix}`,
    };

    const res = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'editor',
      body: payload,
    });

    expect(res.status).toBe(201);
    expect(res.body.fund).toEqual(expect.objectContaining({
      id: expect.any(Number),
      name: payload.name,
      description: payload.description,
      is_active: true,
      net_asset_account_id: expect.any(Number),
    }));
    expect(res.body.equityAccount).toEqual(expect.objectContaining({
      id: expect.any(Number),
      code: payload.code,
      type: 'EQUITY',
      is_active: true,
    }));

    createdFundIds.push(res.body.fund.id);
    createdAccountIds.push(res.body.equityAccount.id);
  });

  it('updates an account and reads it back by id using the development database', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      code: `ITU-A-${suffix}`,
      name: `Update Account ${suffix}`,
      type: 'EXPENSE',
    };

    const created = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    const accountId = created.body.account.id as number;
    createdAccountIds.push(accountId);

    const updatePayload = {
      code: `ITU-A2-${suffix}`,
      name: `Updated Account ${suffix}`,
      type: 'EXPENSE',
      is_active: false,
    };

    const updated = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${accountId}`,
      method: 'PUT',
      router: accountsRouter,
      role: 'editor',
      body: updatePayload,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.account).toEqual(expect.objectContaining({
      id: accountId,
      code: updatePayload.code,
      name: updatePayload.name,
      type: 'EXPENSE',
      is_active: false,
    }));

    const found = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${accountId}`,
      method: 'GET',
      router: accountsRouter,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.account).toEqual(expect.objectContaining({
      id: accountId,
      code: updatePayload.code,
      name: updatePayload.name,
      is_active: false,
    }));
  });

  it('preserves provided normal balance on create and clears it with null on update', async () => {
    const suffix = uniqueSuffix();
    const created = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {
        code: `ITNB-${suffix}`,
        name: `Normal Balance Account ${suffix}`,
        type: 'ASSET',
        normal_balance: 'debit',
      },
    });

    expect(created.status).toBe(201);
    const accountId = created.body.account.id as number;
    createdAccountIds.push(accountId);
    expect(created.body.account).toEqual(expect.objectContaining({
      id: accountId,
      normal_balance: 'DEBIT',
    }));

    const cleared = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${accountId}`,
      method: 'PUT',
      router: accountsRouter,
      role: 'editor',
      body: { normal_balance: null },
    });

    expect(cleared.status).toBe(200);
    expect(cleared.body.account).toEqual(expect.objectContaining({
      id: accountId,
      normal_balance: null,
    }));
  });

  it('updates a fund and linked equity account using the development database', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      name: `Update Fund ${suffix}`,
      description: 'Integration update test fund',
      code: `ITU-F-${suffix}`,
    };

    const created = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    const fundId = created.body.fund.id as number;
    const equityAccountId = created.body.equityAccount.id as number;
    createdFundIds.push(fundId);
    createdAccountIds.push(equityAccountId);

    const updatePayload = {
      name: `Updated Fund ${suffix}`,
      description: 'Updated integration fund description',
      code: `ITU-F2-${suffix}`,
      is_active: false,
    };

    const updated = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${fundId}`,
      method: 'PUT',
      router: fundsRouter,
      role: 'editor',
      body: updatePayload,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.fund).toEqual(expect.objectContaining({
      id: fundId,
      name: updatePayload.name,
      description: updatePayload.description,
      is_active: false,
      net_asset_account_id: equityAccountId,
    }));

    const linkedAccount = await db('accounts').where({ id: equityAccountId }).first() as {
      code: string;
      name: string;
      is_active: boolean;
    } | undefined;
    expect(linkedAccount).toEqual(expect.objectContaining({
      code: updatePayload.code,
      name: `${updatePayload.name} - Net Assets`,
      is_active: false,
    }));

    const found = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${fundId}`,
      method: 'GET',
      router: fundsRouter,
      role: 'viewer',
    });

    expect(found.status).toBe(200);
    expect(found.body.fund).toEqual(expect.objectContaining({
      id: fundId,
      name: updatePayload.name,
      net_asset_code: updatePayload.code,
      net_asset_name: `${updatePayload.name} - Net Assets`,
    }));
  });

  it('rejects account type changes when journal entry history exists', async () => {
    const suffix = uniqueSuffix();
    const created = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: {
        name: `Account History Fund ${suffix}`,
        description: 'Account history test fund',
        code: `ITHF-${suffix}`,
      },
    });
    expect(created.status).toBe(201);
    const fundId = created.body.fund.id as number;
    const equityAccountId = created.body.equityAccount.id as number;
    createdFundIds.push(fundId);
    createdAccountIds.push(equityAccountId);

    const expense = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {
        code: `ITHA-${suffix}`,
        name: `History Account ${suffix}`,
        type: 'EXPENSE',
      },
    });
    expect(expense.status).toBe(201);
    const expenseAccountId = expense.body.account.id as number;
    createdAccountIds.push(expenseAccountId);

    await createTransaction({
      date: '2026-04-01',
      description: `Account History Transaction ${suffix}`,
      fundId,
      entries: [
        {
          account_id: expenseAccountId,
          fund_id: fundId,
          debit: '5.00',
          credit: '0.00',
        },
        {
          account_id: equityAccountId,
          fund_id: fundId,
          debit: '0.00',
          credit: '5.00',
        },
      ],
    });

    const rejected = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${expenseAccountId}`,
      method: 'PUT',
      router: accountsRouter,
      role: 'editor',
      body: { type: 'ASSET' },
    });

    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({
      error: 'Cannot change account type — this account has transaction history.',
    });
  });

  it('deactivates an account through delete route when no transaction history exists', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      code: `ITD-A-${suffix}`,
      name: `Delete Account ${suffix}`,
      type: 'EXPENSE',
    };

    const created = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    const accountId = created.body.account.id as number;
    createdAccountIds.push(accountId);

    const deleted = await requestRoute({
      mountPath: '/api/accounts',
      probePath: `/${accountId}`,
      method: 'DELETE',
      router: accountsRouter,
      role: 'admin',
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'Account deactivated successfully' });

    const stored = await db('accounts').where({ id: accountId }).first() as { is_active: boolean } | undefined;
    expect(stored?.is_active).toBe(false);
  });

  it('deactivates a fund through delete route when balance and transaction history are zero', async () => {
    const suffix = uniqueSuffix();
    const createPayload = {
      name: `Delete Fund ${suffix}`,
      description: 'Integration delete test fund',
      code: `ITD-F-${suffix}`,
    };

    const created = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: createPayload,
    });

    expect(created.status).toBe(201);
    const fundId = created.body.fund.id as number;
    const equityAccountId = created.body.equityAccount.id as number;
    createdFundIds.push(fundId);
    createdAccountIds.push(equityAccountId);

    const deleted = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${fundId}`,
      method: 'DELETE',
      router: fundsRouter,
      role: 'admin',
    });

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ message: 'Fund deactivated successfully' });

    const stored = await db('funds').where({ id: fundId }).first() as { is_active: boolean } | undefined;
    expect(stored?.is_active).toBe(false);
  });

  it('rejects fund delete when transaction history exists', async () => {
    const suffix = uniqueSuffix();
    const created = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: {
        name: `History Fund ${suffix}`,
        description: 'Integration history delete test fund',
        code: `ITDH-${suffix}`,
      },
    });

    expect(created.status).toBe(201);
    const fundId = created.body.fund.id as number;
    const equityAccountId = created.body.equityAccount.id as number;
    createdFundIds.push(fundId);
    createdAccountIds.push(equityAccountId);

    const expense = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {
        code: `ITDHE-${suffix}`,
        name: `History Expense ${suffix}`,
        type: 'EXPENSE',
      },
    });
    expect(expense.status).toBe(201);
    const expenseAccountId = expense.body.account.id as number;
    createdAccountIds.push(expenseAccountId);

    await createTransaction({
      date: '2026-04-02',
      description: `Fund History Transaction ${suffix}`,
      fundId,
      entries: [
        {
          account_id: expenseAccountId,
          fund_id: fundId,
          debit: '7.00',
          credit: '0.00',
        },
        {
          account_id: equityAccountId,
          fund_id: fundId,
          debit: '0.00',
          credit: '7.00',
        },
      ],
    });

    const rejected = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${fundId}`,
      method: 'DELETE',
      router: fundsRouter,
      role: 'admin',
    });

    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({
      error: 'Fund has transaction history and cannot be deactivated. Set it to inactive manually if needed.',
    });
  });

  it('rejects fund delete when equity entries leave a non-zero balance', async () => {
    const suffix = uniqueSuffix();
    const target = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: {
        name: `Balance Fund ${suffix}`,
        description: 'Integration balance delete test fund',
        code: `ITDB-${suffix}`,
      },
    });
    const host = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: {
        name: `Balance Host Fund ${suffix}`,
        description: 'Integration balance host fund',
        code: `ITDBH-${suffix}`,
      },
    });

    expect(target.status).toBe(201);
    expect(host.status).toBe(201);
    const targetFundId = target.body.fund.id as number;
    const targetEquityAccountId = target.body.equityAccount.id as number;
    const hostFundId = host.body.fund.id as number;
    const hostEquityAccountId = host.body.equityAccount.id as number;
    createdFundIds.push(targetFundId, hostFundId);
    createdAccountIds.push(targetEquityAccountId, hostEquityAccountId);

    await createTransaction({
      date: '2026-04-03',
      description: `Fund Balance Transaction ${suffix}`,
      fundId: hostFundId,
      entries: [
        {
          account_id: hostEquityAccountId,
          fund_id: hostFundId,
          debit: '20.00',
          credit: '0.00',
        },
        {
          account_id: targetEquityAccountId,
          fund_id: targetFundId,
          debit: '0.00',
          credit: '20.00',
        },
      ],
    });

    const rejected = await requestRoute({
      mountPath: '/api/funds',
      probePath: `/${targetFundId}`,
      method: 'DELETE',
      router: fundsRouter,
      role: 'admin',
    });

    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({
      error: 'Fund still carries a balance of $20.00. Zero it out before deactivating.',
    });
  });

  it('rejects account create when required fields are missing', async () => {
    const rejected = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {},
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'code, name, and type are required' });
  });

  it('rejects duplicate account codes before inserting another account', async () => {
    const suffix = uniqueSuffix();
    const payload = {
      code: `ITDUP-${suffix}`,
      name: `Duplicate Account ${suffix}`,
      type: 'EXPENSE',
    };

    const created = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: payload,
    });

    expect(created.status).toBe(201);
    createdAccountIds.push(created.body.account.id);

    const duplicate = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/',
      method: 'POST',
      router: accountsRouter,
      role: 'admin',
      body: {
        ...payload,
        name: `Duplicate Account Retry ${suffix}`,
      },
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: `Account code ${payload.code} already exists` });

    const rows = await db('accounts').where({ code: payload.code });
    expect(rows).toHaveLength(1);
  });

  it('rejects fund create when required fields are missing', async () => {
    const rejected = await requestRoute({
      mountPath: '/api/funds',
      probePath: '/',
      method: 'POST',
      router: fundsRouter,
      role: 'admin',
      body: { code: `ITF-${uniqueSuffix()}` },
    });

    expect(rejected.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Fund name is required' });
  });

  it('rejects non-admin users before deleting an account', async () => {
    const forbidden = await requestRoute({
      mountPath: '/api/accounts',
      probePath: '/999999999',
      method: 'DELETE',
      router: accountsRouter,
      role: 'editor',
    });

    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'Access denied — requires role: admin' });
  });
});
