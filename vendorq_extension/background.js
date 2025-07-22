// Background service worker for VendorQ Copilot
chrome.runtime.onInstalled.addListener(() => {
  console.log('VendorQ Copilot installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received:', message);
  // Placeholder for handling messages from content or sidebar
  sendResponse({ack: true});
});
