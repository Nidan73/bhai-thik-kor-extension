/**
 * Popup UI Controller
 *
 * Manages the popup interface:
 * - Normal Mode: type → improve → copy/replace/insert
 * - Guided Mode: clarify → answer → generate
 * - Error/loading state management
 * - Rate limit display
 */

import { PROMPT_MAX_CHARS, PROMPT_MIN_CHARS, WEBSITE_URL } from '@/shared/constants';
import type {
  Message,
  GenerateResult,
  ClarifyingQuestion,
  Clarification,
  RateLimitInfo,
} from '@/shared/types';

// ─── DOM Elements ───────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const sectionInput = $<HTMLElement>('section-input');
const sectionLoading = $<HTMLElement>('section-loading');
const sectionResult = $<HTMLElement>('section-result');
const sectionGuided = $<HTMLElement>('section-guided');
const sectionError = $<HTMLElement>('section-error');

const inputPrompt = $<HTMLTextAreaElement>('input-prompt');
const charCount = $<HTMLElement>('char-count');
const btnImprove = $<HTMLButtonElement>('btn-improve');
const btnGuided = $<HTMLButtonElement>('btn-guided');

const resultPrompt = $<HTMLElement>('result-prompt');
const btnCopy = $<HTMLButtonElement>('btn-copy');
const btnReplace = $<HTMLButtonElement>('btn-replace');
const btnInsert = $<HTMLButtonElement>('btn-insert');
const btnOpenWebsite = $<HTMLButtonElement>('btn-open-website');
const btnNew = $<HTMLButtonElement>('btn-new');
const routingCards = $<HTMLElement>('routing-cards');

const guidedQuestions = $<HTMLElement>('guided-questions');
const btnGuidedSubmit = $<HTMLButtonElement>('btn-guided-submit');
const btnBackGuided = $<HTMLButtonElement>('btn-back-guided');

const errorMessage = $<HTMLElement>('error-message');
const btnRetry = $<HTMLButtonElement>('btn-retry');

const rateLimitInfo = $<HTMLElement>('rate-limit-info');

// ─── State ──────────────────────────────────────────────────────────────────────

let currentResult: GenerateResult | null = null;
let currentPromptText = '';
let guidedAnswers: Map<string, string> = new Map();

// ─── UI Helpers ─────────────────────────────────────────────────────────────────

function showSection(section: HTMLElement) {
  [sectionInput, sectionLoading, sectionResult, sectionGuided, sectionError].forEach(s =>
    s.classList.add('hidden'),
  );
  section.classList.remove('hidden');
}

function updateCharCount() {
  const len = inputPrompt.value.length;
  charCount.textContent = `${len} / ${PROMPT_MAX_CHARS}`;
  btnImprove.disabled = len < PROMPT_MIN_CHARS;
}

function updateRateLimit(info?: RateLimitInfo) {
  if (info) {
    rateLimitInfo.textContent = `${info.remaining} of ${info.limit} prompts remaining today`;
    // Store for persistence across popup opens
    chrome.storage.local.set({ lastRateLimit: info });
  }
}

// ─── Normal Mode ────────────────────────────────────────────────────────────────

async function handleImprove() {
  const text = inputPrompt.value.trim();
  if (text.length < PROMPT_MIN_CHARS) return;

  currentPromptText = text;
  showSection(sectionLoading);
  btnImprove.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'IMPROVE_REQUEST',
      payload: { text, source: 'popup' },
    } satisfies Message);

    if (response?.type === 'IMPROVE_RESPONSE') {
      currentResult = response.payload.result;
      updateRateLimit(response.payload.rateLimit);
      showResult(response.payload.result);
    } else if (response?.type === 'IMPROVE_ERROR') {
      showError(response.payload.error);
    }
  } catch (err) {
    showError('Could not reach Bhai Thik Kor. Check your connection.');
  }

  btnImprove.disabled = false;
}

function showResult(result: GenerateResult) {
  resultPrompt.textContent = result.optimized_prompt;
  renderRoutingCards(result.routing);
  showSection(sectionResult);
}

function renderRoutingCards(routing: GenerateResult['routing']) {
  routingCards.innerHTML = '';

  const tiers = [
    { key: 'open_source', label: 'Open Source' },
    { key: 'freemium', label: 'Freemium' },
    { key: 'premium', label: 'Premium' },
  ] as const;

  for (const tier of tiers) {
    const rec = routing[tier.key];
    if (!rec) continue;

    const card = document.createElement('div');
    card.className = 'routing-card';
    card.innerHTML = `
      <div class="routing-card-left">
        <span class="routing-tier ${tier.key}">${tier.label}</span>
        <span class="routing-model">${rec.model_name}</span>
      </div>
      <a class="routing-card-link" href="#" data-platform="${rec.platform_id}" title="${rec.reasoning}">
        Try →
      </a>
    `;

    // Link click opens platform URL (resolved from platform_id)
    const link = card.querySelector('.routing-card-link') as HTMLAnchorElement;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      // The platform URL resolution happens on the website side
      // For the extension, we just open the website with the prompt
      chrome.tabs.create({ url: WEBSITE_URL });
    });

    routingCards.appendChild(card);
  }
}

// ─── Guided Mode ────────────────────────────────────────────────────────────────

async function handleGuidedMode() {
  const text = inputPrompt.value.trim();
  if (text.length < PROMPT_MIN_CHARS) {
    inputPrompt.focus();
    inputPrompt.placeholder = 'Type your idea first, then click Guide Me...';
    return;
  }

  currentPromptText = text;
  showSection(sectionLoading);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CLARIFY_REQUEST',
      payload: { text },
    } satisfies Message);

    if (response?.type === 'CLARIFY_RESPONSE') {
      renderGuidedQuestions(response.payload.questions);
      showSection(sectionGuided);
    } else if (response?.type === 'CLARIFY_ERROR') {
      showError(response.payload.error);
    }
  } catch {
    showError('Guided Mode is temporarily unavailable.');
  }
}

function renderGuidedQuestions(questions: ClarifyingQuestion[]) {
  guidedQuestions.innerHTML = '';
  guidedAnswers.clear();
  btnGuidedSubmit.classList.add('hidden');

  questions.forEach((q) => {
    const container = document.createElement('div');
    container.className = 'guided-question';

    const label = document.createElement('div');
    label.className = 'guided-question-text';
    label.textContent = q.question;
    container.appendChild(label);

    const options = document.createElement('div');
    options.className = 'guided-options';

    q.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'guided-option';
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        // Deselect siblings
        options.querySelectorAll('.guided-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        guidedAnswers.set(q.question, opt);
        checkGuidedReady();
      });
      options.appendChild(btn);
    });

    container.appendChild(options);

    // Custom answer input
    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'guided-custom-input';
    customInput.placeholder = 'Or type your own answer...';
    customInput.addEventListener('input', () => {
      if (customInput.value.trim()) {
        options.querySelectorAll('.guided-option').forEach(b => b.classList.remove('selected'));
        guidedAnswers.set(q.question, customInput.value.trim());
        checkGuidedReady();
      }
    });
    container.appendChild(customInput);

    guidedQuestions.appendChild(container);
  });
}

function checkGuidedReady() {
  const allQuestions = guidedQuestions.querySelectorAll('.guided-question');
  if (guidedAnswers.size >= allQuestions.length) {
    btnGuidedSubmit.classList.remove('hidden');
  }
}

async function handleGuidedSubmit() {
  const clarifications: Clarification[] = Array.from(guidedAnswers.entries()).map(
    ([question, answer]) => ({ question, answer }),
  );

  showSection(sectionLoading);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_WITH_CLARIFICATIONS',
      payload: { text: currentPromptText, clarifications },
    } satisfies Message);

    if (response?.type === 'IMPROVE_RESPONSE') {
      currentResult = response.payload.result;
      updateRateLimit(response.payload.rateLimit);
      showResult(response.payload.result);
    } else if (response?.type === 'IMPROVE_ERROR') {
      showError(response.payload.error);
    }
  } catch {
    showError('Failed to generate prompt. Please try again.');
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────────

async function handleCopy() {
  if (!currentResult) return;

  try {
    await navigator.clipboard.writeText(currentResult.optimized_prompt);
    btnCopy.classList.add('copied');
    const originalText = btnCopy.innerHTML;
    btnCopy.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      btnCopy.classList.remove('copied');
      btnCopy.innerHTML = originalText;
    }, 2000);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = currentResult.optimized_prompt;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function handleReplace() {
  if (!currentResult) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.tabs.sendMessage(tab.id, {
      type: 'REPLACE_TEXT',
      payload: { text: currentResult.optimized_prompt },
    } satisfies Message);
  } catch {
    // Content script may not be injected — this is expected on some pages
  }
}

async function handleInsert() {
  if (!currentResult) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    await chrome.tabs.sendMessage(tab.id, {
      type: 'INSERT_BELOW',
      payload: { text: currentResult.optimized_prompt },
    } satisfies Message);
  } catch {
    // Content script may not be injected
  }
}

// ─── Error Handling ─────────────────────────────────────────────────────────────

function showError(msg: string) {
  errorMessage.textContent = msg;
  showSection(sectionError);
}

function handleRetry() {
  showSection(sectionInput);
  inputPrompt.focus();
}

function handleNewPrompt() {
  currentResult = null;
  currentPromptText = '';
  inputPrompt.value = '';
  updateCharCount();
  showSection(sectionInput);
  inputPrompt.focus();
}

// ─── Init ───────────────────────────────────────────────────────────────────────

function init() {
  // Input events
  inputPrompt.addEventListener('input', updateCharCount);
  inputPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleImprove();
    }
  });

  // Button events
  btnImprove.addEventListener('click', handleImprove);
  btnGuided.addEventListener('click', handleGuidedMode);
  btnCopy.addEventListener('click', handleCopy);
  btnReplace.addEventListener('click', handleReplace);
  btnInsert.addEventListener('click', handleInsert);
  btnOpenWebsite.addEventListener('click', () => chrome.tabs.create({ url: WEBSITE_URL }));
  btnNew.addEventListener('click', handleNewPrompt);
  btnRetry.addEventListener('click', handleRetry);
  btnBackGuided.addEventListener('click', () => showSection(sectionInput));
  btnGuidedSubmit.addEventListener('click', handleGuidedSubmit);

  // Load cached rate limit
  chrome.storage.local.get('lastRateLimit', (data) => {
    if (data.lastRateLimit) {
      updateRateLimit(data.lastRateLimit);
    }
  });

  // Focus input
  updateCharCount();
  inputPrompt.focus();
}

init();
