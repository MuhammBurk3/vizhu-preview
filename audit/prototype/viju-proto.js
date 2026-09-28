// Прототип «после»: правки, которые в настоящей выкладке делаются в текстах и компонентах.
(function () {
  'use strict';
  var HUB = {
    'development-diary-launcher-title': ['Личное', 'Записи состояний дня и разбор ВИЖУ'],
    'development-tarot-encyclopedia-launcher-title': ['Энциклопедия', 'Значения карт и расклады'],
    'med': ['Практики', 'Короткие медитации для спокойствия и фокуса']
  };
  function fix() {
    // «Развитие»: у карточки есть подпись и описание, как в «О тебе»
    document.querySelectorAll('.development-hub__diary-launcher').forEach(function (card) {
      if (card.querySelector('.proto-hub-meta')) return;
      var t = card.querySelector('.development-hub__launcher-title');
      var info = HUB[t && t.id] || (card.classList.contains('med-launcher') ? HUB.med : null);
      if (!info) return;
      var m = document.createElement('span'); m.className = 'proto-hub-meta';
      m.innerHTML = '<i>' + info[0] + '</i><strong>' + t.textContent.trim().charAt(0) + t.textContent.trim().slice(1).toLowerCase() + '</strong><span>' + info[1] + '</span><b>Открыть ›</b>';
      card.appendChild(m);
    });
    // Русский регистр в кнопках
    document.querySelectorAll('button, a').forEach(function (b) {
      if (b.children.length === 0 && /Войти или Зарегистрироваться/.test(b.textContent)) b.textContent = 'Войти или зарегистрироваться';
    });
    // Карта дня для гостя: вместо пустоты — одна строка о смысле карты
    var copy = document.querySelector('.admin-day-summary__copy-text');
    if (copy && !copy.textContent.trim()) { copy.textContent = 'Подсказка, на что опереться сегодня. Полное толкование — после входа.'; copy.style.webkitLineClamp = '3'; }
    // Астрология: не показываем ошибку, пока человек ничего не отправил
    document.querySelectorAll('[class*="border-rose-500"]').forEach(function (e) { if (!window.__protoSubmitted) e.classList.add('proto-hidden'); });
    // Квадрат: лунный оттенок вместо голубого, легенда цветов, спокойный прочерк
    document.querySelectorAll('.pythagoras-tone-blue .value').forEach(function (v) { v.classList.add('proto-num-blue'); });
    document.querySelectorAll('.psychomatrix-cell .value').forEach(function (v) { if (/^[-–]$/.test(v.textContent.trim())) { v.textContent = '—'; v.style.opacity = '0.45'; } });
    var grid = document.querySelector('.psychomatrix-grid--overview');
    if (grid && !document.querySelector('.proto-legend')) {
      var lg = document.createElement('div'); lg.className = 'proto-legend';
      lg.innerHTML = '<span><i style="background:#e4bf6c"></i>сильная сторона</span><span><i style="background:#a9b8ec"></i>зона роста</span>';
      grid.parentNode.insertBefore(lg, grid);
    }
    // Диалог для гостя: пример разговора
    var gate = document.querySelector('.glass-card.rounded-3xl.p-8 > .max-w-sm');
    if (gate && gate.querySelector('.btn-gold') && !document.querySelector('.proto-chat')) {
      var chat = document.createElement('div'); chat.className = 'proto-chat';
      chat.innerHTML = '<small>Пример разговора</small><p class="me">Почему мне сложно доводить дела до конца?</p><p class="viju">Давай посмотрим на твою матрицу и день. Расскажи, какое дело сейчас зависло — разберём, где уходит энергия.</p>';
      gate.parentNode.insertBefore(chat, gate);
    }
    // Заголовок раздела меньше заголовка страницы
    document.querySelectorAll('h2.heading-page').forEach(function (h) { h.style.setProperty('font-size', '24px', 'important'); h.style.setProperty('font-weight', '400', 'important'); });
    // Тире вместо дефиса между словами
    document.querySelectorAll('main p, main div, main span').forEach(function (el) {
      el.childNodes.forEach(function (n) { if (n.nodeType === 3 && / - /.test(n.textContent)) n.textContent = n.textContent.replace(/ - /g, ' — '); });
    });
  }
  new MutationObserver(function () { clearTimeout(fix.t); fix.t = setTimeout(fix, 120); }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(fix, 500);
})();
