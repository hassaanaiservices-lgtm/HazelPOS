// Runs before the page paints: remembers the theme, so there is no flash. (A file, not an inline script: the page's security policy only allows scripts from the server itself.)
document.documentElement.classList.add('js');
try { document.documentElement.dataset.theme = localStorage.getItem('pos_theme') === 'light' ? 'light' : 'dark' } catch { document.documentElement.dataset.theme = 'dark' }
