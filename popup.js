import { initializeTabOne } from "./left_tab/tabOne.js";
import { initializeTabTwo } from "./right_tab/tabTwo.js";

window.EXTENSION_CONFIG = {
  popupWidth: 420,
  popupHeight: 560,
  defaultTabId: "tab-one"
};

document.addEventListener("DOMContentLoaded", async () => {
  applyPopupSize();

  try {
    await loadTabContent();
    initializeTabs();
    initializeTabOne(document.querySelector("#tab-one"));
    initializeTabTwo(document.querySelector("#tab-two"));
  } catch (error) {
    console.error("Popup failed to initialize", error);
    document.body.textContent = "The popup failed to load. Open the extension console for details.";
  }
});

document.getElementById("expandBtn").addEventListener("click", async () => {

  chrome.windows.create({
    url: chrome.runtime.getURL("expanded.html"),
    type: "popup",

    width: 1200,
    height: 900,

    focused: true
  });

});

function applyPopupSize() {
  const { popupWidth, popupHeight } = window.EXTENSION_CONFIG;
  document.documentElement.style.setProperty("--popup-width", `${popupWidth}px`);
  document.documentElement.style.setProperty("--popup-height", `${popupHeight}px`);
}

async function loadTabContent() {
  await loadHtmlIntoElement("tab-one", "left_tab/tabOne.html");
  await loadHtmlIntoElement("tab-two", "right_tab/tabTwo.html");
}

async function loadHtmlIntoElement(elementId, htmlFilePath) {
  const container = document.getElementById(elementId);

  if (!container) {
    throw new Error(`Could not find container: ${elementId}`);
  }

  const response = await fetch(chrome.runtime.getURL(htmlFilePath));

  if (!response.ok) {
    throw new Error(`Could not load ${htmlFilePath}`);
  }

  container.innerHTML = await response.text();
}

function initializeTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tabTarget);
    });
  });

  activateTab(window.EXTENSION_CONFIG.defaultTabId);
}

function activateTab(tabId) {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tabTarget === tabId);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
}
