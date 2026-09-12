import { existsSync } from 'node:fs'

export function deviceBrowserHeadless(): boolean {
  const configured = process.env['DSH_DEVICE_BROWSER_HEADLESS']?.trim().toLowerCase()
  return configured === '1' || configured === 'true'
}

export function installedBrowserExecutable(): string | undefined {
  const configured = process.env['DSH_DEVICE_BROWSER_EXECUTABLE']
  if (configured !== undefined && configured.trim() !== '') return configured
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  return candidates.find(candidate => existsSync(candidate))
}
