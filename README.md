# LinkedIn Fake Post Detector Chrome Extension

A powerful Chrome extension that automatically detects fake and fraudulent job postings on LinkedIn by analyzing recruiter posting patterns.

## 🎯 Features

- **Automatic Detection**: Scans LinkedIn posts automatically and identifies suspicious patterns
- **Fake Post Detection**: Detects fake posts when a recruiter posts 5+ hiring posts within 5 days
- **Manual Analysis**: Press `Ctrl` (or `Cmd` on Mac) + Click on any post to analyze it manually
- **Personalized Warnings**: Shows detailed, personalized messages explaining why a post is fake
- **Risk Scoring**: Assigns risk scores to recruiters based on their posting behavior
- **Visual Badges**: Displays color-coded badges on posts (🚨 High Risk, ⚠️ Suspicious, ✅ Genuine)
- **Statistics Dashboard**: View tracked recruiters and their risk levels in the extension popup

## 🚀 Installation

1. **Download/Clone** this repository
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** (toggle in top right)
4. **Click "Load unpacked"** and select the extension directory
5. The extension is now installed!

## 📖 How to Use

### Automatic Scanning
- Simply browse LinkedIn as normal
- The extension automatically scans posts on your feed
- Fake or suspicious posts will show warning badges automatically

### Manual Analysis
1. Navigate to any LinkedIn page with posts
2. Press `Ctrl` (Windows/Linux) or `Cmd` (Mac) + Click on any post
3. The extension will analyze the post and show a detailed warning if it's fake

### View Statistics
1. Click the extension icon in your Chrome toolbar
2. View statistics about tracked recruiters
3. See risk levels and posting patterns

## 🔍 Detection Criteria

The extension detects fake posts based on:

1. **Fake Pattern Detection** (Primary):
   - 5+ hiring posts within 5 days → **FAKE POST DETECTED**

2. **Suspicious Patterns**:
   - 3+ posts in a single day
   - 5+ different roles posted
   - Same role posted 2+ times
   - 10+ total job posts observed

## ⚠️ Warning Messages

When a fake post is detected, you'll see:

- **🚨 FAKE POST DETECTED - DO NOT APPLY**
- Detailed explanation of why it's fake
- Personalized message with specific counts
- Recommendations to avoid applying
- Link to view the recruiter's profile

## 🛡️ Why This Matters

Fake job postings are used to:
- Collect resumes and personal information
- Phish for credentials
- Scam job seekers
- Harvest contact information for spam

This extension helps protect you by identifying these patterns before you apply.

## 🔧 Technical Details

- **Manifest Version**: 3
- **Permissions**: 
  - `activeTab`: To interact with LinkedIn pages
  - `storage`: To save recruiter data
  - `scripting`: To inject content scripts
  - `tabs`: To manage tabs

## 📝 Files Structure

```
CheckOnce/
├── manifest.json       # Extension manifest
├── background.js       # Background service worker
├── content.js          # Main content script (post detection logic)
├── content.css         # Styles for badges and warnings
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic
├── icons/              # Extension icons
└── README.md           # This file
```

## 🐛 Troubleshooting

**Extension not working?**
- Make sure you're on a LinkedIn page (linkedin.com)
- Refresh the LinkedIn page
- Click the extension icon and press "Scan This Page Now"

**Badges not showing?**
- Wait a few seconds for the page to load
- Scroll down to trigger scanning
- Try manually analyzing a post (Ctrl+Click)

**Data not saving?**
- Check Chrome storage permissions
- Clear data and try again using the "Clear" button in popup

## 📄 License

This project is open source and available for personal and commercial use.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## ⚡ Updates

- **v1.0.0**: Initial release with fake post detection
- Enhanced with 5+ posts in 5 days detection
- Added personalized warning messages
- Improved UI with fake post badges

---

**Stay Safe!** 🛡️ Always verify job postings through official company websites before applying.

