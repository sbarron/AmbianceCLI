import type {
  HandoffClaim,
  HandoffSections,
  HandoffV1,
  NormalizedHandoffEvent,
  RepositoryState,
} from './types';
import { estimateTokens, truncateText } from './utils';

type ClaimSection = Exclude<keyof HandoffSections, 'relevantFiles'>;

const SECTION_LIMITS: Record<'compact' | 'standard', Record<ClaimSection, number>> = {
  compact: {
    goal: 2,
    constraints: 4,
    decisions: 5,
    completedWork: 5,
    failedApproaches: 3,
    verification: 4,
    blockers: 3,
    nextActions: 3,
  },
  standard: {
    goal: 4,
    constraints: 8,
    decisions: 10,
    completedWork: 10,
    failedApproaches: 6,
    verification: 8,
    blockers: 6,
    nextActions: 6,
  },
};

function portableText(value: string): string {
  const objective = value.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/i)?.[1];
  if (objective) return truncateText(objective.trim(), 1_000);
  return truncateText(
    value
      .replace(
        /<(?:environment_context|recommended_plugins|apps_instructions|plugins_instructions)[\s\S]*?<\/(?:environment_context|recommended_plugins|apps_instructions|plugins_instructions)>/gi,
        ' '
      )
      .replace(/<codex_internal_context[\s\S]*?<\/codex_internal_context>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    1_200
  );
}

function claim(event: NormalizedHandoffEvent, maxChars = 900): HandoffClaim | undefined {
  const text = truncateText(portableText(event.text), maxChars);
  return text ? { text, evidence: [event.id] } : undefined;
}

function matches(event: NormalizedHandoffEvent, pattern: RegExp): boolean {
  return pattern.test(event.text);
}

function uniqueClaims(claims: Array<HandoffClaim | undefined>, limit: number): HandoffClaim[] {
  const seen = new Set<string>();
  const result: HandoffClaim[] = [];
  for (const item of claims) {
    if (!item) continue;
    const key = item.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function selectRecent(
  events: NormalizedHandoffEvent[],
  predicate: (event: NormalizedHandoffEvent) => boolean,
  limit: number,
  maxChars = 900
): HandoffClaim[] {
  return uniqueClaims(
    events
      .slice()
      .reverse()
      .filter(predicate)
      .map(event => claim(event, maxChars)),
    limit
  ).reverse();
}

export function compactEvents(args: {
  events: NormalizedHandoffEvent[];
  repository: RepositoryState;
  mode: 'compact' | 'standard';
}): HandoffSections {
  const { events, repository, mode } = args;
  const limits = SECTION_LIMITS[mode];
  const goalPattern =
    /\b(active goal|objective|implement|build|fix|create|investigate|review|continue)\b/i;
  const constraintPattern =
    /\b(must|should|need to|do not|don't|never|without|preserve|prefer|require|constraint)\b/i;
  const decisionPattern =
    /\b(decid(?:e|ed)|choose|chosen|use |keep |prefer|architecture|design|plan is|will )\b/i;
  const completedPattern =
    /\b(implemented|added|created|fixed|completed|done|updated|wrote|passed|verified|succeeded)\b/i;
  const failedPattern =
    /\b(failed|failure|error|rejected|did not work|could not|unable|timed out|blocked)\b/i;
  const verificationPattern =
    /\b(test|tests|build|lint|typecheck|verify|verified|passed|exit code 0|success)\b/i;
  const blockerPattern =
    /\b(blocked|blocker|remaining|missing|unresolved|cannot|can't|failed|todo)\b/i;
  const nextPattern =
    /\b(next|remaining|continue|implement|finish|follow[- ]?up|need to|should now)\b/i;

  const activeGoals = events.filter(
    event => event.kind === 'summary' && /^Active goal:/i.test(event.text)
  );
  const userEvents = events.filter(event => event.kind === 'user');
  const firstUser = userEvents.find(event => portableText(event.text).length > 0);
  const recentGoals = selectRecent(
    events,
    event => event.kind === 'user' || (event.kind === 'summary' && goalPattern.test(event.text)),
    limits.goal
  );
  const goals = uniqueClaims(
    [
      ...activeGoals.slice(-1).map(event => claim(event)),
      ...recentGoals,
      firstUser ? claim(firstUser) : undefined,
    ],
    limits.goal
  );

  const relevantFiles = Array.from(
    new Set<string>([
      ...repository.changedFiles,
      ...repository.codeEvidence.map(item => item.file),
      ...repository.referencedFiles,
    ])
  );

  return {
    goal: goals,
    constraints: selectRecent(
      events,
      event =>
        (event.kind === 'user' || event.kind === 'summary') && matches(event, constraintPattern),
      limits.constraints,
      700
    ),
    decisions: selectRecent(
      events,
      event =>
        (event.kind === 'assistant' || event.kind === 'user') && matches(event, decisionPattern),
      limits.decisions,
      700
    ),
    completedWork: selectRecent(
      events,
      event =>
        (event.kind === 'assistant' || event.kind === 'tool_result') &&
        matches(event, completedPattern),
      limits.completedWork,
      650
    ),
    failedApproaches: selectRecent(
      events,
      event => event.kind === 'error' || matches(event, failedPattern),
      limits.failedApproaches,
      650
    ),
    verification: selectRecent(
      events,
      event =>
        (event.kind === 'tool_result' || event.kind === 'assistant') &&
        matches(event, verificationPattern),
      limits.verification,
      650
    ),
    blockers: selectRecent(
      events,
      event => event.kind === 'error' || matches(event, blockerPattern),
      limits.blockers,
      600
    ),
    nextActions: selectRecent(
      events,
      event => event.kind === 'user' || matches(event, nextPattern),
      limits.nextActions,
      650
    ),
    relevantFiles: relevantFiles.slice(0, mode === 'compact' ? 20 : 50),
  };
}

function renderClaims(title: string, claims: HandoffClaim[]): string[] {
  if (claims.length === 0) return [];
  return [
    `## ${title}`,
    '',
    ...claims.map(item => `- ${item.text}  \n  Evidence: ${item.evidence.join(', ')}`),
    '',
  ];
}

export function renderHandoffMarkdown(handoff: HandoffV1): string {
  const sections = handoff.sections;
  const lines = [
    `# Handoff: ${handoff.title}`,
    '',
    `Source: ${handoff.sourceSession.source} session ${handoff.sourceSession.sessionId}`,
    `Project: ${handoff.projectPath}`,
    `Mode: ${handoff.mode} | budget ${handoff.maxTokens} tokens`,
    '',
    ...renderClaims('Goal', sections.goal),
    ...renderClaims('Constraints', sections.constraints),
    ...renderClaims('Decisions', sections.decisions),
    ...renderClaims('Completed work', sections.completedWork),
    ...renderClaims('Failed or rejected approaches', sections.failedApproaches),
    ...renderClaims('Verification', sections.verification),
    ...renderClaims('Blockers', sections.blockers),
    ...renderClaims('Next actions', sections.nextActions),
  ];

  if (sections.relevantFiles.length > 0) {
    lines.push('## Relevant files', '', ...sections.relevantFiles.map(file => `- ${file}`), '');
  }

  lines.push(
    '## Repository state',
    '',
    `- Branch: ${handoff.repository.branch || 'unknown'}`,
    `- HEAD: ${handoff.repository.head || 'unknown'}`,
    `- Dirty: ${handoff.repository.dirty ? 'yes' : 'no'}`,
    `- Stale relative to source session: ${handoff.repository.stale ? 'yes' : 'no'}`
  );
  for (const reason of handoff.repository.staleReasons) lines.push(`  - ${reason}`);
  lines.push('', `Evidence index: ${handoff.evidenceFile}`, '');

  if (handoff.warnings.length > 0) {
    lines.push('## Warnings', '', ...handoff.warnings.map(warning => `- ${warning}`), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function cloneSections(sections: HandoffSections): HandoffSections {
  return {
    goal: sections.goal.slice(),
    constraints: sections.constraints.slice(),
    decisions: sections.decisions.slice(),
    completedWork: sections.completedWork.slice(),
    failedApproaches: sections.failedApproaches.slice(),
    verification: sections.verification.slice(),
    blockers: sections.blockers.slice(),
    nextActions: sections.nextActions.slice(),
    relevantFiles: sections.relevantFiles.slice(),
  };
}

export function fitHandoffToBudget(handoff: HandoffV1): { handoff: HandoffV1; markdown: string } {
  const fitted: HandoffV1 = { ...handoff, sections: cloneSections(handoff.sections) };
  const removable: ClaimSection[] = [
    'constraints',
    'failedApproaches',
    'blockers',
    'completedWork',
    'decisions',
    'verification',
    'nextActions',
    'goal',
  ];
  const minimums: Partial<Record<ClaimSection, number>> = {
    goal: 1,
    decisions: 1,
    completedWork: 1,
    verification: 1,
    nextActions: 1,
  };
  let markdown = renderHandoffMarkdown(fitted);

  while (estimateTokens(markdown) > fitted.maxTokens) {
    let removed = false;
    for (const section of removable) {
      const minimum = minimums[section] ?? 0;
      if (fitted.sections[section].length > minimum) {
        fitted.sections[section].shift();
        removed = true;
        break;
      }
    }
    if (!removed && fitted.sections.relevantFiles.length > 5) {
      fitted.sections.relevantFiles.pop();
      removed = true;
    }
    if (!removed) break;
    markdown = renderHandoffMarkdown(fitted);
  }

  if (estimateTokens(markdown) > fitted.maxTokens) {
    for (const section of removable) {
      fitted.sections[section] = fitted.sections[section].map(item => ({
        ...item,
        text: truncateText(item.text, 280),
      }));
    }
    markdown = renderHandoffMarkdown(fitted);
  }

  fitted.estimatedTokens = estimateTokens(markdown);
  return { handoff: fitted, markdown };
}
