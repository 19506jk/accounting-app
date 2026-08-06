import dotenv from 'dotenv';
import { beforeEach, describe, expect, it } from 'vitest';

import { getTemplateHtml } from '../donationReceipts.js';
import {
  DEFAULT_HTML_TEMPLATE,
  LEGACY_DEFAULT_HTML_TEMPLATE_V0,
  LEGACY_DEFAULT_HTML_TEMPLATE_V1,
  prepareTemplate,
} from '../donationReceiptHtml.js';

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
  where(...args: unknown[]): FakeChain;
  whereNull(field?: string): FakeChain;
  first(): Promise<TemplateRow | undefined>;
  update(payload: Record<string, unknown>): Promise<number>;
}

/**
 * Scripted query builder: `first()` returns one queued row per call (the
 * initial read, then the refetch). `update()` returns the scripted row count
 * only when a conditional `html_body` predicate was applied (either the
 * legacy `WHERE html_body IS NULL` conversion guard or the upgrade's
 * `WHERE html_body = <old default>` guard) — otherwise it returns 1, so the
 * test fails if production code drops the conditional predicate and would
 * silently overwrite a concurrent save.
 */
function scriptedDb(options: { refetchRow?: TemplateRow; updateResult?: number }) {
  const state = {
    updateCount: 0,
    updatePayloads: [] as Record<string, unknown>[],
    whereNullFields: [] as Array<string | undefined>,
    whereValueFields: [] as string[],
  };

  const chain: FakeChain = {
    orderBy: () => chain,
    where: (...args: unknown[]) => {
      if (typeof args[0] === 'string' && typeof args[1] === 'string') {
        state.whereValueFields.push(args[0]);
      }
      return chain;
    },
    whereNull: (field?: string) => {
      state.whereNullFields.push(field);
      return chain;
    },
    first: () => Promise.resolve(options.refetchRow),
    update: (payload: Record<string, unknown>) => {
      state.updateCount += 1;
      state.updatePayloads.push(payload);
      const guarded =
        state.whereNullFields.some((field) => field === 'html_body') ||
        state.whereValueFields.some((field) => field === 'html_body');
      return Promise.resolve(guarded ? options.updateResult ?? 1 : 1);
    },
  };

  const db: FakeDb = () => chain;
  return { db, state };
}

const canonicalV0 = prepareTemplate(LEGACY_DEFAULT_HTML_TEMPLATE_V0).html;
const canonicalV1 = prepareTemplate(LEGACY_DEFAULT_HTML_TEMPLATE_V1).html;
const canonicalNewDefault = prepareTemplate(DEFAULT_HTML_TEMPLATE).html;

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

describe('historical default template upgrade', () => {
  function defaultRow(htmlBody: string): TemplateRow {
    return { id: 9, html_body: htmlBody, markdown_body: null, updated_at: '2026-01-01' };
  }

  it('upgrades a stored canonical v1 default to the two-signer default', async () => {
    const { db, state } = scriptedDb({ updateResult: 1 });

    const html = await getTemplateHtml(defaultRow(canonicalV1), db as never);

    expect(html).toBe(canonicalNewDefault);
    expect(state.updateCount).toBe(1);
    expect(state.updatePayloads[0]?.html_body).toBe(canonicalNewDefault);
    // The update must still match the previously read value; without the
    // conditional predicate the fake returns 1 and the guard assertion fails.
    expect(state.whereValueFields).toContain('html_body');
  });

  it('upgrades a stored canonical v0 default as well', async () => {
    const { db, state } = scriptedDb({ updateResult: 1 });

    const html = await getTemplateHtml(defaultRow(canonicalV0), db as never);

    expect(html).toBe(canonicalNewDefault);
    expect(state.updateCount).toBe(1);
  });

  it('never matches the raw authored literals', async () => {
    const { db, state } = scriptedDb({});

    const html = await getTemplateHtml(defaultRow(LEGACY_DEFAULT_HTML_TEMPLATE_V1), db as never);

    expect(html).toBe(LEGACY_DEFAULT_HTML_TEMPLATE_V1);
    expect(state.updateCount).toBe(0);
  });

  it('leaves customized templates untouched', async () => {
    const custom = '<p>Customized receipt</p>';
    const { db, state } = scriptedDb({});

    const html = await getTemplateHtml(defaultRow(custom), db as never);

    expect(html).toBe(custom);
    expect(state.updateCount).toBe(0);
  });

  it('is idempotent once the new default is stored', async () => {
    const { db, state } = scriptedDb({});

    const html = await getTemplateHtml(defaultRow(canonicalNewDefault), db as never);

    expect(html).toBe(canonicalNewDefault);
    expect(state.updateCount).toBe(0);
  });

  it('uses a concurrently saved template when the conditional upgrade affects no rows', async () => {
    const concurrent = '<p>Concurrent customization</p>';
    const { db, state } = scriptedDb({
      refetchRow: defaultRow(concurrent),
      updateResult: 0,
    });

    const html = await getTemplateHtml(defaultRow(canonicalV1), db as never);

    expect(html).toBe(concurrent);
    expect(state.updateCount).toBe(1);
    expect(state.whereValueFields).toContain('html_body');
  });
});
