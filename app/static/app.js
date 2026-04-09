const fileInput = document.getElementById('fileInput');
const filesList = document.getElementById('filesList');
const buildBtn = document.getElementById('buildBtn');
const clearBtn = document.getElementById('clearBtn');
const dropZone = document.getElementById('dropZone');
const statusCard = document.getElementById('statusCard');
const statusText = document.getElementById('statusText');
const resultMeta = document.getElementById('resultMeta');
const dupCount = document.getElementById('dupCount');
const dropCount = document.getElementById('dropCount');
const downloadBtn = document.getElementById('downloadBtn');
const droppedCard = document.getElementById('droppedCard');
const droppedList = document.getElementById('droppedList');
const toggleDropped = document.getElementById('toggleDropped');

let files = [];
let currentResultId = null;

function renderFiles() {
  filesList.innerHTML = '';
  files.forEach((f) => {
    const li = document.createElement('li');
    li.textContent = `${f.name} (${Math.round(f.size / 1024)} КБ) - готов`;
    filesList.appendChild(li);
  });
}

fileInput.addEventListener('change', (e) => {
  files = [...files, ...Array.from(e.target.files)];
  renderFiles();
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((evt) => dropZone.addEventListener(evt, (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach((evt) => dropZone.addEventListener(evt, (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
}));
dropZone.addEventListener('drop', (e) => {
  files = [...files, ...Array.from(e.dataTransfer.files)];
  renderFiles();
});

clearBtn.addEventListener('click', () => {
  files = [];
  renderFiles();
  statusCard.classList.add('hidden');
  droppedCard.classList.add('hidden');
});

buildBtn.addEventListener('click', async () => {
  if (files.length === 0) {
    alert('Не загружены файлы');
    return;
  }

  const invalid = files.find((f) => !(f.name.endsWith('.xls') || f.name.endsWith('.xlsx')));
  if (invalid) {
    alert('Формат файла не поддерживается');
    return;
  }

  statusCard.classList.remove('hidden');
  resultMeta.classList.add('hidden');
  downloadBtn.classList.add('hidden');
  statusText.textContent = 'Идет обработка...';

  const formData = new FormData();
  files.forEach((f) => formData.append('files', f));

  try {
    const response = await fetch('/build-report', { method: 'POST', body: formData });
    const data = await response.json();

    if (!response.ok) {
      statusText.textContent = data.detail || 'Ошибка при формировании итогового файла';
      return;
    }

    currentResultId = data.result_id;
    statusText.textContent = 'Итог готов';
    resultMeta.classList.remove('hidden');
    dupCount.textContent = `Найдено дублей: ${data.duplicates_count}`;
    dropCount.textContent = `Отброшено строк: ${data.dropped_rows_count}`;
    downloadBtn.classList.remove('hidden');

    if (data.dropped_rows_count > 0) {
      droppedCard.classList.remove('hidden');
      droppedList.innerHTML = '';
      data.dropped_rows.forEach((r) => {
        const li = document.createElement('li');
        const rowNo = r.row_number ? `строка ${r.row_number}` : 'строка ?';
        const sheet = r.sheet_name ? `лист ${r.sheet_name}` : 'лист ?';
        li.textContent = `${r.file_name}, ${sheet}, ${rowNo}: ${r.reason}. ${r.row_preview}`;
        droppedList.appendChild(li);
      });
    }
  } catch {
    statusText.textContent = 'Ошибка при формировании итогового файла';
  }
});

downloadBtn.addEventListener('click', () => {
  if (!currentResultId) return;
  window.location.href = `/download/${currentResultId}`;
});

toggleDropped.addEventListener('click', () => {
  droppedList.classList.toggle('hidden');
  toggleDropped.textContent = droppedList.classList.contains('hidden') ? 'Показать отброшенные строки' : 'Скрыть отброшенные строки';
});
