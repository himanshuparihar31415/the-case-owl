import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5050'),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16).default('dev_secret_change_in_production_32chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  OPENAI_API_KEY: z.string().optional(),
  // PM pipeline (STT→LLM→TTS) TTS config. STT + LLM reuse OPENAI_API_KEY.
  OPENAI_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
  OPENAI_TTS_VOICE: z.string().default('cedar'),
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
