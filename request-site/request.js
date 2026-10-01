const form = document.querySelector('#request-form');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const errorText = document.querySelector('#error-text');
const retry = document.querySelector('#retry');
const success = document.querySelector('#success');
const submit = document.querySelector('#submit');

function showError(message, canRetry) {
  errorText.textContent = message;
  error.hidden = false;
  retry.hidden = !canRetry;
}

async function check() {
  status.hidden = false;
  form.hidden = true;
  error.hidden = true;
  try {
    const response = await fetch('/api/song-requests', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Chưa kết nối được trang yêu cầu.');
    form.hidden = false;
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : 'Chưa kết nối được trang yêu cầu.', true);
  } finally {
    status.hidden = true;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submit.disabled = true;
  submit.textContent = 'Đang gửi…';
  error.hidden = true;
  try {
    const body = { title: form.elements.title.value, artist: form.elements.artist.value };
    const response = await fetch('/api/song-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Chưa gửi được yêu cầu.');
    const saved = data.request;
    document.querySelector('#saved-title').textContent = saved.title;
    document.querySelector('#saved-artist').textContent = saved.artist;
    document.querySelector('#saved-time').textContent = new Date(saved.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    form.hidden = true;
    success.hidden = false;
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.', false);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Gửi yêu cầu bài hát';
  }
});

document.querySelector('#another').addEventListener('click', () => {
  form.reset();
  success.hidden = true;
  form.hidden = false;
  document.querySelector('#title').focus();
});
retry.addEventListener('click', check);
void check();
