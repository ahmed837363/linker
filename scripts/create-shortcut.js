// scripts/create-shortcut.js
// Run with: node scripts/create-shortcut.js
// Creates a Windows desktop shortcut for Linker Pro

const fs = require('fs');
const path = require('path');
const os = require('os');

const desktopDir = path.join(os.homedir(), 'Desktop');
const appUrl = process.env.APP_URL || 'http://localhost:3001';
const shortcutName = 'Linker Pro.url';
const shortcutPath = path.join(desktopDir, shortcutName);

const shortcutContent = `[InternetShortcut]
URL=${appUrl}
IconIndex=0
`;

try {
  fs.writeFileSync(shortcutPath, shortcutContent, 'utf8');
  console.log(`Desktop shortcut created at: ${shortcutPath}`);
  console.log(`Opens: ${appUrl}`);
} catch (err) {
  console.error('Failed to create desktop shortcut:', err.message);
  process.exit(1);
}
