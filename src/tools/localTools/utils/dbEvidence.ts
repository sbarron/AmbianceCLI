/**
 * @fileOverview: Database evidence detection utilities to prevent UI pollution
 * @module: DbEvidence
 * @keyFunctions:
 *   - collectDbEvidence(): Find database-related code patterns in file content
 *   - isServerishPath(): Check if path represents server-side code
 *   - dbInitializersForFile(): Get database initializers only for server files
 * @context: Prevents UI files from being incorrectly identified as database initializers
 */

import { isServerishPath } from './pathUtils';

export type Evidence = { file: string; line: number; match: string };

// Database import patterns
const DB_IMPORTS = [
  /from\s+['"]pg['"]/,
  /from\s+['"]postgres['"]/,
  /from\s+['"]@supabase\//,
  /from\s+['"]kysely['"]/,
  /from\s+['"]drizzle-orm['"]/,
  /from\s+['"]prisma['"]/,
  /from\s+['"]mysql2?['"]/,
  /from\s+['"]sqlite3?['"]/,
  /from\s+['"]mongodb?['"]/,
  /from\s+['"](?:io)?redis['"]/,
  /\bnew\s+Pool\s*\(/,
  /\bnew\s+Client\s*\(/,
  /\bnew\s+Database\s*\(/,
];

// Database environment variable patterns
const DB_ENV = [
  /process\.env\.DATABASE_URL\b/,
  /process\.env\.POSTGRES_URL\b/,
  /process\.env\.MYSQL_URL\b/,
  /process\.env\.MONGODB_URI\b/,
  /process\.env\.REDIS_URL\b/,
  /\bSUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY)\b/,
  /\bDB_HOST\b/,
  /\bDB_PORT\b/,
  /\bDB_NAME\b/,
  /\bDB_USER\b/,
  /\bDB_PASSWORD\b/,
];

// SQL usage patterns
const DB_SQL_TAG = /\bsql`/;
const DB_QUERY_PATTERNS = [
  /\.query\s*\(/,
  /\.execute\s*\(/,
  /\.run\s*\(/,
  /SELECT\s+.*FROM\s+/i,
  /INSERT\s+INTO\s+/i,
  /UPDATE\s+.*SET\s+/i,
  /DELETE\s+FROM\s+/i,
  /CREATE\s+TABLE\s+/i,
  /ALTER\s+TABLE\s+/i,
  /DROP\s+TABLE\s+/i,
];

/**
 * Collect database evidence from file content
 */
export function collectDbEvidence(text: string): Evidence[] {
  const evidence: Evidence[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const lineNumber = i + 1;
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
      return;
    }

    // Check database imports
    if (DB_IMPORTS.some(regex => regex.test(line))) {
      evidence.push({
        file: '',
        line: lineNumber,
        match: trimmedLine.slice(0, 160),
      });
      return;
    }

    // Check environment variables
    if (DB_ENV.some(regex => regex.test(line))) {
      evidence.push({
        file: '',
        line: lineNumber,
        match: trimmedLine.slice(0, 160),
      });
      return;
    }

    // Check SQL patterns
    if (DB_SQL_TAG.test(line) || DB_QUERY_PATTERNS.some(regex => regex.test(line))) {
      evidence.push({
        file: '',
        line: lineNumber,
        match: trimmedLine.slice(0, 160),
      });
      return;
    }
  });

  return evidence;
}

/**
 * Get database initializers for a file, but only if it's a server file with DB evidence
 * This prevents UI files from being incorrectly classified as database initializers
 */
export function dbInitializersForFile(posixPath: string, text: string): Evidence[] {
  // UI/client files cannot be DB initializers
  if (!isServerishPath(posixPath)) {
    return [];
  }

  // Must have actual database evidence
  const evidence = collectDbEvidence(text);
  if (evidence.length === 0) {
    return [];
  }

  // Extract initialization patterns
  const initPatterns = [
    /(?:async\s+)?function\s+(\w*(?:init|connect|setup|bootstrap|create.*(?:connection|pool|client))\w*)/gi,
    /(?:const|let|var)\s+(\w*(?:init|connect|setup|bootstrap|create.*(?:connection|pool|client))\w*)\s*=/gi,
    /(\w+)\s*:\s*(?:async\s+)?function.*(?:init|connect|setup|bootstrap)/gi,
    /class\s+(\w*(?:Database|Connection|Pool|Client|Repository)\w*)/gi,
  ];

  const initializers: Evidence[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    const lineNumber = i + 1;
    const trimmedLine = line.trim();

    // Skip comments and empty lines
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
      return;
    }

    for (const pattern of initPatterns) {
      const matches = Array.from(line.matchAll(pattern));
      for (const match of matches) {
        const symbol = match[1];
        if (symbol && symbol.length > 2 && !isUISymbol(symbol)) {
          initializers.push({
            file: posixPath,
            line: lineNumber,
            match: `${symbol} (${trimmedLine.slice(0, 100)})`,
          });
        }
      }
    }
  });

  return initializers;
}

/**
 * Calculate confidence based on evidence strength
 */
export function calculateDbConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0;

  // Score different types of evidence
  let score = 0;
  const seenTypes = new Set<string>();

  for (const item of evidence) {
    const match = item.match.toLowerCase();

    // Import evidence (strongest)
    if (match.includes('from') || match.includes('import')) {
      if (!seenTypes.has('import')) {
        score += 30;
        seenTypes.add('import');
      }
    }

    // Environment evidence (strong)
    if (match.includes('process.env') || match.includes('DATABASE_URL')) {
      if (!seenTypes.has('env')) {
        score += 25;
        seenTypes.add('env');
      }
    }

    // SQL usage evidence (moderate)
    if (match.includes('sql`') || /select|insert|update|delete/i.test(match)) {
      if (!seenTypes.has('sql')) {
        score += 15;
        seenTypes.add('sql');
      }
    }

    // Connection patterns (moderate)
    if (/new\s+(pool|client|database)/i.test(match) || match.includes('.connect(')) {
      if (!seenTypes.has('connection')) {
        score += 20;
        seenTypes.add('connection');
      }
    }
  }

  // Normalize to 0-1 range
  return Math.min(1, score / 100);
}

/**
 * Check if a symbol appears to be UI-related (should not be considered a DB initializer)
 */
function isUISymbol(symbol: string): boolean {
  const uiPatterns = [
    /^get.*initials?$/i, // getInitials
    /initialized$/i, // mermaidInitialized, etc.
    /^(button|modal|dialog|form|input|card|image).*init/i,
    /component.*init/i,
    /ui.*init/i,
    /^init.*state$/i, // initState
    /^init.*props$/i, // initProps
    /^init.*component$/i, // initComponent
    /render.*init/i, // renderInit
    /mount.*init/i, // mountInit
    /^use.*init/i, // useInit (React hooks)
  ];

  return uiPatterns.some(pattern => pattern.test(symbol));
}

/**
 * Enhanced database engine detection with evidence tracking
 */
export function detectDatabaseEngine(text: string): { engine: string; evidence: Evidence[] } {
  const enginePatterns = {
    postgresql: [
      /from\s+['"]pg['"]|import.*pg\b/i,
      /from\s+['"]postgres['"]|import.*postgres/i,
      /DATABASE_URL.*postgres/i,
      /POSTGRES_URL/i,
      /\.query\s*\(\s*['"`]SELECT/i,
    ],
    mysql: [
      /from\s+['"]mysql2?['"]|import.*mysql/i,
      /MYSQL_URL|MYSQL_HOST/i,
      /mysql\.createConnection/i,
    ],
    sqlite: [
      /from\s+['"](?:better-)?sqlite3?['"]|import.*sqlite/i,
      /\.sqlite|\.db['"`]/i,
      /SQLITE_/i,
    ],
    mongodb: [
      /from\s+['"]mongodb?['"]|import.*mongo/i,
      /MONGODB_URI|MONGO_URL/i,
      /MongoClient|mongoose/i,
    ],
    redis: [/from\s+['"](?:io)?redis['"]|import.*redis/i, /REDIS_URL/i, /createClient.*redis/i],
    'vector-chroma': [/from\s+['"]chromadb['"]|import.*chromadb/i, /new\s+ChromaClient/i],
  };

  const evidence: Evidence[] = collectDbEvidence(text);

  // Determine primary engine based on evidence
  for (const [engine, patterns] of Object.entries(enginePatterns)) {
    if (patterns.some(pattern => pattern.test(text))) {
      return { engine, evidence };
    }
  }

  // Fallback: if we have SQL evidence but no specific engine, assume PostgreSQL
  if (evidence.some(e => /sql|select|insert|update|delete/i.test(e.match))) {
    return { engine: 'postgresql', evidence };
  }

  return { engine: 'unknown', evidence };
}
