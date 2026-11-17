// Keeps the POS window on the POS. Only web and phone links may leave it, and only into the normal browser / phone app:
// a link such as file:///… or another program's address must never be launched from here (shell.openExternal would run it).
// localUrl: () => the POS address, openExternal: (url) => hands a link to the system.
module.exports = function hardenWindow(win, localUrl, openExternal) {
  const safeLink = u => { try { return ['https:', 'http:', 'tel:'].includes(new URL(u).protocol); } catch { return false; } };
  win.webContents.setWindowOpenHandler(({ url }) => { if (safeLink(url)) openExternal(url); return { action: 'deny' }; });
  // The POS window itself never leaves the POS: a link to another site opens in the browser instead
  win.webContents.on('will-navigate', (e, url) => {
    let same = false; try { same = new URL(url).origin === new URL(localUrl()).origin; } catch { /* not a link */ }
    if (!same) { e.preventDefault(); if (safeLink(url)) openExternal(url); }
  });
  win.webContents.on('will-redirect', (e, url) => { try { if (new URL(url).origin !== new URL(localUrl()).origin) e.preventDefault(); } catch { e.preventDefault(); } });
  return safeLink;
};
