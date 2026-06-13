import { Session, ISession } from '../../models/Session.js';
import { Case } from '../../models/Case.js';
import { AppError } from '../../middleware/errorHandler.js';
import { generateHintWithAI } from '../../ai/client.js';
import { InterviewerStyle, TranscriptEntry } from '../../models/Session.js';

interface CreateSessionInput {
  userId: string;
  caseId: string;
  config: {
    difficulty: number;
    industry: string;
    caseType: string;
    interviewerStyle: InterviewerStyle;
    durationMinutes: number;
  };
}

export async function createSession(input: CreateSessionInput): Promise<ISession> {
  const caseDoc = await Case.findById(input.caseId);
  if (!caseDoc) throw new AppError(404, 'Case not found');

  return Session.create({
    userId: input.userId,
    caseId: input.caseId,
    config: input.config,
    status: 'active',
    transcript: [],
    startedAt: new Date(),
  });
}

export async function getUserSessions(
  userId: string,
  page = 1,
  limit = 10
): Promise<{ sessions: ISession[]; total: number }> {
  const skip = (page - 1) * limit;
  const [sessions, total] = await Promise.all([
    Session.find({ userId })
      .populate('caseId', 'title type industry difficulty')
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit),
    Session.countDocuments({ userId }),
  ]);
  return { sessions, total };
}

export async function getSessionById(id: string, userId: string): Promise<ISession> {
  const session = await Session.findOne({ _id: id, userId }).populate('caseId');
  if (!session) throw new AppError(404, 'Session not found');
  return session;
}

export async function endSession(id: string, userId: string, scratchpad?: string): Promise<ISession> {
  const session = await Session.findOne({ _id: id, userId });
  if (!session) throw new AppError(404, 'Session not found');
  if (session.status !== 'active') throw new AppError(400, 'Session is already ended');

  const now = new Date();
  const durationSeconds = Math.floor((now.getTime() - session.startedAt.getTime()) / 1000);

  session.status = 'completed';
  session.endedAt = now;
  session.durationSeconds = durationSeconds;
  if (typeof scratchpad === 'string') session.scratchpad = scratchpad;
  await session.save();

  return session;
}

export async function appendTranscript(
  sessionId: string,
  entry: TranscriptEntry
): Promise<void> {
  await Session.updateOne(
    { _id: sessionId },
    { $push: { transcript: entry } }
  );
}

export async function getSessionHint(id: string, userId: string): Promise<string> {
  const session = await Session.findOne({ _id: id, userId }).populate('caseId');
  if (!session) throw new AppError(404, 'Session not found');

  const lastFiveExchanges = session.transcript.slice(-10);
  const hint = await generateHintWithAI(lastFiveExchanges);
  return hint;
}
