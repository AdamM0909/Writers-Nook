const { createApp } = require('./app');

const secret = process.env.SESSION_SECRET;
const adminPassword = process.env.ADMIN_PASSWORD || '';
if (process.env.NODE_ENV === 'production' && (!secret || !adminPassword)) {
  console.error('Set SESSION_SECRET and ADMIN_PASSWORD in production.');
  process.exit(1);
}
if (!adminPassword) console.warn('ADMIN_PASSWORD is not set: nobody will be able to edit or delete posts.');

// Turso (hosted) when TURSO_DATABASE_URL is set; otherwise a local SQLite file.
const tursoUrl = process.env.TURSO_DATABASE_URL;
if (tursoUrl && !process.env.TURSO_AUTH_TOKEN) {
  console.error('TURSO_DATABASE_URL is set but TURSO_AUTH_TOKEN is missing.');
  process.exit(1);
}
const app = createApp({
  dbUrl: tursoUrl || `file:${process.env.DB_PATH || 'nook.db'}`,
  dbAuthToken: process.env.TURSO_AUTH_TOKEN,
  secret,
  adminPassword,
});
console.log(tursoUrl ? 'Database: Turso' : 'Database: local file');
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Writer's Nook running on http://localhost:${port}`));
