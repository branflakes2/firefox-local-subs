browser.browserAction.onClicked.addListener(() => browser.runtime.openOptionsPage());

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "openOptions") browser.runtime.openOptionsPage();
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
});
