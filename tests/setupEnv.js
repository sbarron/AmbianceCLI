// Ensure test environment variables are loaded from .env.test.local if present
// This runs before each test file (configured via jest.setupFiles)
try {
  const path = require('path');
  const fs = require('fs');
  const dotenv = require('dotenv');

  const envPath = path.resolve(process.cwd(), '.env.test.local');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    // Optional: log once for visibility in CI/local runs
    if (!process.env.JEST_DOTENV_SILENT) {
      // Keep this quiet by default; set JEST_DOTENV_SILENT=1 to silence
      // eslint-disable-next-line no-console
      console.log(`[jest] Loaded environment from ${envPath}`);
    }
  }
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[jest] Failed to load .env.test.local:', e && e.message);
}





