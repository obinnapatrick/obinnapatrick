// Content script for VendorQ Copilot
// Injects a sidebar iframe into the current page and sets up basic message handling
(function() {
  const SIDEBAR_ID = 'vendorq-copilot-sidebar';

  function injectSidebar() {
    if (document.getElementById(SIDEBAR_ID)) {
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.id = SIDEBAR_ID;
    iframe.src = chrome.runtime.getURL('sidebar.html');
    iframe.style.position = 'fixed';
    iframe.style.top = '0';
    iframe.style.right = '0';
    iframe.style.width = '320px';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.zIndex = '2147483647';
    document.documentElement.appendChild(iframe);
  }

  // Detect DOM ready state
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectSidebar();
  } else {
    window.addEventListener('DOMContentLoaded', injectSidebar);
  }

  // Example communication channel
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'toggle-sidebar') {
      const iframe = document.getElementById(SIDEBAR_ID);
      if (iframe) {
        iframe.style.display = iframe.style.display === 'none' ? 'block' : 'none';
      }
    }
  });
})();
