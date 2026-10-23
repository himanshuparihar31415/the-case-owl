import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5050'),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16).default('dev_secret_change_in_production_32chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  OPENAI_API_KEY: z.string().optional(),
  // PM pipeline TTS = ElevenLabs (STT + LLM still reuse OPENAI_API_KEY).
  // Resume interview runs on the OpenAI Realtime API (speech-to-speech).
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-2'),
  OPENAI_REALTIME_VOICE: z.string().default('cedar'),
  // minimal | low | medium | high | xhigh. Lower = snappier voice replies.
  OPENAI_REALTIME_REASONING: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('low'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default('oO7sLA3dWfQXsKeSAjpA'),
  ELEVENLABS_MODEL_ID: z.string().default('eleven_turbo_v2_5'),
  // Speech rate (0.7 slow … 1.2 fast; 1.0 = default). Slightly slow by default
  // so the interviewer doesn't sound rushed.
  ELEVENLABS_SPEED: z.coerce.number().min(0.7).max(1.2).default(0.92),
  APP_URL: z.string().default('http://localhost:5050'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  // Razorpay — set in local .env (untracked) and Railway dashboard vars. Never commit.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
