/**
 * PostGhost background service worker
 *
 * - Browser notifications when a ghost post is detected
 * - Extension icon badge showing ghost count
 */

let ghostCount = 0;

function updateBadge() {
  if (ghostCount > 0) {
    chrome.action.setBadgeText({ text: String(ghostCount) });
    chrome.action.setBadgeBackgroundColor({ color: "#cf222e" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "postghost_notify") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: msg.title || "PostGhost",
      message: msg.message || "One of your posts may have been removed.",
      priority: 2,
    });

    ghostCount++;
    updateBadge();
  }

  if (msg.type === "postghost_badge_update") {
    ghostCount = msg.ghostCount || 0;
    updateBadge();
  }
});
