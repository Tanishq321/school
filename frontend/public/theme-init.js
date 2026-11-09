// Apply the saved theme before first paint to avoid a flash (external file so CSP can forbid inline scripts).
try {
  var t = localStorage.getItem('vp.theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
