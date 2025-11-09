# Read Out Loud

A Chrome extension that I have been working on recently — Read Out Loud reads webpage text aloud using the browser's TTS (text-to-speech) capabilities.

## Table of contents
- [Features](#features)
- [Screenshots / Demo](#screenshots--demo)
- [Installation](#installation)
- [Usage](#usage)
- [Extension permissions](#extension-permissions)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)
- [Roadmap & known issues](#roadmap--known-issues)
- [License](#license)
- [Contact](#contact)

## Features
- Can have three modes : Web page , PDF , Images/comicks 
- All three of them uses different libs and methods
- Read selected text aloud.
- Read entire page content aloud.
- Voice selection (available voices depend on the platform/browser).
- Adjustable speech rate and pitch.
- Context menu entry (right-click -> Read Out Loud) for quick access.
- Persistent user settings (voice, rate, pitch).
- Lightweight popup UI for quick controls.

## Screenshots / Demo
Will be added shortly.

## Installation

To try the extension locally (load as an unpacked extension):

1. Clone the repository:
   ```
   git clone https://github.com/abkaswan/Read_out_loud.git
   ```
2. Open Chrome (or another Chromium-based browser) and go to:
   ```
   chrome://extensions
   ```
3. Enable "Developer mode" (top-right).
4. Click "Load unpacked" and select the repository folder (`Read_out_loud`).
5. The extension should appear in your extension list. Pin it to the toolbar for easy access.

If this repository contains a build step (e.g., `npm run build`), run the build command first and load the `dist/` or `build/` folder produced by the build.

## Usage

- Click the extension icon to open the popup. Use the play/pause controls to start/stop reading.
- Highlight any text on a page, then either:
  - Click the extension icon and choose "Read selection", or
  - Right-click the selection and choose "Read Out Loud" (if context menu is available).
- Use the popup settings to choose a voice, adjust rate and pitch.
- To configure or set a keyboard shortcut:
  1. Visit `chrome://extensions/shortcuts`
  2. Find the Read Out Loud extension and assign a shortcut for quick read action.

Notes:
- Available voices vary by operating system and browser.
- Some pages may block scripts or use dynamically loaded content that affects text selection.

## Extension permissions
This extension may request the following permissions (depending on implementation):
- `activeTab` — to operate on the current page.
- `tts` — to use the browser's text-to-speech engine.
- `contextMenus` — to add a right-click menu item.
- `storage` — to persist user preferences (voice, rate, pitch).

Only grant permissions that you trust and that are required for functionality.

## Development

- The extension is implemented with JavaScript, HTML, and CSS.
- Edit the UI or background scripts and reload the extension from `chrome://extensions` to test changes.


Developer tips:
- Use `console.log` in background/popup/content scripts for debugging.
- Open the extension background page (`chrome://extensions` -> "Service worker" or "background page") to view logs and errors.
- Use the DevTools on a target tab to inspect page-side content scripts.

## Testing

- Manual testing: highlight text on a few sample pages and use the popup or context menu to read it.
- Cross-browser: test on Chrome and other Chromium-based browsers. Note that voice sets may vary.
- Edge cases: test pages with heavy scripts, single-page apps, or pages that load content asynchronously.

## Contributing

Contributions are welcome. Suggested workflow:
1. Open an issue to describe a bug or feature request.
2. Create a branch: `git checkout -b feat/my-feature`
3. Make changes, commit with clear messages.
4. Open a Pull Request describing the change and why it helps.

Please follow consistent code style and add brief comments where logic might be unclear. If you want me to add a `CONTRIBUTING.md` or PR template, I can generate one.

## Roadmap & known issues
- Improve voice selection UI to show available voice metadata.
- Add bookmarkable/read-later queue for long articles.
- Add automatic language detection when reading mixed-language pages.
- Known: voice availability is OS/browser dependent; some users may not see all voices.

## License
No license file detected in this repository. I recommend adding a LICENSE file (MIT is a common choice for small projects). If you'd like, I can add an MIT license file for you.

## Contact
Author: @abkaswan  
Feel free to open issues in this repository for bugs, feature requests, or help.
