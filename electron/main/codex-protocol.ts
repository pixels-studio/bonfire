/**
 * The parts of the `codex app-server` protocol Bonfire uses. The full schema is
 * generated with `codex app-server generate-ts`; only what is read or sent is typed here.
 */

export type RequestId = number | string;

export type ThreadItem =
  | { type: 'userMessage'; id: string }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'plan'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary: string[]; content: string[] }
  | {
      type: 'commandExecution';
      id: string;
      command: string;
      status: ItemStatus;
      aggregatedOutput: string | null;
      exitCode: number | null;
    }
  | {
      type: 'fileChange';
      id: string;
      status: ItemStatus;
      changes: { path: string; kind: { type: string }; diff: string }[];
    }
  | {
      type: 'mcpToolCall';
      id: string;
      server: string;
      tool: string;
      status: ItemStatus;
      arguments: unknown;
      result: { content: unknown[] } | null;
      error: { message: string } | null;
    }
  | {
      type: 'dynamicToolCall';
      id: string;
      tool: string;
      status: ItemStatus;
      arguments: unknown;
      contentItems: { type: string; text?: string }[] | null;
    }
  | {
      type: 'collabAgentToolCall';
      id: string;
      tool: string;
      status: ItemStatus;
      prompt: string | null;
    }
  | { type: 'webSearch'; id: string; query: string };

export type ItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export type CommandApprovalDecision =
  'accept' | 'acceptForSession' | 'decline' | 'cancel';

export type UserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[] | null;
};

export type ModelEntry = {
  model: string;
  displayName: string;
  hidden: boolean;
};

export type CodexAccount =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string }
  | { type: 'amazonBedrock' };

export type LoginCompleted = {
  loginId: string | null;
  success: boolean;
  error: string | null;
};

/** One folder's skills, from `skills/list`. */
export type SkillsListEntry = {
  cwd: string;
  skills: {
    name: string;
    description: string;
    /** Legacy short description from SKILL.md; `interface.shortDescription` is preferred. */
    shortDescription?: string;
    interface?: { shortDescription?: string };
    /** The skill's SKILL.md, on the server's machine. */
    path: string;
    enabled: boolean;
  }[];
};
