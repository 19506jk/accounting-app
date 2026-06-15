
/**
 * Migration 006 — make users.google_id nullable
 *
 * Required to support pre-registered users (added by admin before
 * they sign in with Google for the first time).
 * google_id is filled in automatically on their first Google sign-in.
 */
 
exports.up = function (knex) {
  return knex.schema.alterTable('users', (t) => {
    t.string('google_id').nullable().alter();
  });
};
 
exports.down = function (knex) {
  return knex('users')
    .whereNull('google_id')
    .count({ count: '*' })
    .first()
    .then((result) => {
      const nullUserCount = Number(result?.count || 0);

      if (nullUserCount > 0) {
        throw new Error(
          `Cannot rollback migration 006: ${nullUserCount} user(s) have NULL google_id values. ` +
          'Backfill those rows before restoring the NOT NULL constraint.'
        );
      }

	      return knex.schema.alterTable('users', (t) => {
	        t.string('google_id').notNullable().alter();
	      });
    });
};
