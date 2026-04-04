const express          = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt              = require('jsonwebtoken');
const db               = require('../db');
const auth             = require('../middleware/auth');

const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google
 *
 * Body: { credential: "<Google ID token>" }
 *
 * Flow:
 *  1. Verify the Google ID token
 *  2. Extract google_id, email, name, avatar_url
 *  3. Look up user by google_id
 *     → Found:              returning user, load their role
 *     → Not found by id,
 *       but found by email: pre-registered user — fill in their Google details
 *     → No users at all:    first ever user, auto-assign admin
 *     → Truly unknown:      403
 *  4. Return a signed app JWT (24h expiry)
 */
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Missing credential' });
    }

    // ── 1. Verify Google ID token ──────────────────────────────────────────
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken:  credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch {
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const payload = ticket.getPayload();
    const { sub: google_id, email, name, picture: avatar_url } = payload;

    // ── 2. Look up user by google_id first ────────────────────────────────
    let user = await db('users').where({ google_id }).first();

    if (!user) {
      // ── 3a. Check if pre-registered by email ──────────────────────────
      const preRegistered = await db('users').where({ email }).first();

      if (preRegistered) {
        // Fill in their Google details on first sign-in
        const [updated] = await db('users')
          .where({ id: preRegistered.id })
          .update({
            google_id,
            name,
            avatar_url,
            updated_at: db.fn.now(),
            is_active: true,
          })
          .returning('*');
        user = updated;
        console.log(`✅ Pre-registered user signed in: ${email} (${user.role})`);

      } else {
        // ── 3b. Check if this is the very first user ever ────────────────
        const [{ count }] = await db('users').count('id as count');
        const isFirstUser  = parseInt(count, 10) === 0;

        if (isFirstUser) {
          const [newUser] = await db('users')
            .insert({
              google_id,
              email,
              name,
              avatar_url,
              role:       'admin',
              is_active:  true,
              created_at: db.fn.now(),
              updated_at: db.fn.now(),
            })
            .returning('*');
          user = newUser;
          console.log(`🔑 First user registered as admin: ${email}`);

        } else {
          // ── 3c. Truly unknown — block access ──────────────────────────
          return res.status(403).json({
            error: 'Account not recognised. Contact your administrator to be added.',
          });
        }
      }
    }

    // ── 4. Check account is active ────────────────────────────────────────
    if (!user.is_active) {
      return res.status(403).json({
        error: 'Your account has been deactivated. Contact your administrator.',
      });
    }

    // ── 5. Refresh name/avatar in case they changed in Google ─────────────
    await db('users').where({ id: user.id }).update({
      name,
      avatar_url,
      updated_at: db.fn.now(),
    });

    // ── 6. Sign and return app JWT ────────────────────────────────────────
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({
      token,
      user: {
        id:         user.id,
        name:       user.name,
        email:      user.email,
        avatar_url: user.avatar_url,
        role:       user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user from the JWT.
 * Used by the frontend on page load to restore auth state.
 */
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await db('users')
      .where({ id: req.user.id })
      .select('id', 'name', 'email', 'avatar_url', 'role', 'is_active')
      .first();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
