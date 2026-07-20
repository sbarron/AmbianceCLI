import type { HandoffSource, SessionAdapter } from '../types';
import { claudeAdapter } from './claudeAdapter';
import { codexAdapter } from './codexAdapter';

const ADAPTERS: Record<HandoffSource, SessionAdapter> = {
  codex: codexAdapter,
  claude: claudeAdapter,
};

export function getAdapter(source: HandoffSource): SessionAdapter {
  return ADAPTERS[source];
}

export function getAdapters(sources?: HandoffSource[]): SessionAdapter[] {
  const selected =
    sources && sources.length > 0 ? sources : (Object.keys(ADAPTERS) as HandoffSource[]);
  return selected.map(source => ADAPTERS[source]);
}
