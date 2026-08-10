import { start } from './src/server.js';

start().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
