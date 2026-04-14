import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { fileURLToPath } from 'url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import fundRoutes from './routes/funds.js';
import accountRoutes from './routes/accounts.js';
import contactRoutes from './routes/contacts.js';
import settingRoutes from './routes/settings.js';
import transactionRoutes from './routes/transactions.js';
import reconciliationRoutes from './routes/reconciliation.js';
import reportRoutes from './routes/reports.js';
import billRoutes from './routes/bills.js';
import taxRatesRouter from './routes/taxRates.js';
import fiscalPeriodRoutes from './routes/fiscalPeriods.js';
import donationReceiptRoutes from './routes/donationReceipts.js';
import { initializeChurchTimeZoneCache } from './services/churchTimeZone.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ['\'self\'', 'https://accounts.google.com'],
      'frame-src': ['\'self\'', 'https://accounts.google.com'],
      'connect-src': ['\'self\'', 'https://accounts.google.com'],
      'img-src': ['\'self\'', 'data:', 'https://lh3.googleusercontent.com'],
    },
  },
}));
app.use(cors({
  origin: [
    process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    'https://openclaw.tail8f0744.ts.net',
  ],
  credentials: true,
}));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/funds', fundRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/settings', settingRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/reconciliations', reconciliationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/tax-rates', taxRatesRouter);
app.use('/api/fiscal-periods', fiscalPeriodRoutes);
app.use('/api/donation-receipts', donationReceiptRoutes);

if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.resolve(__dirname, '../../client/dist');

  app.use(express.static(clientDistPath));

  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    }
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
});

async function start() {
  await initializeChurchTimeZoneCache();

  app.listen(PORT, () => {
    console.log(`Church Accounting API running on port ${PORT}`);
  });
}

void start();
