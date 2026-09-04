declare module 'qrcode/lib/browser.js' {
  interface QrModules {
    readonly size: number
    get(row: number, column: number): number
  }

  interface QrCode {
    readonly modules: QrModules
  }

  const QRCode: {
    create(value: string, options?: { readonly errorCorrectionLevel?: 'M' }): QrCode
  }

  export default QRCode
}
