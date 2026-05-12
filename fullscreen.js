document.getElementById("closeBtn").addEventListener("click", () => {
  window.close();
});

document.getElementById("minimizeBtn").addEventListener("click", async () => {

  const currentWindow = await chrome.windows.getCurrent();

  chrome.windows.update(currentWindow.id, {
    state: "minimized"
  });

});