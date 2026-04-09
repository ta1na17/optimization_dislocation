const ownersEl = document.getElementById('owners-json');
const CANONICAL_OWNERS = ownersEl ? JSON.parse(ownersEl.textContent || '[]') : [];

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
  panel.setAttribute('role', 'listbox');
  panel.id = `owner-dd-panel-${index}`;

  trigger.setAttribute('aria-controls', panel.id);

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
      panel.querySelectorAll('.owner-dd__option').forEach((b) => {
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
    panel.appendChild(btn);
  });

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
  previewStatus.textContent = 'Определяем собственников по файлам…';

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
    previewStatus.textContent = `Готово: проверено файлов — ${list.length}`;
    renderTable();
  } catch (e) {
    if (e.name === 'AbortError' || myGen !== previewGen) return;
    previewStatus.textContent = 'Ошибка запроса предпросмотра';
  } finally {
    previewInFlight = false;
    previewAbort = null;
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
  statusText.textContent = 'Идет обработка…';
  scrollPageToBottomSmooth();

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
    statusText.textContent = 'Итог готов — скачайте файл';
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
