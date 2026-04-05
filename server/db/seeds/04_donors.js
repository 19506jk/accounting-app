/**
 * Seed — contacts
 *
 * Reads seeds/data/contacts.csv and inserts all rows into the contacts table.
 *
 * CSV headers expected:
 *   Display Name, First Name, Last Name, Company, Main Phone, Main Email,
 *   Address 1, City, Province, Postal Code
 *
 * Drop your parsed CSV at seeds/data/contacts.csv before running:
 *   knex seed:run --specific=seed_contacts.js
 */

const path = require('path');
const fs   = require('fs');

const CSV_PATH = path.join(__dirname, 'data', 'donors.csv');

/**
 * Detect whether a display name represents a household.
 * Households contain '&' or '/' (e.g. "John & Jane Smith", "John / Jane Smith").
 */
function isHousehold(displayName) {
  return /[&\/]/.test(displayName);
}

/**
 * Parse a raw CSV line respecting double-quoted fields.
 */
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

/**
 * Read and parse the CSV file into an array of objects.
 */
function readCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Normalize line endings and split
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

/**
 * Map a CSV row to a contacts DB record.
 */
function mapRow(row) {
  const displayName = row['Display Name']?.trim() ?? '';
  const household   = isHousehold(displayName);

  return {
    type:          'DONOR',
    contact_class: household ? 'HOUSEHOLD' : 'INDIVIDUAL',
    name:          displayName,

    // first_name / last_name only for individuals
    first_name: household ? null : (row['First Name']?.trim() || null),
    last_name:  household ? null : (row['Last Name']?.trim()  || null),

    // Company maps to donor_id
    donor_id: row['Company']?.trim() || null,

    email:    row['Main Email']?.trim() || null,
    phone:    row['Main Phone']?.trim() || null,

    address_line1: row['Address 1']?.trim()    || null,
    city:          row['City']?.trim()          || null,
    province:      row['Province']?.trim()      || null,
    postal_code:   row['Postal Code']?.trim()   || null,

    is_active: true,
  };
}

exports.seed = async function (knex) {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Contact CSV not found at: ${CSV_PATH}`);
  }

  const rows    = readCsv(CSV_PATH);
  const records = rows
    .filter(row => row['Display Name']?.trim())   // skip rows with no name
    .map(mapRow);

  if (records.length === 0) {
    console.log('No contact records found in CSV — nothing inserted.');
    return;
  }

  await knex('contacts').insert(records);
  console.log(`Seeded ${records.length} contact(s) from CSV.`);
};
