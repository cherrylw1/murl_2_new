import { MurlApi } from '../../preload/types.js';

declare global {
  interface Window {
    murl: MurlApi;
  }
}
export {};
