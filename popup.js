import { initializeTabOne } from "./left_tab/tabOne.js";
import { initializeTabTwo } from "./right_tab/tabTwo.js";

window.EXTENSION_CONFIG = {
  popupWidth: 420,
  popupHeight: 520,
  defaultTabId: "tab-one"
};

document.addEventListener("DOMContentLoaded", async () => {
  applyPopupSize();

  await loadTabContent();

  initializeTabs();

  initializeTabOne();
  initializeTabTwo();
});

function applyPopupSize() {
  const { popupWidth, popupHeight } = window.EXTENSION_CONFIG;

  document.documentElement.style.setProperty(
    "--popup-width",
    `${popupWidth}px`
  );

  document.documentElement.style.setProperty(
    "--popup-height",
    `${popupHeight}px`
  );
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
      const targetTabId = button.dataset.tabTarget;
      activateTab(targetTabId);
    });
  });

  activateTab(window.EXTENSION_CONFIG.defaultTabId);
}

function activateTab(tabId) {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === tabId;
    button.classList.toggle("active", isActive);
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.id === tabId;
    panel.classList.toggle("active", isActive);
  });
}