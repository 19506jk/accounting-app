import { describe, expect, it } from 'vitest';

import { buildFingerprint, normalizeDescription } from '../normalize.js';

describe('normalizeDescription', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeDescription('  E-Transfer: ACME, Inc.  #123  '))
      .toBe('e transfer acme inc 123');
  });

  it('keeps digits for matching while removing special symbols', () => {
    expect(normalizeDescription('POS*Store-42 / Ref: 0099'))
      .toBe('pos store 42 ref 0099');
  });
});

describe('buildFingerprint', () => {
  it('returns a stable sha256 hex digest', () => {
    const fingerprint = buildFingerprint('coffee shop', -10.5, '2026-04-01');
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes amount precision so 10.5 and 10.50 hash the same', () => {
    const left = buildFingerprint('coffee shop', 10.5, '2026-04-01');
    const right = buildFingerprint('coffee shop', 10.50, '2026-04-01');
    expect(left).toBe(right);
  });

  it('changes when any input component changes', () => {
    const base = buildFingerprint('coffee shop', 10.5, '2026-04-01');
    const differentDesc = buildFingerprint('coffee', 10.5, '2026-04-01');
    const differentAmount = buildFingerprint('coffee shop', 11, '2026-04-01');
    const differentDate = buildFingerprint('coffee shop', 10.5, '2026-04-02');

    expect(base).not.toBe(differentDesc);
    expect(base).not.toBe(differentAmount);
    expect(base).not.toBe(differentDate);
  });
});
