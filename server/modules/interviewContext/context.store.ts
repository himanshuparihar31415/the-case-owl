import { Session } from '../../models/Session.js';

// ─────────────────────────────────────────────────────────────────────────────
// Interview context store
//
// Everything that defines ONE interview (what the interviewer was told, what was
// said, what happened on the connection) is kept behind this interface so the
// storage location can be changed without touching the voice code. Only the
// factory at the bottom decides where it lives.
//
// Default backend: a single `interviewContext` field on the Session document in
// MongoDB. To move it elsewhere (another collection, Redis, a vector store…),
// implement InterviewContextStore and return it from getInterviewContextStore().
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextTurn {
  role: 'interviewer' | 'candidate';
  text: string;
  at: string; // ISO timestamp
}

export interface ContextEvent {
  type: string; // e.g. 'connected' | 'reconnected' | 'openai_error' | 'closed'
  at: string;
  detail?: string;
}

/** The fixed inputs of the interview: written once at connect, refreshed on reconnect. */
export interface InterviewContextSnapshot {
  module: string;
  model: string;               // realtime model the interviewer ran on
  instructions: string;        // the exact system prompt the interviewer was given
  setup: Record<string, unknown>; // role, topics, style, duration…
  brief: unknown;              // structured resume brief the instructions were built from
}

export interface StoredInterviewContext {
  snapshot?: InterviewContextSnapshot;
  turns?: ContextTurn[];
  events?: ContextEvent[];
  endedAt?: string;
  endReason?: string;
}

export interface InterviewContextStore {
  /** Create the context (first connect) or refresh its snapshot (reconnect). Never wipes turns. */
  init(sessionId: string, snapshot: InterviewContextSnapshot): Promise<void>;
  appendTurn(sessionId: string, turn: ContextTurn): Promise<void>;
  appendEvent(sessionId: string, event: ContextEvent): Promise<void>;
  load(sessionId: string): Promise<StoredInterviewContext | null>;
  finalize(sessionId: string, endReason: string): Promise<void>;
}

class MongoSessionContextStore implements InterviewContextStore {
  async init(sessionId: string, snapshot: InterviewContextSnapshot): Promise<void> {
    // First connect: create the container. No-op if it already exists.
    await Session.updateOne(
      { _id: sessionId, 'interviewContext.turns': { $exists: false } },
      { $set: { interviewContext: { snapshot, turns: [], events: [] } } },
    );
    // Reconnect (or just created): make sure the snapshot is current.
    await Session.updateOne({ _id: sessionId }, { $set: { 'interviewContext.snapshot': snapshot } });
  }

  async appendTurn(sessionId: string, turn: ContextTurn): Promise<void> {
    await Session.updateOne({ _id: sessionId }, { $push: { 'interviewContext.turns': turn } });
  }

  async appendEvent(sessionId: string, event: ContextEvent): Promise<void> {
    await Session.updateOne({ _id: sessionId }, { $push: { 'interviewContext.events': event } });
  }

  async load(sessionId: string): Promise<StoredInterviewContext | null> {
    const s = await Session.findById(sessionId).select('interviewContext').lean();
    return (s?.interviewContext as StoredInterviewContext | undefined) ?? null;
  }

  async finalize(sessionId: string, endReason: string): Promise<void> {
    await Session.updateOne(
      { _id: sessionId },
      { $set: { 'interviewContext.endedAt': new Date().toISOString(), 'interviewContext.endReason': endReason } },
    );
  }
}

let store: InterviewContextStore | null = null;

/** The one place that decides where interview context is stored. */
export function getInterviewContextStore(): InterviewContextStore {
  if (!store) store = new MongoSessionContextStore();
  return store;
}
