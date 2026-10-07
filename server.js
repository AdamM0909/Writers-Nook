const { createApp } = require('./app');

const secret = process.env.SESSION_SECRET;
if (!secret && process.env.NODE_ENV === 'production') {
  console.error('Set SESSION_SECRET in production.');
  process.exit(1);
}

const app = createApp({ dbPath: process.env.DB_PATH || 'nook.db', secret });
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Writer's Nook running on http://localhost:${port}`));
