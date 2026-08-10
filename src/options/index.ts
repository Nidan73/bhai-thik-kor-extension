/**
 * Options Page Controller
 *
 * Reads and writes user settings and local history. Every write goes through
 * setSetting(), which reports failure so the page can surface it.
 */

import {
  MAX_DISABLED_HOSTS,
  getSettings,
  setSetting,
  type ImproveBehavior,
  type Settings,
} from '@/shared/settings';
import {
  clearHistory,
  deleteHistoryEntry,
  getHistory,
  type HistoryEntry,
} from '@/shared/history';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const optFloating = $<HTMLInputElement>('opt-floating');
const optBehaviorReplace = $<HTMLInputElement>('opt-behavior-replace');
const optBehaviorPreview = $<HTMLInputElement>('opt-behavior-preview');
const optShortcutsLink = $<HTMLAnchorElement>('opt-shortcuts-link');
const optHostForm = $<HTMLFormElement>('opt-host-form');
const optHostInput = $<HTMLInputElement>('opt-host-input');
const optHostList = $<HTMLUListElement>('opt-host-list');
const optHostEmpty = $<HTMLParagraphElement>('opt-host-empty');
const optHistory = $<HTMLInputElement>('opt-history');
const optHistoryPanel = $<HTMLDivElement>('opt-history-panel');
const optHistoryList = $<HTMLUListElement>('opt-history-list');
const optHistoryEmpty = $<HTMLParagraphElement>('opt-history-empty');
const optHistoryClear = $<HTMLButtonElement>('opt-history-clear');
const optStatus = $<HTMLParagraphElement>('opt-status');

let settings: Settings;
let statusTimer: number | undefined;
// Listeners are registered at module scope, but `settings` only exists once the
// storage round-trip finishes. Acting before that would throw and then persist a
// partial object.
let ready = false;

// ─── Status ─────────────────────────────────────────────────────────────────────

function showStatus(message: string, tone: 'success' | 'error') {
  window.clearTimeout(statusTimer);
  optStatus.textContent = message;
  optStatus.className = `status ${tone}`;
  statusTimer = window.setTimeout(() => {
    optStatus.textContent = '';
    optStatus.className = 'status';
  }, 3000);
}

/** Writes revert the control to the stored value when storage rejects them. */
async function write<K extends keyof Settings>(key: K, value: Settings[K]): Promise<boolean> {
  if (!ready) return false;

  const ok = await setSetting(key, value);

  if (!ok) {
    showStatus('Could not save. Chrome sync may be disabled or full.', 'error');
    render();
    return false;
  }

  settings = { ...settings, [key]: value };
  return true;
}

// ─── General ────────────────────────────────────────────────────────────────────

optFloating.addEventListener('change', () => {
  void write('floatingButton', optFloating.checked);
});

function onBehaviorChange(value: ImproveBehavior) {
  void write('improveBehavior', value);
}

optBehaviorReplace.addEventListener('change', () => onBehaviorChange('replace'));
optBehaviorPreview.addEventListener('change', () => onBehaviorChange('preview'));

optShortcutsLink.addEventListener('click', (event) => {
  event.preventDefault();
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ─── Sites ──────────────────────────────────────────────────────────────────────

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return '';
  }
}

optHostForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!ready) return;

  const host = normalizeHost(optHostInput.value);
  if (!host) {
    showStatus('Enter a site like example.com', 'error');
    return;
  }

  if (settings.disabledHosts.includes(host)) {
    optHostInput.value = '';
    return;
  }

  if (settings.disabledHosts.length >= MAX_DISABLED_HOSTS) {
    showStatus(`You can disable at most ${MAX_DISABLED_HOSTS} sites.`, 'error');
    return;
  }

  if (await write('disabledHosts', [...settings.disabledHosts, host])) {
    optHostInput.value = '';
    renderHosts();
    showStatus(`Disabled on ${host}.`, 'success');
  }
});

async function removeHost(host: string) {
  if (await write('disabledHosts', settings.disabledHosts.filter(item => item !== host))) {
    renderHosts();
  }
}

function renderHosts() {
  optHostList.innerHTML = '';
  optHostEmpty.classList.toggle('hidden', settings.disabledHosts.length > 0);

  for (const host of settings.disabledHosts) {
    const item = document.createElement('li');

    const label = document.createElement('span');
    label.textContent = host;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn link';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void removeHost(host));

    item.append(label, remove);
    optHostList.appendChild(item);
  }
}

// ─── History ────────────────────────────────────────────────────────────────────

optHistory.addEventListener('change', async () => {
  const enabled = optHistory.checked;
  if (!(await write('historyEnabled', enabled))) return;

  // Turning history off deletes what was stored — an off switch that leaves
  // data behind is not an off switch.
  if (!enabled) await clearHistory();

  optHistoryPanel.classList.toggle('hidden', !enabled);
  await renderHistory();
});

optHistoryClear.addEventListener('click', async () => {
  await clearHistory();
  await renderHistory();
  showStatus('History cleared.', 'success');
});

async function renderHistory() {
  const entries = await getHistory();
  optHistoryList.innerHTML = '';
  optHistoryEmpty.classList.toggle('hidden', entries.length > 0);

  for (const entry of entries) {
    optHistoryList.appendChild(createHistoryItem(entry));
  }
}

function createHistoryItem(entry: HistoryEntry): HTMLLIElement {
  const item = document.createElement('li');

  const body = document.createElement('div');
  body.className = 'entry';

  const meta = document.createElement('div');
  meta.className = 'entry-meta';
  meta.textContent = [new Date(entry.at).toLocaleString(), entry.host, entry.source]
    .filter(Boolean)
    .join(' · ');

  const text = document.createElement('div');
  text.className = 'entry-text';
  text.textContent = entry.optimized;

  body.append(meta, text);

  const actions = document.createElement('div');
  actions.className = 'entry-actions';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn link';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(entry.optimized);
      showStatus('Copied.', 'success');
    } catch {
      showStatus('Could not copy. Select the text and copy manually.', 'error');
    }
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn link';
  remove.textContent = 'Delete';
  remove.addEventListener('click', async () => {
    await deleteHistoryEntry(entry.id);
    await renderHistory();
  });

  actions.append(copy, remove);
  item.append(body, actions);
  return item;
}

// ─── Init ───────────────────────────────────────────────────────────────────────

function render() {
  optFloating.checked = settings.floatingButton;
  optBehaviorReplace.checked = settings.improveBehavior === 'replace';
  optBehaviorPreview.checked = settings.improveBehavior === 'preview';
  optHistory.checked = settings.historyEnabled;
  optHistoryPanel.classList.toggle('hidden', !settings.historyEnabled);
  renderHosts();
}

async function init() {
  settings = await getSettings();
  ready = true;
  render();
  if (settings.historyEnabled) await renderHistory();
}

void init();
