import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  ApiErrorResponse,
  ApiValidationErrorResponse,
  BulkReceiptsResponse,
  ContactDetail,
  ContactDonationsResponse,
  ContactDonationsSummaryResponse,
  ContactReceiptResponse,
  ContactResponse,
  ContactsListResponse,
  ContactsQuery,
  CreateContactInput,
  MessageResponse,
  UpdateContactInput,
} from '../../shared/contracts';
import type {
  ContactDonationRow,
  ContactDonationSummaryRow,
  ContactRow,
} from '../types/db';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();
router.use(auth);

const VALID_PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];

const DONOR_TYPES = ['DONOR', 'BOTH'];

function isDonorType(type: string | null | undefined) {
  return DONOR_TYPES.includes(String(type || '').toUpperCase());
}

function normalisePostalCode(raw: string | null | undefined) {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, '').toUpperCase();
  if (cleaned.length === 6) return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
  return raw.toUpperCase().trim();
}

function validateContact(body: CreateContactInput | UpdateContactInput, isPatch = false, existingType: string | null = null) {
  const errors: string[] = [];

  if (!isPatch) {
    if (!body.type) errors.push('type is required');
    if (!body.contact_class) errors.push('contact_class is required');
    if (!body.name?.trim()) errors.push('name is required');
  }

  if (body.type && !['DONOR', 'PAYEE', 'BOTH'].includes(body.type.toUpperCase())) {
    errors.push('type must be DONOR, PAYEE, or BOTH');
  }

  if (body.contact_class && !['INDIVIDUAL', 'HOUSEHOLD'].includes(body.contact_class.toUpperCase())) {
    errors.push('contact_class must be INDIVIDUAL or HOUSEHOLD');
  }

  if (body.province && !VALID_PROVINCES.includes(body.province.toUpperCase())) {
    errors.push('province must be a valid Canadian province/territory code');
  }

  const effectiveType = body.type?.toUpperCase() || existingType?.toUpperCase();

  if (isDonorType(effectiveType) && !body.donor_id?.trim()) {
    errors.push('donor_id is required for contacts of type DONOR or BOTH');
  }

  return errors;
}

router.get(
  '/',
  async (
    req: Request<{}, ContactsListResponse, unknown, ContactsQuery>,
    res: Response<ContactsListResponse>,
    next: NextFunction
  ) => {
    try {
      const { type, class: contactClass, search, include_inactive } = req.query;

      const query = db('contacts')
        .select(
          'id', 'type', 'contact_class', 'name', 'first_name', 'last_name',
          'email', 'phone', 'city', 'province', 'postal_code',
          'donor_id', 'is_active', 'created_at'
        )
        .orderBy('name', 'asc');

      if (String(include_inactive) !== 'true') {
        query.where('is_active', true);
      }

      if (type) {
        query.where(function byType(this: any) {
          this.where('type', type.toUpperCase()).orWhere('type', 'BOTH');
        });
      }

      if (contactClass) query.where('contact_class', contactClass.toUpperCase());

      if (search?.trim()) {
        const term = `%${search.trim().toLowerCase()}%`;
        query.where(function bySearch(this: any) {
          this.whereRaw('LOWER(name) LIKE ?', [term])
            .orWhereRaw('LOWER(first_name) LIKE ?', [term])
            .orWhereRaw('LOWER(last_name) LIKE ?', [term])
            .orWhereRaw('LOWER(email) LIKE ?', [term])
            .orWhereRaw('LOWER(donor_id) LIKE ?', [term]);
        });
      }

      const contacts = await query as ContactRow[];
      res.json({ contacts });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  async (
    req: Request<{ id: string }>,
    res: Response<ContactResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const contact = await db('contacts').where({ id: req.params.id }).first() as ContactRow | undefined;
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      res.json({ contact: contact as ContactDetail });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, ContactResponse | ApiErrorResponse | ApiValidationErrorResponse, CreateContactInput>,
    res: Response<ContactResponse | ApiErrorResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const errors = validateContact(req.body);
      if (errors.length) return res.status(400).json({ errors });

      const {
        type, contact_class, name, first_name, last_name,
        email, phone, address_line1, address_line2,
        city, province, postal_code, notes, donor_id,
      } = req.body;

      const normalisedPostal = normalisePostalCode(postal_code);

      if (name && normalisedPostal) {
        const duplicate = await db('contacts')
          .whereRaw('LOWER(name) = LOWER(?)', [name.trim()])
          .where('postal_code', normalisedPostal)
          .first() as ContactRow | undefined;

        if (duplicate) {
          return res.status(409).json({
            error: 'A contact with this name and postal code already exists',
            existing: { id: duplicate.id, name: duplicate.name },
          } as ApiErrorResponse & { existing: { id: number; name: string } });
        }
      }

      if (donor_id?.trim()) {
        const existingDonorId = await db('contacts')
          .whereRaw('LOWER(donor_id) = LOWER(?)', [donor_id.trim()])
          .first() as ContactRow | undefined;

        if (existingDonorId) {
          return res.status(409).json({
            error: `Donor ID "${donor_id.trim()}" is already in use by another contact`,
          });
        }
      }

      const [contact] = await db('contacts').insert({
        type: type.toUpperCase(),
        contact_class: contact_class.toUpperCase(),
        name: name.trim(),
        first_name: first_name?.trim() || null,
        last_name: last_name?.trim() || null,
        email: email?.trim() || null,
        phone: phone?.trim() || null,
        address_line1: address_line1?.trim() || null,
        address_line2: address_line2?.trim() || null,
        city: city?.trim() || null,
        province: province?.toUpperCase() || null,
        postal_code: normalisedPostal,
        notes: notes?.trim() || null,
        donor_id: donor_id?.trim() || null,
        is_active: true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      }).returning('*') as ContactRow[];

      res.status(201).json({ contact: contact as ContactDetail });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, ContactResponse | ApiErrorResponse | ApiValidationErrorResponse, UpdateContactInput>,
    res: Response<ContactResponse | ApiErrorResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const contact = await db('contacts').where({ id }).first() as ContactRow | undefined;
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      const errors = validateContact(req.body, true, contact.type);
      if (errors.length) return res.status(400).json({ errors });

      const {
        type, contact_class, name, first_name, last_name,
        email, phone, address_line1, address_line2,
        city, province, postal_code, notes, is_active, donor_id,
      } = req.body;

      const normalisedPostal = postal_code ? normalisePostalCode(postal_code) : contact.postal_code;

      const incomingDonorId = donor_id !== undefined ? donor_id?.trim() || null : contact.donor_id;
      if (incomingDonorId && incomingDonorId !== contact.donor_id) {
        const existingDonorId = await db('contacts')
          .whereRaw('LOWER(donor_id) = LOWER(?)', [incomingDonorId])
          .whereNot({ id })
          .first() as ContactRow | undefined;

        if (existingDonorId) {
          return res.status(409).json({
            error: `Donor ID "${incomingDonorId}" is already in use by another contact`,
          });
        }
      }

      const [updated] = await db('contacts').where({ id }).update({
        type: type ? type.toUpperCase() : contact.type,
        contact_class: contact_class ? contact_class.toUpperCase() : contact.contact_class,
        name: name?.trim() || contact.name,
        first_name: first_name !== undefined ? first_name?.trim() || null : contact.first_name,
        last_name: last_name !== undefined ? last_name?.trim() || null : contact.last_name,
        email: email !== undefined ? email?.trim() || null : contact.email,
        phone: phone !== undefined ? phone?.trim() || null : contact.phone,
        address_line1: address_line1 !== undefined ? address_line1?.trim() || null : contact.address_line1,
        address_line2: address_line2 !== undefined ? address_line2?.trim() || null : contact.address_line2,
        city: city !== undefined ? city?.trim() || null : contact.city,
        province: province !== undefined ? province?.toUpperCase() || null : contact.province,
        postal_code: normalisedPostal,
        notes: notes !== undefined ? notes?.trim() || null : contact.notes,
        donor_id: donor_id !== undefined ? donor_id?.trim() || null : contact.donor_id,
        is_active: is_active !== undefined ? is_active : contact.is_active,
        updated_at: db.fn.now(),
      }).returning('*') as ContactRow[];

      res.json({ contact: updated as ContactDetail });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<MessageResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const contact = await db('contacts').where({ id }).first() as ContactRow | undefined;
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      const jeCount = await db('journal_entries')
        .where({ contact_id: id })
        .count('id as count')
        .first() as { count: string } | undefined;

      if (parseInt(jeCount?.count || '0', 10) > 0) {
        return res.status(409).json({
          error: 'Cannot delete — contact is linked to transactions. Deactivate instead.',
        });
      }

      await db('contacts').where({ id }).update({ is_active: false, updated_at: db.fn.now() });
      res.json({ message: 'Contact deactivated successfully' });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/donations',
  async (
    req: Request<{ id: string }, ContactDonationsResponse | ApiErrorResponse, unknown, { year?: string }>,
    res: Response<ContactDonationsResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { year } = req.query;

      const contact = await db('contacts').where({ id }).first() as ContactRow | undefined;
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      const query = db('journal_entries as je')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .join('accounts as a', 'a.id', 'je.account_id')
        .join('funds as f', 'f.id', 'je.fund_id')
        .where('je.contact_id', id)
        .where('a.type', 'INCOME')
        .where('je.credit', '>', 0)
        .select(
          't.id as transaction_id', 't.date', 't.description', 't.reference_no',
          'a.name as account_name', 'a.code as account_code',
          'f.name as fund_name',
          'je.credit as amount', 'je.memo'
        )
        .orderBy('t.date', 'asc');

      if (year) query.whereRaw('EXTRACT(YEAR FROM t.date) = ?', [parseInt(year, 10)]);

      const donations = await query as ContactDonationRow[];

      res.json({
        contact: { id: contact.id, name: contact.name, donor_id: contact.donor_id },
        donations: donations.map((d) => ({ ...d, date: String(d.date), amount: parseFloat(String(d.amount)) })),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/donations/summary',
  async (
    req: Request<{ id: string }>,
    res: Response<ContactDonationsSummaryResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const contact = await db('contacts').where({ id }).first() as ContactRow | undefined;
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      const summary = await db('journal_entries as je')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .join('accounts as a', 'a.id', 'je.account_id')
        .where('je.contact_id', id)
        .where('a.type', 'INCOME')
        .where('je.credit', '>', 0)
        .select(db.raw('EXTRACT(YEAR FROM t.date)::integer AS year'))
        .sum('je.credit as total')
        .count('t.id as donation_count')
        .groupByRaw('EXTRACT(YEAR FROM t.date)')
        .orderBy('year', 'desc') as ContactDonationSummaryRow[];

      res.json({
        contact: { id: contact.id, name: contact.name, donor_id: contact.donor_id },
        summary: summary.map((s) => ({
          year: s.year,
          total: parseFloat(String(s.total)),
          donation_count: parseInt(String(s.donation_count), 10),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/receipt',
  async (
    req: Request<{ id: string }, ContactReceiptResponse | ApiErrorResponse, unknown, { year?: string }>,
    res: Response<ContactReceiptResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { year } = req.query;
      if (!year) return res.status(400).json({ error: 'year query parameter is required' });

      const yearInt = parseInt(year, 10);
      const contact = await db('contacts').where({ id }).first() as ContactRow | undefined;
      if (!contact) return res.status(404).json({ error: 'Contact not found' });

      const settingRows = await db('settings') as Array<{ key: string; value: string }>;
      const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));

      const donations = await db('journal_entries as je')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .join('accounts as a', 'a.id', 'je.account_id')
        .where('je.contact_id', id)
        .where('a.type', 'INCOME')
        .where('je.credit', '>', 0)
        .whereRaw('EXTRACT(YEAR FROM t.date) = ?', [yearInt])
        .select(
          't.date', 't.description', 't.reference_no',
          'a.name as account_name', 'je.credit as amount', 'je.memo'
        )
        .orderBy('t.date', 'asc') as Array<{
          date: string | Date;
          description: string;
          reference_no: string | null;
          account_name: string;
          amount: string | number;
          memo: string | null;
        }>;

      const total = donations.reduce((sum, d) => sum + parseFloat(String(d.amount)), 0);

      res.json({
        receipt: {
          church: {
            name: settings.church_name || '',
            address_line1: settings.church_address_line1 || '',
            address_line2: settings.church_address_line2 || '',
            city: settings.church_city || '',
            province: settings.church_province || '',
            postal_code: settings.church_postal_code || '',
            phone: settings.church_phone || '',
            email: settings.church_email || '',
            registration_no: settings.church_registration_no || '',
            signature_url: settings.church_signature_url || '',
          },
          donor: {
            name: contact.name,
            first_name: contact.first_name,
            last_name: contact.last_name,
            donor_id: contact.donor_id,
            address_line1: contact.address_line1,
            address_line2: contact.address_line2,
            city: contact.city,
            province: contact.province,
            postal_code: contact.postal_code,
          },
          year: yearInt,
          generated_at: new Date().toISOString(),
          donations: donations.map((d) => ({ ...d, date: String(d.date), amount: parseFloat(String(d.amount)) })),
          total: parseFloat(total.toFixed(2)),
          eligible_amount: parseFloat(total.toFixed(2)),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/receipts/bulk',
  requireRole('admin'),
  async (
    req: Request<{}, BulkReceiptsResponse | ApiErrorResponse, unknown, { year?: string }>,
    res: Response<BulkReceiptsResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { year } = req.query;
      if (!year) return res.status(400).json({ error: 'year query parameter is required' });
      const yearInt = parseInt(year, 10);

      const donorIds = await db('journal_entries as je')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .join('accounts as a', 'a.id', 'je.account_id')
        .whereNotNull('je.contact_id')
        .where('a.type', 'INCOME')
        .where('je.credit', '>', 0)
        .whereRaw('EXTRACT(YEAR FROM t.date) = ?', [yearInt])
        .distinct('je.contact_id as id') as Array<{ id: number }>;

      const settingRows = await db('settings') as Array<{ key: string; value: string }>;
      const settings = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));

      const receipts = await Promise.all(
        donorIds.map(async ({ id }) => {
          const contact = await db('contacts').where({ id }).first() as ContactRow;
          const donations = await db('journal_entries as je')
            .join('transactions as t', 't.id', 'je.transaction_id')
            .join('accounts as a', 'a.id', 'je.account_id')
            .where('je.contact_id', id)
            .where('a.type', 'INCOME')
            .where('je.credit', '>', 0)
            .whereRaw('EXTRACT(YEAR FROM t.date) = ?', [yearInt])
            .select('t.date', 't.description', 'a.name as account_name', 'je.credit as amount')
            .orderBy('t.date', 'asc') as Array<{ date: string | Date; description: string; account_name: string; amount: string | number }>;

          const total = donations.reduce((sum, d) => sum + parseFloat(String(d.amount)), 0);
          return {
            donor: contact,
            year: yearInt,
            donations: donations.map((d) => ({ ...d, date: String(d.date), amount: parseFloat(String(d.amount)) })),
            total: parseFloat(total.toFixed(2)),
            eligible_amount: parseFloat(total.toFixed(2)),
          };
        })
      );

      res.json({
        year: yearInt,
        church: {
          name: settings.church_name || '',
          address_line1: settings.church_address_line1 || '',
          city: settings.church_city || '',
          province: settings.church_province || '',
          postal_code: settings.church_postal_code || '',
          registration_no: settings.church_registration_no || '',
          signature_url: settings.church_signature_url || '',
        },
        count: receipts.length,
        receipts,
      });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
