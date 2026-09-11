import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceAction, LocalConfirmator } from './protocol.ts'

const execute = promisify(execFile)
type DialogRunner = (args: string[]) => Promise<{ stdout: string }>

function actionDescription(action: DeviceAction): string {
  switch (action.operation.kind) {
    case 'browser.click': return 'DSH 请求操作浏览器：点击页面元素'
    case 'browser.fill': return 'DSH 请求操作浏览器：填写页面内容'
    case 'browser.open': return 'DSH 请求操作浏览器：打开网页'
    default: return 'DSH 请求操作此电脑'
  }
}

export class MacOSConfirmator implements LocalConfirmator {
  constructor(private readonly run: DialogRunner = async args => execute('osascript', args)) {}

  async confirm(action: DeviceAction): Promise<boolean> {
    const script = `on run argv
      display dialog (item 1 of argv) with title "DSH Device Agent" buttons {"拒绝", "允许"} default button "允许" cancel button "拒绝"
    end run`
    try {
      const result = await this.run(['-e', script, actionDescription(action)])
      return result.stdout.includes('button returned:允许')
    } catch {
      return false
    }
  }
}
