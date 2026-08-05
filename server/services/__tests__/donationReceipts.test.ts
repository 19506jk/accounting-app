import dotenv from 'dotenv';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTemplateHtml } from '../donationReceipts.js';

// getTemplateHtml imports the real db module (a lazy knex pool; no connection
// is opened without a query). dotenv loads server/.env so the module's
// NODE_ENV=test guard is satisfied, matching the direct-DB integration tests.
dotenv.config();

type TemplateRow = {
  id: number;
  html_body: string | null;
  markdown_body: string | null;
  updated_at: string | Date;
};

interface FakeDb {
  (table: string): FakeChain;
}

interface FakeChain {
  orderBy(): FakeChain;
  where(): FakeChain;
  whereNull(field?: string): FakeChain;
  first(): Promise<TemplateRow | undefined>;
  update(payload: Record<string, unknown>): Promise<number>;
}

/**
 * Scripted query builder: `first()` returns one queued row per call (the
 * initial read, then the refetch). `update()` returns the scripted row count
 * only when the `WHERE html_body IS NULL` predicate was applied — otherwise
 * it returns 1, so the test fails if production code drops the conditional
 * predicate and the conversion would silently overwrite a concurrent save.
 */
function scriptedDb(options: { refetchRow?: TemplateRow; updateResult?: number }) {
  const state = {
    updateCount: 0,
    updatePayloads: [] as Record<string, unknown>[],
    whereNullFields: [] as Array<string | undefined>,
  };

  const chain: FakeChain = {
    orderBy: () => chain,
    where: () => chain,
    whereNull: (field?: string) => {
      state.whereNullFields.push(field);
      return chain;
    },
    first: () => Promise.resolve(options.refetchRow),
    update: (payload: Record<string, unknown>) => {
      state.updateCount += 1;
      state.updatePayloads.push(payload);
      const guarded = state.whereNullFields.some((field) => field === 'html_body');
      return Promise.resolve(guarded ? options.updateResult ?? 1 : 1);
    },
  };

  const db: FakeDb = () => chain;
  return { db, state };
}

describe('lazy template conversion race', () => {
  const legacyRow: TemplateRow = {
    id: 7,
    html_body: null,
    markdown_body: '# Legacy',
    updated_at: '2026-01-01',
  };

  beforeEach(() => {
    expect(process.env.DB_NAME_TEST).toBeTruthy();
  });

  it('uses a concurrently saved html_body when the conditional update affects no rows', async () => {
    const { db, state } = scriptedDb({
      refetchRow: { ...legacyRow, html_body: '<p>Concurrent save</p>' },
      updateResult: 0,
    });

    const html = await getTemplateHtml(legacyRow, db as never);

    // The conversion was attempted, but the zero-row result means a
    // concurrent writer had already stored html_body — its value must win.
    expect(html).toBe('<p>Concurrent save</p>');
    expect(state.updateCount).toBe(1);
    expect(state.updatePayloads[0]?.html_body).toContain('<h1>Legacy</h1>');
    // The conditional predicate must actually gate the update; without it the
    // fake returns 1 and this assertion (and the one above) would fail.
    expect(state.whereNullFields).toContain('html_body');
  });

  it('returns the converted html when the conditional update succeeds', async () => {
    const { db, state } = scriptedDb({ updateResult: 1 });

    const html = await getTemplateHtml(legacyRow, db as never);

    expect(html).toContain('<h1>Legacy</h1>');
    expect(state.updateCount).toBe(1);
    expect(state.updatePayloads[0]?.html_body).toContain('<h1>Legacy</h1>');
  });
});
