// Background service worker 

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ recruiterData: {} });
  console.log('LinkedIn Fake Post Detector installed');
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'analyzeProfile') {
    // This could be used to fetch profile data if needed
    // For now, the content script handles everything
    sendResponse({ success: true });
  }
  
  if (message.action === 'getProfileData') {
    chrome.storage.local.get(['recruiterData'], (result) => {
      const data = result.recruiterData || {};
      const profileData = data[message.profileUrl] || null;
      sendResponse({ data: profileData });
    });
    return true; // Keep channel open for async response
  }
  
  return true;
});

// Note: Content script is auto-injected via manifest.json
// We don't need to manually inject it here to avoid duplicate injections
