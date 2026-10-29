// Request shapes shared by the browser client and the Worker. Keep in sync with worker/src.
import type { Mood, RuleSpec, WorldSpec } from '../world/spec';

/** Trimmed world context the dialogue model receives. Built by npc/dialogue.ts, never the raw spec. */
export interface DialogueContext {
  title: string;
  era: string;
  theme: WorldSpec['theme'];
  lexicon: string[];
  hour: number;
  day: number;
  /** Plain-language summary of active rules, one per line. */
  rules: string[];
  /** Quest beats the NPC may act on right now: objective plus the beat text. */
  activeBeats: { stepId: string; objective: string; beat: string }[];
  /** Last few engine log lines involving this NPC, for grounded answers to "why". */
  recentLog: string[];
}

export interface NpcSayRequest {
  sessionId: string;
  npc: {
    id: string;
    name: string;
    role: string;
    persona: string;
    knowledge: string[];
    /** Only the secrets already revealed to the player. */
    revealed: string[];
    mood: Mood;
    place: string;
  };
  context: DialogueContext;
  history: { speaker: 'player' | 'npc'; text: string }[]; // last 8 turns
  playerText: string;
}

export interface TickRequest {
  sessionId: string;
  /** Short world summary shared by every question, under ~600 tokens. */
  stateSummary: string;
  questions: { npcId: string; question: string; options: string[] }[];
}

export interface TickResponse {
  /** One probability vector per question, same order as options. Empty when the decision model failed. */
  probs: number[][];
  source: 'jev' | 'clef' | 'none';
}

export interface PatchRequest {
  sessionId: string;
  ruleText: string;
  /** Compact spec summary: buildings (id, role), npcs (id, role), items (id), existing rules. */
  summary: string;
}

export interface PatchResponse {
  rules: RuleSpec[];
}

export interface CompileRequest {
  prompt: string;
  seed: number;
}

export type ApiError = { error: string; reason?: 'resting' | 'rate_limited' | 'refusal' | 'upstream' | 'bad_request' };
