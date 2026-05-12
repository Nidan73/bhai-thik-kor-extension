// ─── Field Types ────────────────────────────────────────────────────────────────

export type FieldType = 'textarea' | 'input' | 'contenteditable' | 'unknown';

// ─── API Response Types (mirrors backend api-schemas.ts) ────────────────────────

export type Routing = {
  open_source: ModelRecommendation;
  freemium: ModelRecommendation;
  premium: ModelRecommendation;
};

export type ModelRecommendation = {
  platform_id: string;
  model_name: string;
  reasoning: string;
};

export type GenerateResult = {
  optimized_prompt: string;
  routing: Routing;
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  options: string[];
};

export type Clarification = {
  question: string;
  answer: string;
};

export type ImproveSource = 'popup' | 'context-menu' | 'shortcut' | 'floating';

// ─── Rate Limit Info ────────────────────────────────────────────────────────────

export type RateLimitInfo = {
  remaining: number;
  limit: number;
  resetAt: number;
};

// ─── Message Protocol ───────────────────────────────────────────────────────────

export type Message =
  | { type: 'IMPROVE_REQUEST'; payload: { text: string; source: ImproveSource; requestId?: string } }
  | { type: 'IMPROVE_STARTED'; payload: { text: string; source: ImproveSource; requestId?: string } }
  | {
      type: 'IMPROVE_RESPONSE';
      payload: {
        result: GenerateResult;
        rateLimit?: RateLimitInfo;
        originalText?: string;
        source?: ImproveSource;
        requestId?: string;
      };
    }
  | {
      type: 'IMPROVE_ERROR';
      payload: {
        error: string;
        retryAfter?: number;
        originalText?: string;
        source?: ImproveSource;
        requestId?: string;
      };
    }
  | { type: 'CLARIFY_REQUEST'; payload: { text: string } }
  | { type: 'CLARIFY_RESPONSE'; payload: { questions: ClarifyingQuestion[] } }
  | { type: 'CLARIFY_ERROR'; payload: { error: string } }
  | { type: 'GENERATE_WITH_CLARIFICATIONS'; payload: { text: string; clarifications: Clarification[] } }
  | { type: 'REFINE_REQUEST'; payload: { currentPrompt: string; instruction: string } }
  | { type: 'REFINE_RESPONSE'; payload: { refinedPrompt: string } }
  | { type: 'REFINE_ERROR'; payload: { error: string; retryAfter?: number } }
  | { type: 'GET_SELECTED_TEXT' }
  | { type: 'SELECTED_TEXT_RESULT'; payload: { text: string; fieldType: FieldType; isBlocked: boolean } }
  | { type: 'REPLACE_TEXT'; payload: { text: string } }
  | { type: 'INSERT_BELOW'; payload: { text: string } }
  | { type: 'ACTION_DONE'; payload: { success: boolean } };

// ─── API Error Shape ────────────────────────────────────────────────────────────

export type ApiError = {
  error: string;
  retryAfter?: number;
};
