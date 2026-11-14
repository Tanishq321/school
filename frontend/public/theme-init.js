// Apply the theme before first paint (external file so the CSP can forbid inline scripts).
// Default: follow the device (light by day, dark at night if the OS switches). A saved 'light' or
// 'dark' is an explicit choice that overrides the device.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('vp.theme') || 'system';
  } catch (e) {
    /* storage blocked */
  }
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1628' : '#f4f1ea');
})();
