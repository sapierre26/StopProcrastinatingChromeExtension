/*
  Background service worker.

  This file is for extension-level behavior that should not live inside
  the popup UI.

  Good future uses:
  - Listen for extension install/update events
  - Handle messages from popup.js
  - Work with chrome.tabs, chrome.storage, chrome.scripting, alarms, etc.
  - Run logic that should continue independently of the popup being open

  Important:
  Because manifest.json defines action.default_popup, clicking the toolbar icon
  opens popup.html. The action.onClicked event is not fired for that click.
*/

chrome.runtime.onInstalled.addListener(() => {
  console.log("Two Tab Popup Framework installed.");
});

/*
  Example future message listener.

  popup.js can later call:

  chrome.runtime.sendMessage({
    type: "EXAMPLE_MESSAGE",
    payload: {}
  });

*/
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  switch (message.type) {
    case "EXAMPLE_MESSAGE": {
      console.log("Received EXAMPLE_MESSAGE", message.payload);

      sendResponse({
        ok: true,
        message: "Background received the message."
      });

      break;
    }

    default: {
      console.warn("Unknown message type:", message.type);

      sendResponse({
        ok: false,
        message: "Unknown message type."
      });
    }
  }

  /*
    Return true only if you plan to respond asynchronously.
    This framework responds synchronously, so no return value is needed.
  */
});