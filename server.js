const { createApp } = require('./app');

const secret = process.env.SESSION_SECRET;
const adminPassword = process.env.ADMIN_PASSWORD || '';
if (process.env.NODE_ENV === 'production' && (!secret || !adminPassword)) {
  console.error('Set SESSION_SECRET and ADMIN_PASSWORD in production.');
  process.exit(1);
}
if (!adminPassword) console.warn('ADMIN_PASSWORD is not set: nobody will be able to edit or delete posts.');

const app = createApp({ dbPath: process.env.DB_PATH || 'nook.db', secret, adminPassword });
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Writer's Nook running on http://localhost:${port}`));
