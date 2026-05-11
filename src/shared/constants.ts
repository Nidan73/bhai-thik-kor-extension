// ─── Backend API URL ────────────────────────────────────────────────────────────

export const API_BASE = 'https://bhaithikkor.vercel.app/api';

export const ENDPOINTS = {
  generate: `${API_BASE}/generate`,
  clarify: `${API_BASE}/clarify`,
  refine: `${API_BASE}/refine`,
  health: `${API_BASE}/health`,
} as const;

// ─── Input Limits (mirrors backend api-schemas.ts) ──────────────────────────────

export const PROMPT_MAX_CHARS = 4000;
export const REFINE_SOURCE_MAX_CHARS = 6000;
export const REFINE_INSTRUCTION_MAX_CHARS = 500;
export const PROMPT_MIN_CHARS = 3;

// ─── Rate Limits (for display purposes) ─────────────────────────────────────────

export const DAILY_GENERATE_LIMIT = 50;

// ─── Extension Meta ─────────────────────────────────────────────────────────────

export const EXTENSION_NAME = 'Bhai Thik Kor';
export const WEBSITE_URL = 'https://bhaithikkor.vercel.app';
