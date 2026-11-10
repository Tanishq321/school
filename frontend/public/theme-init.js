// Apply the saved theme before first paint to avoid a flash (external file so CSP can forbid inline scripts).
// The house is dark by default (midnight lacquer); light is an explicit choice.
try {
  document.documentElement.classList.toggle('dark', localStorage.getItem('vp.theme') !== 'light');
} catch (e) {
  /* storage blocked: stay dark */
}
