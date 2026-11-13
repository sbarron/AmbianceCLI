export type HandoffSource = 'codex' | 'claude';

export type HandoffEventKind =
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'summary'
  | 'error'
  | 'system';

export interface SessionSummary {
  selection?: number;
  sessionId: string;
  source: HandoffSource;
  title: string;
  sourcePath: string;
  cwd?: string;
  model?: string;
  createdAt?: string;
  updatedAt: string;
  eventCount?: number;
  sizeBytes: number;
}

export interface HandoffSourceRef {
  id: string;
  source: HandoffSource;
  sessionId: string;
  sourcePath: string;
  line: number;
  eventId?: string;
  timestamp?: string;
  contentHash: string;
}

export interface NormalizedHandoffEvent {
  id: string;
  kind: HandoffEventKind;
  text: string;
  timestamp?: string;
  toolName?: string;
  turnId?: string;
  redactions?: number;
  sourceRef: HandoffSourceRef;
}

export interface HandoffClaim {
  text: string;
  evidence: string[];
}

export interface RepositoryCodeEvidence {
  file: string;
  symbol?: string;
  start?: number;
  end?: number;
  why?: string[];
}

export interface RepositoryState {
  projectPath: string;
  capturedAt: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  changedFiles: string[];
  referencedFiles: string[];
  missingReferencedFiles: string[];
  codeEvidence: RepositoryCodeEvidence[];
  stale: boolean;
  staleReasons: string[];
}

export interface HandoffSections {
  goal: HandoffClaim[];
  constraints: HandoffClaim[];
  decisions: HandoffClaim[];
  completedWork: HandoffClaim[];
  failedApproaches: HandoffClaim[];
  verification: HandoffClaim[];
  blockers: HandoffClaim[];
  nextActions: HandoffClaim[];
  relevantFiles: string[];
}

export interface HandoffV1 {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  sourceSession: SessionSummary;
  projectPath: string;
  mode: 'compact' | 'standard';
  maxTokens: number;
  estimatedTokens: number;
  sections: HandoffSections;
  repository: RepositoryState;
  evidenceFile: string;
  markdownFile: string;
  sourceFingerprint: string;
  warnings: string[];
}

export interface SessionAdapter {
  source: HandoffSource;
  resolveRoot(): string;
  inspect(filePath: string): SessionSummary | undefined;
  enrichSummary?(session: SessionSummary): SessionSummary;
  loadEvents(session: SessionSummary): Promise<NormalizedHandoffEvent[]>;
}

export interface SessionCatalogEntry {
  source: HandoffSource;
  sourcePath: string;
  sizeBytes: number;
  mtimeMs: number;
  summary: SessionSummary;
}

export interface SessionCatalogV1 {
  version: 1;
  inspectorVersion: 3;
  updatedAt: string;
  entries: Record<string, SessionCatalogEntry>;
}

export interface HandoffListResult {
  sessions: SessionSummary[];
  listId: string;
  projectPath?: string;
  scannedSources: HandoffSource[];
}

export interface HandoffSearchResult extends SessionSummary {
  selection: number;
  score: number;
  snippet: string;
}

export interface HandoffSearchIndexing {
  scannedSessions: number;
  indexedSessions: number;
  reusedSessions: number;
  removedSessions: number;
  errors: string[];
}

export interface HandoffSearchResultSet {
  query: string;
  results: HandoffSearchResult[];
  searchId: string;
  projectPath?: string;
  scannedSources: HandoffSource[];
  indexing: HandoffSearchIndexing;
}

export interface HandoffArtifactPaths {
  directory: string;
  handoffJson: string;
  handoffMarkdown: string;
  evidenceJsonl: string;
  sourceTranscript?: string;
}
