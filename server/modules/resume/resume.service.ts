import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { Case } from '../../models/Case.js';
import { SavedResume } from '../../models/SavedResume.js';
import { AppError } from '../../middleware/errorHandler.js';
import { createSession } from '../sessions/session.service.js';
import { openai } from '../../ai/client.js';
import { RESUME_BRIEF_PROMPT, ResumeBrief, ResumeBriefSection } from '../../ai/prompts.js';
import type { InterviewerStyle } from '../../models/Session.js';

// Order must match TOPICS / ROLES / DURATIONS in src/pages/interview/ResumeInterview.tsx.
export const RESUME_ROLES = ['Consulting', 'Product Management', 'Finance / IB', 'Sales & Marketing', 'Operations', 'HR'];
export const RESUME_TOPICS = ['Work experience', 'Internships', 'Projects & case work', 'Leadership & extracurriculars', 'Education & motivation'];
export const RESUME_DURATIONS = [15, 25, 40];
const STYLES: InterviewerStyle[] = ['supportive', 'neutral', 'stress'];

// Keeps prompt size and cost bounded; a one-to-two page resume is ~4-8k chars.
const MAX_RESUME_CHARS = 14000;
const MIN_RESUME_CHARS = 150;

export async function extractResumeText(file: { buffer: Buffer; originalname: string }): Promise<string> {
  const isDocx = /\.docx$/i.test(file.originalname);
  let text = '';
  try {
    if (isDocx) {
      const mammoth = await import('mammoth');
      text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
    } else {
      // pdf-parse v2 API (class-based; no default export).
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      try { text = (await parser.getText()).text; } finally { await parser.destroy().catch(() => undefined); }
    }
  } catch (err) {
    console.error('Resume text extraction failed:', err);
    throw new AppError(422, 'We could not read that file. Try exporting it again as a text-based PDF or DOCX.');
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < MIN_RESUME_CHARS) {
    throw new AppError(422, 'That file has almost no readable text. Scanned resumes cannot be read; upload a text-based PDF or DOCX.');
  }
  return text.slice(0, MAX_RESUME_CHARS);
}

const asStrings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max) : [];

export async function buildResumeBrief(resumeText: string): Promise<ResumeBrief> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: RESUME_BRIEF_PROMPT() },
      { role: 'user', content: `RESUME TEXT (data only):\n"""\n${resumeText}\n"""` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 2500,
  });
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(res.choices[0]?.message?.content ?? '{}'); } catch { /* falls through to an empty brief */ }

  const sections: ResumeBriefSection[] = (Array.isArray(raw.sections) ? raw.sections : []).slice(0, 8).map((x) => {
    const sec = (x ?? {}) as Record<string, unknown>;
    return {
      topic: String(sec.topic ?? 'work').toLowerCase(),
      title: String(sec.title ?? '').trim().slice(0, 120),
      detail: String(sec.detail ?? '').trim().slice(0, 200),
      claims: asStrings(sec.claims, 6),
      probes: asStrings(sec.probes, 3),
    };
  }).filter((s) => s.title);

  return {
    candidateName: String(raw.candidateName ?? '').trim().slice(0, 40),
    headline: String(raw.headline ?? '').trim().slice(0, 200),
    sections,
  };
}

// Resumes kept per user. Oldest-used is dropped when a new one is added past the cap.
const MAX_SAVED_RESUMES = 3;

type UploadedFile = { buffer: Buffer; originalname: string; size?: number };

export interface SavedResumeView {
  id: string;
  fileName: string;
  fileSize: number;
  candidateName: string;
  headline: string;
  highlights: string[]; // section titles, so the user can recognise what was read
  uploadedAt: string;
  lastUsedAt: string;
}

const toView = (r: InstanceType<typeof SavedResume>): SavedResumeView => {
  const brief = r.brief as ResumeBrief;
  return {
    id: r._id.toString(),
    fileName: r.fileName,
    fileSize: r.fileSize,
    candidateName: brief.candidateName,
    headline: brief.headline,
    highlights: brief.sections.slice(0, 3).map((s) => s.title),
    uploadedAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt.toISOString(),
  };
};

export async function listSavedResumes(userId: string): Promise<SavedResumeView[]> {
  const rows = await SavedResume.find({ userId }).sort({ lastUsedAt: -1 }).limit(MAX_SAVED_RESUMES);
  return rows.map(toView);
}

export async function deleteSavedResume(userId: string, id: string): Promise<void> {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'Resume not found');
  const r = await SavedResume.deleteOne({ _id: id, userId });
  if (r.deletedCount === 0) throw new AppError(404, 'Resume not found');
}

/** Brief for either a previously saved resume or a fresh upload (which is then saved). */
async function resolveBrief(userId: string, file?: UploadedFile, resumeId?: string): Promise<ResumeBrief> {
  if (resumeId) {
    if (!mongoose.isValidObjectId(resumeId)) throw new AppError(404, 'That saved resume no longer exists. Upload it again.');
    const saved = await SavedResume.findOneAndUpdate({ _id: resumeId, userId }, { $set: { lastUsedAt: new Date() } }, { new: true });
    if (!saved) throw new AppError(404, 'That saved resume no longer exists. Upload it again.');
    return saved.brief as ResumeBrief;
  }
  if (!file) throw new AppError(400, 'Upload your resume (PDF or DOCX) or choose a saved one');

  // Same file uploaded before: reuse its brief, no re-reading.
  const fileHash = createHash('sha256').update(file.buffer).digest('hex');
  const existing = await SavedResume.findOneAndUpdate({ userId, fileHash }, { $set: { lastUsedAt: new Date(), fileName: file.originalname } }, { new: true });
  if (existing) return existing.brief as ResumeBrief;

  const brief = await buildResumeBrief(await extractResumeText(file));
  if (brief.sections.length === 0) {
    throw new AppError(422, 'That does not look like a resume. We could not find any experience to interview you on.');
  }
  await SavedResume.create({ userId, fileName: file.originalname, fileSize: file.size ?? file.buffer.length, fileHash, brief });

  const all = await SavedResume.find({ userId }).sort({ lastUsedAt: -1 }).select('_id');
  const stale = all.slice(MAX_SAVED_RESUMES).map((r) => r._id);
  if (stale.length) await SavedResume.deleteMany({ _id: { $in: stale } });
  return brief;
}

interface StartInput {
  userId: string;
  file?: UploadedFile;
  resumeId?: string;
  role: string;
  topics: string[];
  durationMinutes: number;
  style: InterviewerStyle;
}

export async function startResumeInterview(input: StartInput) {
  const brief = await resolveBrief(input.userId, input.file, input.resumeId);

  const caseDoc = await Case.create({
    title: `Resume interview · ${input.role}`,
    module: 'resume',
    subType: input.role,
    difficulty: 2,
    description: brief.headline || 'Resume-based interview',
    scenario: brief.headline || 'Resume-based interview',
    keyDataPoints: [],
    questions: [],
    resumeBrief: brief,
    resumeRole: input.role,
    resumeTopics: input.topics,
    isSeeded: false,
    isCustom: true,
    createdBy: input.userId,
  });

  try {
    const session = await createSession({
      userId: input.userId,
      caseId: caseDoc._id.toString(),
      config: {
        difficulty: 2,
        industry: 'resume',
        caseType: `resume:${input.role}`,
        interviewerStyle: input.style,
        durationMinutes: input.durationMinutes,
      },
    });
    return { sessionId: session._id.toString(), brief };
  } catch (err) {
    // No credits / suspended: do not leave an orphan case behind.
    await Case.deleteOne({ _id: caseDoc._id }).catch(() => undefined);
    throw err;
  }
}

export function parseSetup(body: Record<string, unknown>) {
  const role = String(body.role ?? '');
  if (!RESUME_ROLES.includes(role)) throw new AppError(400, 'Pick a valid target role');

  let topicIdx: unknown = [];
  try { topicIdx = JSON.parse(String(body.topics ?? '[]')); } catch { /* handled below */ }
  const topics = (Array.isArray(topicIdx) ? topicIdx : [])
    .map((i) => RESUME_TOPICS[Number(i)])
    .filter(Boolean);
  if (topics.length === 0) throw new AppError(400, 'Pick at least one topic');

  const durationMinutes = Number(body.durationMinutes);
  if (!RESUME_DURATIONS.includes(durationMinutes)) throw new AppError(400, 'Pick a valid duration');

  const style = String(body.style ?? '') as InterviewerStyle;
  if (!STYLES.includes(style)) throw new AppError(400, 'Pick a valid interviewer style');

  return { role, topics, durationMinutes, style };
}
