// esbuild injects these via --define; tsx/dev falls back to package defaults.
declare const __VERSION__: string;
declare const __OWNER__: string;
declare const __REPO__: string;
export const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';
export const OWNER: string = typeof __OWNER__ !== 'undefined' ? __OWNER__ : 'jason-pharos';
export const REPO: string = typeof __REPO__ !== 'undefined' ? __REPO__ : 'pharos-rwa-skill';
