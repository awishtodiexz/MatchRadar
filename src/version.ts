import pkg from '../package.json';

/** Single source for the displayed version; release builds verify the Rust/Tauri copies. */
export const APP_VERSION: string = pkg.version;
