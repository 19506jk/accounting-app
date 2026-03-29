/**
 * requireRole(...roles)
 *
 * Factory that returns a middleware enforcing role-based access.
 * Must be used AFTER the auth middleware (needs req.user).
 *
 * Usage:
 *   router.delete('/:id', auth, requireRole('admin'), handler)
 *   router.post('/',      auth, requireRole('admin', 'editor'), handler)
 *
 * Role hierarchy:
 *   admin  — full access
 *   editor — read + write, no user management or deletes
 *   viewer — read only
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      // auth middleware should have caught this — defensive check
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied — requires role: ${roles.join(' or ')}`,
      });
    }

    next();
  };
}

module.exports = requireRole;
