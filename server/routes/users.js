const express     = require('express');
const db          = require('../db');
const auth        = require('../middleware/auth');
const requireRole = require('../middleware/roles');

const router = express.Router();

// All user management routes require authentication
router.use(auth);

/**
 * POST /api/users
 * Admin only — pre-register a user by email + role.
 *
 * Creates a placeholder row with email and role.
 * When they first sign in with Google, auth.js matches on email,
 * fills in their google_id, name, and avatar_url, and lets them in.
 *
 * Body: { email, role }
 */
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).json({ error: 'email and role are required' });
    }

    const validRoles = ['admin', 'editor', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      });
    }

    // Check for duplicate email
    const existing = await db('users').where({ email }).first();
    if (existing) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const [newUser] = await db('users')
      .insert({
        email,
        role,
        // google_id, name, avatar_url filled in on first Google sign-in
        google_id:  null,
        name:       email, // placeholder until they sign in
        is_active:  true,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('id', 'name', 'email', 'role', 'is_active', 'created_at');

    res.status(201).json({ user: newUser });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users
 * Admin only — list all users.
 */
router.get('/', requireRole('admin'), async (req, res, next) => {
  try {
    const users = await db('users')
      .select('id', 'name', 'email', 'avatar_url', 'role', 'is_active', 'created_at')
      .orderBy('created_at', 'asc');

    res.json({ users });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/users/:id/role
 * Admin only — change a user's role.
 *
 * Body: { role: 'admin' | 'editor' | 'viewer' }
 */
router.put('/:id/role', requireRole('admin'), async (req, res, next) => {
  try {
    const { id }   = req.params;
    const { role } = req.body;

    const validRoles = ['admin', 'editor', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      });
    }

    // Prevent admin from demoting themselves
    if (parseInt(id, 10) === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }

    const [updated] = await db('users')
      .where({ id })
      .update({ role, updated_at: db.fn.now() })
      .returning('id', 'name', 'email', 'role', 'is_active');

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/users/:id/active
 * Admin only — activate or deactivate a user.
 *
 * Body: { is_active: true | false }
 */
router.put('/:id/active', requireRole('admin'), async (req, res, next) => {
  try {
    const { id }        = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }

    // Prevent admin from deactivating themselves
    if (parseInt(id, 10) === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }

    const [updated] = await db('users')
      .where({ id })
      .update({ is_active, updated_at: db.fn.now() })
      .returning('id', 'name', 'email', 'role', 'is_active');

    if (!updated) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/users/:id
 * Admin only — permanently remove a user.
 *
 * Cannot delete yourself.
 * Cannot delete a user who has created transactions (audit trail must be preserved).
 */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (parseInt(id, 10) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const user = await db('users').where({ id }).first();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has created any transactions — preserve audit trail
    const txCount = await db('transactions')
      .where({ created_by: id })
      .count('id as count')
      .first();

    if (parseInt(txCount.count, 10) > 0) {
      return res.status(409).json({
        error: 'Cannot delete a user who has recorded transactions. Deactivate them instead.',
      });
    }

    await db('users').where({ id }).delete();

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
