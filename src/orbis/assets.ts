// One build can live at the root or a dedicated HTTPS subdirectory.
declare const __APP_BASE__: string
export const appBase = typeof __APP_BASE__ === 'string' ? __APP_BASE__ : '/'
export const assetUrl = (path: string) => appBase + path.replace(/^\/+/, '')
