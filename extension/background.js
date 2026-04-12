/**
 * PostGhost background service worker
 *
 * Handles browser notifications when a ghost post is detected.
 */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "postghost_notify") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: msg.title || "PostGhost",
      message: msg.message || "One of your posts may have been removed.",
      priority: 2,
    });
  }
});
