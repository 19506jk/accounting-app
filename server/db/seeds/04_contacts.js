/**
 * Seed — contacts
 *
 * Reads seeds/data/contacts.csv and upserts rows into the contacts table.
 */

const path = require('path');
const fs = require('fs');

const CSV_PATH = path.join(__dirname, 'data', 'contacts.csv');

const TYPE_MAP = {
  donor: 'DONOR',
  payee: 'PAYEE',
  both: 'BOTH',
};

const VALID_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

function isHousehold(displayName) {
  return /[&/]/.test(displayName);
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current.trim());
  return fields;
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }

  return rows;
}

function mapRow(row) {
  const displayName = row['Display Name']?.trim() ?? '';
  const household = isHousehold(displayName);
  const rawType = (row.Type ?? '').trim().toLowerCase();
  const type = TYPE_MAP[rawType] ?? 'DONOR';
  const province = row.Province?.trim().toUpperCase() || null;

  return {
    type,
    contact_class: household ? 'HOUSEHOLD' : 'INDIVIDUAL',
    name: displayName,
    first_name: household ? null : row['First Name']?.trim() || null,
    last_name: household ? null : row['Last Name']?.trim() || null,
    donor_id: row.Company?.trim() || null,
    email: row['Main Email']?.trim() || null,
    phone: row['Main Phone']?.trim() || null,
    address_line1: row['Address 1']?.trim() || null,
    city: row.City?.trim() || null,
    province: VALID_PROVINCES.has(province) ? province : null,
    postal_code: row['Postal Code']?.trim() || null,
    is_active: true,
  };
}

exports.seed = async function seed(knex) {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Contact CSV not found at: ${CSV_PATH}`);
  }

  const rows = readCsv(CSV_PATH);
  const records = rows.filter((row) => row['Display Name']?.trim()).map(mapRow);

  if (records.length === 0) {
    console.log('No contact records found in CSV.');
    return;
  }

  let inserted = 0;
  let updated = 0;

  await knex.transaction(async (trx) => {
    for (const record of records) {
      let existing;

      if (record.donor_id) {
        existing = await trx('contacts').where({ donor_id: record.donor_id }).first();
      } else {
        existing = await trx('contacts')
          .where({ name: record.name })
          .andWhere((qb) => {
            if (record.email) {
              qb.where({ email: record.email });
            } else {
              qb.whereNull('email');
            }
          })
          .andWhere((qb) => {
            if (record.phone) {
              qb.where({ phone: record.phone });
            } else {
              qb.whereNull('phone');
            }
          })
          .first();
      }

      if (existing) {
        await trx('contacts').where({ id: existing.id }).update({
          ...record,
          updated_at: trx.fn.now(),
        });
        updated++;
      } else {
        await trx('contacts').insert({
          ...record,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
        inserted++;
      }
    }
  });

  console.log(`Contacts seed complete: ${inserted} inserted, ${updated} updated.`);
};
