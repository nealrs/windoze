// This script runs in the background and is responsible for
// opening the side panel when the user clicks the extension's
// toolbar icon.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
