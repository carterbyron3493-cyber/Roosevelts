// Lobbii AI Chatbot — single-line embed
// Usage: <script src="https://demo.lobbii.net/embed.js?client=YOUR_SLUG" async></script>
(function () {
  var s = document.currentScript ||
    (function () {
      var all = document.querySelectorAll('script[src*="embed.js"]');
      return all[all.length - 1];
    })();
  var m = s && s.src.match(/[?&]client=([^&]+)/);
  var slug = m ? decodeURIComponent(m[1]) : 'roosevelts';

  var f = document.createElement('iframe');
  f.id = '__lobbii__';
  f.src = 'https://demo.lobbii.net/?client=' + encodeURIComponent(slug) + '&embed=1';
  f.setAttribute('frameborder', '0');
  f.setAttribute('allow', 'clipboard-write');
  // Closed: wide enough for speech bubble (~250px) + launcher (100px) + margin
  // Open: 500px gives 72px left margin for panel (400px) + right offset (28px) + shadow room
  f.style.cssText = [
    'position:fixed',
    'bottom:0',
    'right:0',
    'width:340px',
    'height:180px',
    'border:none',
    'z-index:2147483647',
    'background:transparent',
    'transition:width 0.35s ease,height 0.35s ease'
  ].join('!important;') + '!important';

  // Wait for DOM to be ready
  function inject() { document.body && document.body.appendChild(f); }
  if (document.body) { inject(); }
  else { document.addEventListener('DOMContentLoaded', inject); }

  // Resize iframe when chat opens/closes
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data !== 'string') return;
    if (e.data.indexOf('lobbii:') !== 0) return;
    var el = document.getElementById('__lobbii__');
    if (!el) return;
    if (e.data === 'lobbii:open') {
      el.style.setProperty('width', '500px', 'important');
      el.style.setProperty('height', '100vh', 'important');
    } else if (e.data === 'lobbii:close') {
      el.style.setProperty('width', '340px', 'important');
      el.style.setProperty('height', '180px', 'important');
    }
  });
})();
