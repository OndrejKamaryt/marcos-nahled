// Phone menu: close the panel once a link is chosen, and on Escape.
// The menu is a <details> element and works without this file; this only stops it covering the page after a jump.
(function () {
  var menu = document.querySelector('.menu');
  if (!menu) return;
  var summary = menu.querySelector('summary');
  menu.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('.menu__panel a') : null;
    if (link) menu.open = false;
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      summary.focus();
    }
  });
})();
