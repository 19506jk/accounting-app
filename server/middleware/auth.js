const jwt = require('jsonwebtoken');

/**
 * auth middleware
 *
 * Expects:  Authorization: Bearer <token>
 * Attaches: req.user = { id, email, role }
 *
 * Returns 401 if the token is missing, malformed, or expired.
 */
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id:   payload.id,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired — please sign in again' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = auth;
