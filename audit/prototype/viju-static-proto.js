// Прототип: шапка приложения на статичных страницах и нормальный регистр в кнопках.
(function () {
  'use strict';
  var h = document.createElement('header');
  h.className = 'vs-header';
  h.innerHTML = '<a class="vs-header__mark" href="/">ВИЖУ</a>' +
    '<svg class="vs-header__eyes" viewBox="0 0 84 26" aria-hidden="true"><defs><radialGradient id="vsI"><stop offset="0" stop-color="#2a1604"/><stop offset=".35" stop-color="#c98a2e"/><stop offset="1" stop-color="#6b4210"/></radialGradient></defs>' +
    '<g><path d="M3 13 Q20 1 37 13 Q20 25 3 13Z" fill="#ece5d7"/><circle cx="20" cy="13" r="7" fill="url(#vsI)"/><circle cx="20" cy="13" r="3" fill="#07060a"/><path d="M3 13 Q20 0 37 13 Q20 5 3 13Z" fill="#4c2f9e"/></g>' +
    '<g transform="translate(44 0)"><path d="M3 13 Q20 1 37 13 Q20 25 3 13Z" fill="#ece5d7"/><circle cx="20" cy="13" r="7" fill="url(#vsI)"/><circle cx="20" cy="13" r="3" fill="#07060a"/><path d="M3 13 Q20 0 37 13 Q20 5 3 13Z" fill="#4c2f9e"/></g></svg>' +
    '<a class="vs-header__cta" href="/">Мой расчёт</a>';
  document.body.insertBefore(h, document.body.firstChild);
  // Русский текст не пишут «Каждое Слово С Большой Буквы».
  var keep = /^(ВИЖУ|Вижу|Таро|Пифагора|Матрица|Аркан)$/;
  document.querySelectorAll('.cta').forEach(function (el) {
    if (el.children.length) return;
    var words = el.textContent.split(' ');
    el.textContent = words.map(function (w, i) { return i === 0 || keep.test(w) || /^[A-ZА-ЯЁ0-9]+$/.test(w) ? w : w.charAt(0).toLowerCase() + w.slice(1); }).join(' ');
  });
  // Тире вместо дефиса между словами.
  document.querySelectorAll('h1, h2, h3, p, li').forEach(function (el) {
    el.childNodes.forEach(function (n) { if (n.nodeType === 3) n.textContent = n.textContent.replace(/ - /g, ' — '); });
  });
})();
