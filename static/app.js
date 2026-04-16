const ownersEl = document.getElementById('owners-json');
let CANONICAL_OWNERS = ownersEl ? JSON.parse(ownersEl.textContent || '[]') : [];

const fileInput = document.getElementById('fileInput');
const filesTableBody = document.getElementById('filesTableBody');
const buildBtn = document.getElementById('buildBtn');
const clearBtn = document.getElementById('clearBtn');
const uploadShell = document.getElementById('uploadShell');
const dropZone = document.getElementById('dropZone');
const filesPanel = document.getElementById('filesPanel');
const ownerHint = document.getElementById('ownerHint');
const statusCard = document.getElementById('statusCard');
const statusText = document.getElementById('statusText');
const resultMeta = document.getElementById('resultMeta');
const dupCount = document.getElementById('dupCount');
const dropCount = document.getElementById('dropCount');
const downloadBtn = document.getElementById('downloadBtn');
const droppedCard = document.getElementById('droppedCard');
const droppedList = document.getElementById('droppedList');
const toggleDropped = document.getElementById('toggleDropped');
const previewStatus = document.getElementById('previewStatus');
const previewSpinner = document.getElementById('previewSpinner');
const buildSpinner = document.getElementById('buildSpinner');

/** Плавно прокрутить страницу к самому низу (после появления блока статуса/итогов). */
function scrollPageToBottomSmooth() {
  const run = () => {
    const el = document.documentElement;
    const target = Math.max(el.scrollHeight, document.body.scrollHeight);
    window.scrollTo({ top: target, left: 0, behavior: 'smooth' });
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

/** @type {{ file: File, preview: object | null, manualOwner: string }[]} */
let items = [];
let previewInFlight = false;
/** Счётчик, чтобы отбросить ответ предпросмотра после удаления строки во время запроса. */
let previewGen = 0;
/** @type {AbortController | null} */
let previewAbort = null;
/** @type {string | null} */
let lastDownloadObjectUrl = null;
/** @type {(() => void) | null} */
let previewProgressStop = null;
/** @type {(() => void) | null} */
let buildProgressStop = null;

/**
 * Пока идёт один запрос к серверу, нарастиваю счётчик от 1 до (total−1); после ответа показываю финальный текст отдельно.
 * @param {number} total
 * @param {(done: number, total: number) => void} onTick
 * @returns {() => void}
 */
function runStagedProgress(total, onTick) {
  const t = Math.max(1, Math.floor(Number(total)) || 1);
  let done = 1;
  onTick(done, t);
  if (t <= 1) {
    return () => {};
  }
  const cap = t - 1;
  const delay = Math.min(480, Math.max(130, Math.floor(3200 / t)));
  const id = setInterval(() => {
    if (done < cap) {
      done += 1;
      onTick(done, t);
    }
  }, delay);
  return () => clearInterval(id);
}

function stopPreviewProgressUI() {
  if (previewProgressStop) {
    previewProgressStop();
    previewProgressStop = null;
  }
  if (previewSpinner) {
    previewSpinner.hidden = true;
    previewSpinner.style.setProperty('--p', '0');
  }
}

function stopBuildProgressUI() {
  if (buildProgressStop) {
    buildProgressStop();
    buildProgressStop = null;
  }
  if (buildSpinner) {
    buildSpinner.hidden = true;
    buildSpinner.style.setProperty('--p', '0');
  }
}

/** Доля заполнения кольца (0…1): дуга var(--c-6) растёт с прогрессом «файлов». */
function setRingProgress(el, done, total) {
  if (!el) return;
  const t = Math.max(1, total);
  const d = Math.max(0, done);
  const p = Math.min(1, d / t);
  el.style.setProperty('--p', String(p));
  el.setAttribute('aria-valuenow', String(Math.min(t, Math.round(d))));
  el.setAttribute('aria-valuemax', String(t));
}

function revokeDownloadObjectUrl() {
  if (lastDownloadObjectUrl) {
    URL.revokeObjectURL(lastDownloadObjectUrl);
    lastDownloadObjectUrl = null;
  }
}

/** @param {string} b64 */
function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

/** @type {HTMLElement | null} */
let ownerDdOpen = null;

function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') || '' : '';
}

function apiHeaders() {
  return { 'X-CSRFToken': getCsrfToken(), 'X-Requested-With': 'XMLHttpRequest' };
}

function jsonApiHeaders() {
  return {
    ...apiHeaders(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * @param {string} message
 * @returns {Promise<boolean>}
 */
function confirmYesNo(message) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'app-confirm';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const backdrop = document.createElement('div');
    backdrop.className = 'app-confirm__backdrop';
    const box = document.createElement('div');
    box.className = 'app-confirm__box';
    const p = document.createElement('p');
    p.className = 'app-confirm__msg';
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'app-confirm__actions';
    const btnNo = document.createElement('button');
    btnNo.type = 'button';
    btnNo.className = 'btn secondary';
    btnNo.textContent = 'Нет';
    const btnYes = document.createElement('button');
    btnYes.type = 'button';
    btnYes.className = 'btn';
    btnYes.textContent = 'Да';
    const done = (v) => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
    };
    btnNo.addEventListener('click', () => done(false));
    btnYes.addEventListener('click', () => done(true));
    backdrop.addEventListener('click', () => done(false));
    row.appendChild(btnNo);
    row.appendChild(btnYes);
    box.appendChild(p);
    box.appendChild(row);
    wrap.appendChild(backdrop);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      wrap.classList.add('is-open');
      btnYes.focus();
    });
  });
}

/**
 * Одна кнопка «ОК» (ошибки валидации, итоговое сообщение).
 * @param {string} message
 * @returns {Promise<void>}
 */
function infoOk(message) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'app-confirm';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    const backdrop = document.createElement('div');
    backdrop.className = 'app-confirm__backdrop';
    const box = document.createElement('div');
    box.className = 'app-confirm__box';
    const p = document.createElement('p');
    p.className = 'app-confirm__msg';
    p.textContent = message;
    const row = document.createElement('div');
    row.className = 'app-confirm__actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'ОК';
    const done = () => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done();
    };
    btn.addEventListener('click', done);
    backdrop.addEventListener('click', done);
    row.appendChild(btn);
    box.appendChild(p);
    box.appendChild(row);
    wrap.appendChild(backdrop);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      wrap.classList.add('is-open');
      btn.focus();
    });
  });
}

/** @type {{ root: HTMLElement | null; dirty: boolean; onDocKey: ((e: KeyboardEvent) => void) | null }} */
const ownersEditor = { root: null, dirty: false, onDocKey: null };

/** @type {HTMLElement | null} */
let ownerFieldTipLayer = null;
/** @type {(() => void) | null} */
let ownerFieldTipUnbind = null;
let ownerFieldTipDescSeq = 0;

function getOwnerFieldTipLayer() {
  if (!ownerFieldTipLayer) {
    ownerFieldTipLayer = document.createElement('div');
    ownerFieldTipLayer.className = 'owner-editor-float-tip';
    ownerFieldTipLayer.setAttribute('role', 'tooltip');
  }
  return ownerFieldTipLayer;
}

function hideOwnerFieldTip() {
  ownerFieldTipUnbind?.();
  ownerFieldTipUnbind = null;
  const el = ownerFieldTipLayer;
  if (!el) return;
  el.classList.remove('is-visible');
  el.textContent = '';
  el.remove();
}

/**
 * @param {HTMLElement} anchor
 * @param {HTMLElement} tipEl
 */
function positionOwnerFieldTip(anchor, tipEl) {
  const r = anchor.getBoundingClientRect();
  const pad = 8;
  const maxW = Math.min(360, window.innerWidth - 2 * pad);
  tipEl.style.maxWidth = `${maxW}px`;
  tipEl.style.visibility = 'hidden';
  tipEl.style.left = '0';
  tipEl.style.top = '0';
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const gap = 10;
  let top = r.bottom + gap;
  if (top + h > window.innerHeight - pad) {
    top = Math.max(pad, r.top - h - gap);
  }
  let left = r.left + r.width / 2 - w / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
  tipEl.style.visibility = 'visible';
}

/**
 * @param {HTMLElement} anchor
 * @param {string} text
 * @param {HTMLElement} scrollEl
 */
function showOwnerFieldTip(anchor, text, scrollEl) {
  hideOwnerFieldTip();
  const el = getOwnerFieldTipLayer();
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add('is-visible');
    requestAnimationFrame(() => positionOwnerFieldTip(anchor, el));
  });
  const onResize = () => positionOwnerFieldTip(anchor, el);
  const onScroll = () => hideOwnerFieldTip();
  window.addEventListener('resize', onResize);
  scrollEl.addEventListener('scroll', onScroll, true);
  ownerFieldTipUnbind = () => {
    window.removeEventListener('resize', onResize);
    scrollEl.removeEventListener('scroll', onScroll, true);
  };
}

/**
 * @param {HTMLButtonElement} helpBtn
 * @param {HTMLElement} scrollEl
 */
function wireOwnerFieldTip(helpBtn, scrollEl) {
  const show = () => showOwnerFieldTip(helpBtn, helpBtn.dataset.ownerFieldTip || '', scrollEl);
  const hide = () => hideOwnerFieldTip();
  helpBtn.addEventListener('mouseenter', show);
  helpBtn.addEventListener('mouseleave', hide);
  helpBtn.addEventListener('focus', show);
  helpBtn.addEventListener('blur', hide);
}

function setOwnersEditorDirty(v) {
  ownersEditor.dirty = Boolean(v);
}

function syncOwnersJsonScript(names) {
  if (ownersEl) ownersEl.textContent = JSON.stringify(names);
}

function syncOwnersHintList(names) {
  const hint = document.getElementById('ownerHint');
  if (!hint) return;
  const ul = hint.querySelector('ul');
  if (!ul) return;
  ul.innerHTML = '';
  names.forEach((n) => {
    const li = document.createElement('li');
    li.textContent = n;
    ul.appendChild(li);
  });
}

function reconcileManualOwnersAfterListChange() {
  const set = new Set(CANONICAL_OWNERS);
  items.forEach((e) => {
    if (e.manualOwner && !set.has(e.manualOwner)) e.manualOwner = '';
  });
}

function invalidatePreviewAfterOwnersChange() {
  if (!items.length) return;
  previewGen += 1;
  previewAbort?.abort();
  items.forEach((e) => {
    e.preview = null;
  });
  stopPreviewProgressUI();
  renderTable();
  syncBuildButton();
  void runPreview();
}

function destroyOwnersEditorModal() {
  hideOwnerFieldTip();
  if (ownersEditor.onDocKey) {
    document.removeEventListener('keydown', ownersEditor.onDocKey);
    ownersEditor.onDocKey = null;
  }
  ownersEditor.root?.remove();
  ownersEditor.root = null;
  ownersEditor.dirty = false;
}

async function tryCloseOwnersEditorModal() {
  if (!ownersEditor.root) return;
  if (ownersEditor.dirty) {
    const ok = await confirmYesNo('Закрыть без сохранения? Несохранённые изменения будут потеряны.');
    if (!ok) return;
  }
  destroyOwnersEditorModal();
}

const TIP_CANONICAL =
  'Официальное имя собственника в системе: оно попадает в итоговый Excel и в список выбора «Вручную». Должно быть уникальным.';
const TIP_SYNONYMS =
  'Дополнительные написания и сокращения из текста таблицы (ячейки, подписи). Если в файле встретится такой текст, собственник будет определён автоматически.';
const TIP_FILENAME =
  'Фрагменты для поиска в имени загружаемого файла. Полезно, когда в таблице нет названия компании, но оно есть в названии файла.';

/**
 * @param {string} labelText
 * @param {string} tipText
 */
function createOwnerEditorColumnHeader(labelText, tipText) {
  const th = document.createElement('th');
  const wrap = document.createElement('span');
  wrap.className = 'owner-editor-th';
  const label = document.createElement('span');
  label.className = 'owner-editor-th__label';
  label.textContent = labelText;
  const helpBtn = document.createElement('button');
  helpBtn.type = 'button';
  helpBtn.className = 'owner-editor-th__help';
  helpBtn.setAttribute('aria-label', `Подсказка: ${labelText}`);
  const mark = document.createElement('span');
  mark.className = 'owner-editor-th__mark';
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '?';
  helpBtn.appendChild(mark);
  wrap.appendChild(label);
  wrap.appendChild(helpBtn);
  th.appendChild(wrap);
  const desc = document.createElement('span');
  desc.className = 'sr-only';
  desc.id = `owner-field-tip-desc-${(ownerFieldTipDescSeq += 1)}`;
  desc.textContent = tipText;
  helpBtn.setAttribute('aria-describedby', desc.id);
  th.appendChild(desc);
  helpBtn.dataset.ownerFieldTip = tipText;
  return th;
}

function buildOwnerEditorRow(rule) {
  const tr = document.createElement('tr');
  tr.dataset.ownerRow = '1';
  const tdName = document.createElement('td');
  const inpName = document.createElement('input');
  inpName.type = 'text';
  inpName.className = 'owner-editor__input';
  inpName.dataset.canonical = '1';
  inpName.value = rule.canonical_name || '';
  inpName.setAttribute('aria-label', 'Каноническое имя');
  tdName.appendChild(inpName);

  const tdSy = document.createElement('td');
  const inpSy = document.createElement('input');
  inpSy.type = 'text';
  inpSy.className = 'owner-editor__input';
  inpSy.dataset.synonyms = '1';
  inpSy.value = Array.isArray(rule.synonyms) ? rule.synonyms.join(', ') : String(rule.synonyms || '');
  inpSy.setAttribute('aria-label', 'Синонимы через запятую');
  tdSy.appendChild(inpSy);

  const tdFsy = document.createElement('td');
  const inpFsy = document.createElement('input');
  inpFsy.type = 'text';
  inpFsy.className = 'owner-editor__input';
  inpFsy.dataset.fileSynonyms = '1';
  inpFsy.value = Array.isArray(rule.file_name_synonyms)
    ? rule.file_name_synonyms.join(', ')
    : String(rule.file_name_synonyms || '');
  inpFsy.setAttribute('aria-label', 'Синонимы в имени файла, через запятую');
  tdFsy.appendChild(inpFsy);

  const tdRm = document.createElement('td');
  tdRm.className = 'owner-editor__td-remove';
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'owner-editor__remove';
  rm.setAttribute('aria-label', 'Удалить строку');
  rm.title = 'Удалить';
  rm.textContent = '×';
  rm.addEventListener('click', async () => {
    const label = inpName.value.trim() || 'эту строку';
    const ok = await confirmYesNo(`Удалить собственника «${label}» из списка?`);
    if (!ok) return;
    if (tr.parentNode) {
      tr.parentNode.removeChild(tr);
      setOwnersEditorDirty(true);
    }
  });
  tdRm.appendChild(rm);

  tr.appendChild(tdName);
  tr.appendChild(tdSy);
  tr.appendChild(tdFsy);
  tr.appendChild(tdRm);
  return tr;
}

function collectRulesFromOwnersEditor(root) {
  const rows = root.querySelectorAll('tr[data-owner-row]');
  /** @type {object[]} */
  const rules = [];
  rows.forEach((row) => {
    const cn = row.querySelector('[data-canonical]');
    const sy = row.querySelector('[data-synonyms]');
    const fsy = row.querySelector('[data-file-synonyms]');
    rules.push({
      canonical_name: cn && 'value' in cn ? String(cn.value) : '',
      synonyms: sy && 'value' in sy ? String(sy.value) : '',
      file_name_synonyms: fsy && 'value' in fsy ? String(fsy.value) : '',
    });
  });
  return rules;
}

function openOwnersEditorModal(rules) {
  destroyOwnersEditorModal();
  setOwnersEditorDirty(false);

  const wrap = document.createElement('div');
  wrap.className = 'owner-modal';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-labelledby', 'owner-modal-title');

  const backdrop = document.createElement('div');
  backdrop.className = 'owner-modal__backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'owner-modal__dialog card';

  const head = document.createElement('div');
  head.className = 'owner-modal__head';
  const title = document.createElement('h2');
  title.className = 'owner-modal__title';
  title.id = 'owner-modal-title';
  title.textContent = 'Список собственников';
  const btnClose = document.createElement('button');
  btnClose.type = 'button';
  btnClose.className = 'owner-modal__close';
  btnClose.setAttribute('aria-label', 'Закрыть');
  btnClose.textContent = '×';
  btnClose.addEventListener('click', () => {
    void tryCloseOwnersEditorModal();
  });
  head.appendChild(title);
  head.appendChild(btnClose);

  const scroll = document.createElement('div');
  scroll.className = 'owner-modal__scroll';
  const table = document.createElement('table');
  table.className = 'owner-editor-table';
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  trHead.appendChild(createOwnerEditorColumnHeader('Каноническое имя', TIP_CANONICAL));
  trHead.appendChild(createOwnerEditorColumnHeader('Синонимы (через запятую)', TIP_SYNONYMS));
  trHead.appendChild(createOwnerEditorColumnHeader('В имени файла (через запятую)', TIP_FILENAME));
  const thRm = document.createElement('th');
  thRm.className = 'owner-editor__th-remove';
  thRm.innerHTML = '<span class="sr-only">Удалить</span>';
  trHead.appendChild(thRm);
  thead.appendChild(trHead);
  const tbody = document.createElement('tbody');
  rules.forEach((r) => tbody.appendChild(buildOwnerEditorRow(r)));
  table.appendChild(thead);
  table.appendChild(tbody);
  scroll.appendChild(table);
  trHead.querySelectorAll('.owner-editor-th__help').forEach((btn) => {
    wireOwnerFieldTip(/** @type {HTMLButtonElement} */ (btn), scroll);
  });

  const foot = document.createElement('div');
  foot.className = 'owner-modal__foot';

  const btnAdd = document.createElement('button');
  btnAdd.type = 'button';
  btnAdd.className = 'btn secondary';
  btnAdd.textContent = 'Добавить собственника';
  btnAdd.addEventListener('click', () => {
    const tr = buildOwnerEditorRow({ canonical_name: '', synonyms: '', file_name_synonyms: '' });
    tbody.appendChild(tr);
    setOwnersEditorDirty(true);
    const inp = tr.querySelector('[data-canonical]');
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight;
      requestAnimationFrame(() => {
        if (inp instanceof HTMLInputElement) inp.focus({ preventScroll: true });
      });
    });
  });

  const btnApply = document.createElement('button');
  btnApply.type = 'button';
  btnApply.className = 'btn';
  btnApply.textContent = 'Применить';
  btnApply.addEventListener('click', async () => {
    const collected = collectRulesFromOwnersEditor(wrap);
    const empty = collected.some((r) => !String(r.canonical_name || '').trim());
    if (empty) {
      await infoOk('Укажите каноническое имя у каждой строки (поле не может быть пустым).');
      return;
    }
    const ok = await confirmYesNo('Применить изменения к списку собственников на сервере?');
    if (!ok) return;
    try {
      const response = await fetch('/api/owners-config/', {
        method: 'POST',
        headers: jsonApiHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ rules: collected }),
      });
      const data = await response.json();
      if (!response.ok) {
        await infoOk(data.detail || 'Не удалось сохранить список.');
        return;
      }
      CANONICAL_OWNERS = data.canonical_names || [];
      syncOwnersJsonScript(CANONICAL_OWNERS);
      syncOwnersHintList(CANONICAL_OWNERS);
      reconcileManualOwnersAfterListChange();
      destroyOwnersEditorModal();
      invalidatePreviewAfterOwnersChange();
      const summary = data.summary || 'Список обновлён.';
      await infoOk(summary);
    } catch {
      await infoOk('Ошибка сети при сохранении списка.');
    }
  });

  foot.appendChild(btnAdd);
  foot.appendChild(btnApply);

  dialog.appendChild(head);
  dialog.appendChild(scroll);
  dialog.appendChild(foot);
  wrap.appendChild(backdrop);
  wrap.appendChild(dialog);

  const markDirty = () => setOwnersEditorDirty(true);
  wrap.addEventListener('input', markDirty);

  backdrop.addEventListener('click', () => {
    void tryCloseOwnersEditorModal();
  });

  ownersEditor.root = wrap;
  ownersEditor.onDocKey = (e) => {
    if (e.key === 'Escape') void tryCloseOwnersEditorModal();
  };
  document.addEventListener('keydown', ownersEditor.onDocKey);

  document.body.appendChild(wrap);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => wrap.classList.add('is-open'));
  });
}

async function openOwnersListEditorFromUi() {
  try {
    const response = await fetch('/api/owners-config/', {
      method: 'GET',
      headers: { ...apiHeaders(), Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const data = await response.json();
    if (!response.ok) {
      await infoOk(data.detail || 'Не удалось загрузить список собственников.');
      return;
    }
    const rules = data.rules;
    if (!Array.isArray(rules)) {
      await infoOk('Сервер вернул некорректный ответ.');
      return;
    }
    openOwnersEditorModal(rules);
  } catch {
    await infoOk('Ошибка сети при загрузке списка собственников.');
  }
}

const SOURCE_LABEL = {
  content: 'по содержимому',
  filename: 'по имени файла',
  unknown: 'не определено',
  error: 'ошибка чтения',
};

const OWNER_EMPTY_LABEL = '— не задано (как в файле) —';
const OWNER_REQUIRED_PLACEHOLDER = '— выберите собственника —';

function needsOwnerChoiceFromPreview(p) {
  return Boolean(p && p.source === 'unknown');
}

function ownerOptions() {
  return [{ value: '', label: OWNER_EMPTY_LABEL }, ...CANONICAL_OWNERS.map((n) => ({ value: n, label: n }))];
}

function ownerOptionsForEntry(entry) {
  if (needsOwnerChoiceFromPreview(entry.preview)) {
    return CANONICAL_OWNERS.map((n) => ({ value: n, label: n }));
  }
  return ownerOptions();
}

function positionOwnerPanel(wrap) {
  const trigger = wrap.querySelector('.owner-dd__trigger');
  const panel = wrap.querySelector('.owner-dd__panel');
  if (!trigger || !panel) return;
  const rect = trigger.getBoundingClientRect();
  const gap = 4;
  panel.style.left = `${Math.max(8, rect.left)}px`;
  panel.style.top = `${rect.bottom + gap}px`;
  panel.style.width = `${rect.width}px`;
  const maxH = Math.min(280, window.innerHeight - rect.bottom - gap - 16);
  panel.style.maxHeight = `${Math.max(120, maxH)}px`;
}

function closeOwnerDropdowns(exceptWrap) {
  document.querySelectorAll('.owner-dd.is-open').forEach((w) => {
    if (w !== exceptWrap) {
      w.classList.remove('is-open');
      const t = w.querySelector('.owner-dd__trigger');
      if (t) t.setAttribute('aria-expanded', 'false');
    }
  });
  if (!exceptWrap || !exceptWrap.classList.contains('is-open')) {
    ownerDdOpen = null;
  }
}

function syncOpenPanelPosition() {
  if (ownerDdOpen) positionOwnerPanel(ownerDdOpen);
}

function createOwnerDropdown(index, entry) {
  const wrap = document.createElement('div');
  wrap.className = 'owner-dd';
  const needsChoice = needsOwnerChoiceFromPreview(entry.preview);
  if (needsChoice && !entry.manualOwner) {
    wrap.classList.add('owner-dd--required-empty');
  }

  const opts = ownerOptionsForEntry(entry);
  const current = entry.manualOwner || '';
  const currentOpt = opts.find((o) => o.value === current);
  const triggerLabelText = currentOpt
    ? currentOpt.label
    : needsChoice
      ? OWNER_REQUIRED_PLACEHOLDER
      : opts[0].label;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'owner-dd__trigger';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'listbox');
  const triggerLabel = document.createElement('span');
  triggerLabel.className = 'owner-dd__trigger-text';
  triggerLabel.textContent = triggerLabelText;
  const chevron = document.createElement('span');
  chevron.className = 'owner-dd__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.appendChild(triggerLabel);
  trigger.appendChild(chevron);

  const panel = document.createElement('div');
  panel.className = 'owner-dd__panel';
  panel.id = `owner-dd-panel-${index}`;

  trigger.setAttribute('aria-controls', panel.id);

  const panelScroll = document.createElement('div');
  panelScroll.className = 'owner-dd__panel-scroll';
  panelScroll.setAttribute('role', 'listbox');

  opts.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'owner-dd__option';
    if (opt.value === current) btn.classList.add('owner-dd__option--active');
    btn.textContent = opt.label;
    btn.dataset.value = opt.value;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', opt.value === current ? 'true' : 'false');
    btn.addEventListener('click', () => {
      items[index].manualOwner = opt.value;
      triggerLabel.textContent = opt.label;
      wrap.classList.toggle('owner-dd--required-empty', needsOwnerChoiceFromPreview(items[index].preview) && !opt.value);
      panelScroll.querySelectorAll('.owner-dd__option').forEach((b) => {
        const v = b.dataset.value || '';
        const on = v === opt.value;
        b.classList.toggle('owner-dd__option--active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      ownerDdOpen = null;
      syncBuildButton();
    });
    panelScroll.appendChild(btn);
  });
  panel.appendChild(panelScroll);

  const editFooter = document.createElement('div');
  editFooter.className = 'owner-dd__edit-wrap';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'owner-dd__edit-list';
  editBtn.textContent = 'изменить список';
  editBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    wrap.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    ownerDdOpen = null;
    void openOwnersListEditorFromUi();
  });
  editFooter.appendChild(editBtn);
  panel.appendChild(editFooter);

  trigger.addEventListener('click', () => {
    const willOpen = !wrap.classList.contains('is-open');
    closeOwnerDropdowns(null);
    if (willOpen) {
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      ownerDdOpen = wrap;
      positionOwnerPanel(wrap);
    }
  });

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      ownerDdOpen = null;
    }
  });

  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  return wrap;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.owner-dd')) return;
  closeOwnerDropdowns(null);
});

window.addEventListener('scroll', syncOpenPanelPosition, true);
window.addEventListener('resize', syncOpenPanelPosition);

/** Строка под таблицей: актуальное число файлов (после удаления строк). Не проверять previewInFlight — из runPreview() нельзя вызывать до finally: флаг ещё true. */
function updatePreviewDoneLine() {
  if (!previewStatus || !items.length) return;
  if (items.every((e) => e.preview)) {
    stopPreviewProgressUI();
    previewStatus.textContent = `Готово: проверено файлов — ${items.length}`;
  }
}

function syncUploadView() {
  if (!dropZone || !filesPanel) return;
  const has = items.length > 0;
  dropZone.classList.toggle('hidden', has);
  filesPanel.classList.toggle('hidden', !has);
  if (!has && uploadShell) uploadShell.classList.remove('dragover');
  if (ownerHint && uploadShell) {
    if (has) {
      filesPanel.prepend(ownerHint);
    } else {
      uploadShell.after(ownerHint);
    }
  }
}

function addFiles(fileList) {
  const next = Array.from(fileList).filter((f) => {
    const n = f.name.toLowerCase();
    return n.endsWith('.xls') || n.endsWith('.xlsx');
  });
  if (!next.length) {
    alert('Формат файла не поддерживается');
    return;
  }
  next.forEach((file) => items.push({ file, preview: null, manualOwner: '' }));
  syncUploadView();
  renderTable();
  void runPreview();
}

function removeFileAt(index) {
  if (index < 0 || index >= items.length) return;
  closeOwnerDropdowns(null);
  const needPreviewAgain = previewInFlight;
  if (needPreviewAgain) {
    previewGen += 1;
    previewAbort?.abort();
  }
  items.splice(index, 1);
  revokeDownloadObjectUrl();
  if (!items.length) {
    stopPreviewProgressUI();
    previewStatus.textContent = '';
    statusCard.classList.add('hidden');
    droppedCard.classList.add('hidden');
    previewGen += 1;
    syncUploadView();
    renderTable();
    syncBuildButton();
    return;
  }
  renderTable();
  syncBuildButton();
  if (needPreviewAgain && items.length) {
    queueMicrotask(() => {
      void runPreview();
    });
  } else {
    updatePreviewDoneLine();
  }
}

function renderTable() {
  filesTableBody.innerHTML = '';
  items.forEach((entry, index) => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'cell-name';
    tdName.textContent = entry.file.name;

    const tdSize = document.createElement('td');
    tdSize.textContent = `${Math.round(entry.file.size / 1024)} КБ`;

    const tdAuto = document.createElement('td');
    const p = entry.preview;
    if (!p) {
      tdAuto.textContent = '—';
    } else if (p.source === 'error') {
      tdAuto.textContent = p.detail || 'ошибка';
    } else {
      tdAuto.textContent = p.detected_owner || '—';
    }

    const tdSrc = document.createElement('td');
    if (!p) {
      tdSrc.textContent = '—';
    } else if (p.source === 'error') {
      tdSrc.textContent = SOURCE_LABEL.error;
    } else {
      tdSrc.textContent = SOURCE_LABEL[p.source] || p.source;
      if (p.sheet_name && p.row_number) {
        tdSrc.title = `лист «${p.sheet_name}», строка ${p.row_number}`;
      }
    }

    const tdMan = document.createElement('td');
    tdMan.className = 'cell-owner files-table__col-owner';
    tdMan.appendChild(createOwnerDropdown(index, entry));

    const tdRemove = document.createElement('td');
    tdRemove.className = 'cell-remove';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn-row-remove';
    rm.setAttribute('aria-label', `Убрать из списка: ${entry.file.name}`);
    rm.title = 'Убрать файл из списка';
    rm.textContent = '×';
    rm.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removeFileAt(index);
    });

    tdRemove.appendChild(rm);

    tdAuto.classList.add('files-table__col-owner');
    tdSrc.classList.add('files-table__col-owner');

    let effectiveOwnerHint = '';
    const pv = entry.preview;
    if (pv && pv.source !== 'error') {
      const manual = (entry.manualOwner || '').trim();
      const auto = pv.detected_owner || '';
      if (manual) effectiveOwnerHint = `Для строк без собственника в Excel будет: ${manual}`;
      else if (pv.source !== 'unknown' && auto) effectiveOwnerHint = `Для строк без собственника в Excel будет: ${auto}`;
      else if (pv.source === 'unknown') effectiveOwnerHint = 'Выберите собственника вручную — иначе сборка недоступна';
    }
    if (effectiveOwnerHint) tr.title = effectiveOwnerHint;

    tr.appendChild(tdName);
    tr.appendChild(tdAuto);
    tr.appendChild(tdSrc);
    tr.appendChild(tdSize);
    tr.appendChild(tdMan);
    tr.appendChild(tdRemove);
    filesTableBody.appendChild(tr);
  });
  syncBuildButton();
}

function canBuildReport() {
  if (!items.length) return false;
  if (previewInFlight) return false;
  for (const e of items) {
    if (!e.preview) return false;
    if (e.preview.source === 'error') return false;
    if (e.preview.source === 'unknown' && !e.manualOwner) return false;
  }
  return true;
}

function syncBuildButton() {
  if (!buildBtn) return;
  buildBtn.disabled = !canBuildReport();
  if (!items.length) {
    buildBtn.title = '';
    return;
  }
  if (previewInFlight) {
    buildBtn.title = 'Определяем собственников…';
    return;
  }
  const errFile = items.find((e) => e.preview?.source === 'error');
  if (errFile) {
    buildBtn.title = `Удалите или замените файл с ошибкой: ${errFile.file.name}`;
    return;
  }
  if (items.some((e) => !e.preview)) {
    buildBtn.title = 'Дождитесь завершения определения собственников';
    return;
  }
  if (items.some((e) => e.preview.source === 'unknown' && !e.manualOwner)) {
    buildBtn.title = 'Для файлов без автоопределения собственника выберите значение в столбце «Вручную»';
    return;
  }
  buildBtn.title = '';
}

async function runPreview() {
  if (!items.length) {
    stopPreviewProgressUI();
    previewStatus.textContent = '';
    previewInFlight = false;
    syncBuildButton();
    return;
  }
  if (previewInFlight) return;
  const myGen = (previewGen += 1);
  previewInFlight = true;
  previewAbort = new AbortController();
  syncBuildButton();
  const previewTotal = items.length;
  stopPreviewProgressUI();
  if (previewSpinner) {
    previewSpinner.hidden = false;
    previewSpinner.setAttribute('role', 'progressbar');
    previewSpinner.setAttribute('aria-valuemin', '0');
  }
  const stopPreviewTick = runStagedProgress(previewTotal, (k, t) => {
    if (previewStatus) previewStatus.textContent = `Проверка файлов: ${k} из ${t}…`;
    setRingProgress(previewSpinner, k, t);
  });
  previewProgressStop = stopPreviewTick;

  /** Успешно применили ответ к текущему списку и поколению — строку «Готово» ставим в finally, когда previewInFlight уже false. */
  let applyPreviewOk = false;

  const formData = new FormData();
  items.forEach((e) => formData.append('files', e.file));

  try {
    const response = await fetch('/api/preview-owners/', {
      method: 'POST',
      body: formData,
      headers: apiHeaders(),
      credentials: 'same-origin',
      signal: previewAbort.signal,
    });
    if (myGen !== previewGen) return;
    const data = await response.json();
    if (!response.ok) {
      previewStatus.textContent = data.detail || 'Не удалось определить собственников';
      return;
    }
    const list = data.files || [];
    list.forEach((info, i) => {
      if (items[i]) items[i].preview = info;
    });
    applyPreviewOk = myGen === previewGen;
    renderTable();
  } catch (e) {
    if (e.name === 'AbortError' || myGen !== previewGen) return;
    previewStatus.textContent = 'Ошибка запроса предпросмотра';
  } finally {
    previewInFlight = false;
    previewAbort = null;
    stopPreviewTick();
    if (previewProgressStop === stopPreviewTick) previewProgressStop = null;
    if (myGen === previewGen) {
      if (applyPreviewOk && items.length && items.every((e) => e.preview)) {
        setRingProgress(previewSpinner, previewTotal, previewTotal);
        previewStatus.textContent = `Готово: проверено файлов — ${items.length}`;
      }
      if (previewSpinner) previewSpinner.hidden = true;
    }
    syncBuildButton();
  }
}

fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  fileInput.value = '';
});

if (uploadShell) {
  uploadShell.addEventListener('dragenter', (e) => {
    e.preventDefault();
    uploadShell.classList.add('dragover');
  });
  uploadShell.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadShell.classList.add('dragover');
  });
  uploadShell.addEventListener('dragleave', (e) => {
    e.preventDefault();
    const to = e.relatedTarget;
    if (!to || !uploadShell.contains(/** @type {Node} */ (to))) {
      uploadShell.classList.remove('dragover');
    }
  });
  uploadShell.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadShell.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
}

clearBtn.addEventListener('click', () => {
  items = [];
  revokeDownloadObjectUrl();
  previewGen += 1;
  previewAbort?.abort();
  stopPreviewProgressUI();
  stopBuildProgressUI();
  syncUploadView();
  renderTable();
  previewStatus.textContent = '';
  statusCard.classList.add('hidden');
  droppedCard.classList.add('hidden');
  syncBuildButton();
});

buildBtn.addEventListener('click', async () => {
  if (!canBuildReport()) {
    if (!items.length) {
      alert('Не загружены файлы');
      return;
    }
    if (previewInFlight) {
      alert('Дождитесь завершения определения собственников');
      return;
    }
    if (items.some((e) => e.preview?.source === 'error')) {
      alert('Удалите или замените файлы, помеченные ошибкой чтения');
      return;
    }
    alert('Для файлов без автоопределения собственника выберите значение в столбце «Вручную»');
    return;
  }

  const ownerOverrides = items.map((e) => (e.manualOwner ? e.manualOwner : null));

  statusCard.classList.remove('hidden');
  resultMeta.classList.add('hidden');
  downloadBtn.classList.add('hidden');
  revokeDownloadObjectUrl();
  scrollPageToBottomSmooth();

  const buildTotal = items.length;
  stopBuildProgressUI();
  if (buildSpinner) {
    buildSpinner.hidden = false;
    buildSpinner.setAttribute('role', 'progressbar');
    buildSpinner.setAttribute('aria-valuemin', '0');
  }
  const stopBuildTick = runStagedProgress(buildTotal, (k, t) => {
    statusText.textContent = `Идёт обработка: ${k} из ${t} файлов…`;
    setRingProgress(buildSpinner, k, t);
  });
  buildProgressStop = stopBuildTick;
  buildBtn.disabled = true;

  const formData = new FormData();
  items.forEach((e) => formData.append('files', e.file));
  formData.append('owner_overrides', JSON.stringify(ownerOverrides));

  try {
    const response = await fetch('/api/build-report/', {
      method: 'POST',
      body: formData,
      headers: apiHeaders(),
      credentials: 'same-origin',
    });
    const data = await response.json();
    if (!response.ok) {
      statusText.textContent = data.detail || 'Ошибка при формировании итогового файла';
      scrollPageToBottomSmooth();
      return;
    }
    if (!data.file_base64) {
      statusText.textContent = 'Сервер не вернул файл';
      scrollPageToBottomSmooth();
      return;
    }
    const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const blob = base64ToBlob(data.file_base64, xlsxMime);
    revokeDownloadObjectUrl();
    lastDownloadObjectUrl = URL.createObjectURL(blob);
    downloadBtn.dataset.downloadName = data.file_name || 'Итог.xlsx';
    setRingProgress(buildSpinner, buildTotal, buildTotal);
    statusText.textContent = `Обработано файлов: ${buildTotal} из ${buildTotal}. Итог готов — скачайте файл`;
    resultMeta.classList.remove('hidden');
    dupCount.textContent = `Найдено дублей: ${data.duplicates_count}`;
    dropCount.textContent = `Отброшено строк: ${data.dropped_rows_count}`;
    downloadBtn.classList.remove('hidden');

    droppedList.innerHTML = '';
    if (data.dropped_rows_count > 0) {
      droppedCard.classList.remove('hidden');
      data.dropped_rows.forEach((r) => {
        const li = document.createElement('li');
        li.textContent = `${r.file_name}, лист ${r.sheet_name || '?'}, строка ${r.row_number || '?'}: ${r.reason}. ${r.row_preview}`;
        droppedList.appendChild(li);
      });
    } else {
      droppedCard.classList.add('hidden');
    }
    scrollPageToBottomSmooth();
    setTimeout(scrollPageToBottomSmooth, 320);
  } catch {
    statusText.textContent = 'Ошибка при формировании итогового файла';
    scrollPageToBottomSmooth();
  } finally {
    stopBuildTick();
    if (buildProgressStop === stopBuildTick) buildProgressStop = null;
    if (buildSpinner) buildSpinner.hidden = true;
    syncBuildButton();
  }
});

downloadBtn.addEventListener('click', () => {
  if (!lastDownloadObjectUrl) return;
  const name = downloadBtn.dataset.downloadName || 'Итог.xlsx';
  const a = document.createElement('a');
  a.href = lastDownloadObjectUrl;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

toggleDropped.addEventListener('click', () => {
  droppedList.classList.toggle('hidden');
  toggleDropped.textContent = droppedList.classList.contains('hidden')
    ? 'Показать отброшенные строки'
    : 'Скрыть отброшенные строки';
});

syncUploadView();
renderTable();
