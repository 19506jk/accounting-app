require('dotenv').config();

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');

const authRoutes            = require('./routes/auth');
const userRoutes            = require('./routes/users');
const fundRoutes            = require('./routes/funds');
const accountRoutes         = require('./routes/accounts');
const contactRoutes         = require('./routes/contacts');
const settingRoutes         = require('./routes/settings');
const transactionRoutes     = require('./routes/transactions');
const reconciliationRoutes  = require('./routes/reconciliation');
const reportRoutes          = require('./routes/reports');
const billRoutes            = require('./routes/bills');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security & parsing middleware ────────────────────────────────────────────
app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "https://accounts.google.com"],
      "frame-src": ["'self'", "https://accounts.google.com"],
      "connect-src": ["'self'", "https://accounts.google.com"],
    },
  },
}));
app.use(cors({
  origin: [
    process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    'https://openclaw.tail8f0744.ts.net'
  ],
  credentials: true,
}));
app.use(express.json());

// ── Health check (unauthenticated) ───────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',            authRoutes);
app.use('/api/users',           userRoutes);
app.use('/api/funds',           fundRoutes);
app.use('/api/accounts',        accountRoutes);
app.use('/api/contacts',        contactRoutes);
app.use('/api/settings',        settingRoutes);
app.use('/api/transactions',    transactionRoutes);
app.use('/api/reconciliations', reconciliationRoutes);
app.use('/api/reports',         reportRoutes);
app.use('/api/bills',           billRoutes);

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status  = err.status  || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`⛪  Church Accounting API running on port ${PORT}`);
});
