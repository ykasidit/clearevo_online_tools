// Ambient declarations for the type check in JS mode (tsc --checkJs, test/batray_typecheck.test.js): the browser
// APIs BatRay uses that TypeScript's own DOM library does not know. Not deployed; the editor picks it up through
// tsconfig.json.
interface Navigator {
  bluetooth: any;
  connection: any;
  userAgentData: any;
  brave: any;
  deviceMemory: number;
  getBattery(): Promise<any>;
}
interface Performance {
  memory: any;
  measureUserAgentSpecificMemory(): Promise<any>;
}
interface Document { wasDiscarded: boolean; }
interface Window {
  __batrayTest: any;
  __onGCastApiAvailable: any;
  __batrayBoot: any;
  __batrayStarted: any;
  cast: any;
  chrome: any;
}
interface HTMLElement { dataset: DOMStringMap; }
declare var chrome: any;
declare var cast: any;
declare var qrcode: any;
declare var uPlot: any;
declare class BluetoothDevice {}
declare function importScripts(...urls: string[]): void;
