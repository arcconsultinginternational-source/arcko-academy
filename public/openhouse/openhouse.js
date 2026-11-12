// Date selection helps families plan; availability is confirmed by Arcko on LINE.
document.querySelectorAll('[data-day]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-day]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.getElementById('selected-day').textContent = `${button.dataset.day} · 2026`;
  });
});
// Optional first-party hook. No analytics provider or tracking is loaded here.
document.querySelectorAll('[data-placement]').forEach(link => {
  link.addEventListener('click', () => document.dispatchEvent(new CustomEvent('arcko:openhouse-line-click', {
    detail: { placement: link.dataset.placement, language: document.documentElement.lang }
  })));
});
