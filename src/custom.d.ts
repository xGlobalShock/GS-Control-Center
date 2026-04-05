declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.jpeg' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}

declare module '*.gif' {
  const value: string;
  export default value;
}

// Style imports (allow side-effect or module CSS imports)
declare module '*.css';
declare module '*.scss';
declare module '*.less';
declare module '*.module.css';
declare module '*.module.scss';

// Minimal NodeJS type fallbacks to avoid needing @types/node in dev envs
declare namespace NodeJS {
  interface Timeout {}
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
}

interface Window {
  __WDEBLOAT_PRELOADED__?: any;
  electron: {
    getAppPath: () => Promise<string>;
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      send: (channel: string, ...args: any[]) => void;
      on: (channel: string, func: (...args: any[]) => void) => (() => void);
      once: (channel: string, func: (...args: any[]) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
    windowControls: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximizedChange: (callback: (isMaximized: boolean) => void) => (() => void);
    };
    gpu: {
      getStatus: () => Promise<any>;
      onStatusChanged: (callback: (data: any) => void) => (() => void);
    };
    updater: {
      checkForUpdates: () => Promise<any>;
      downloadUpdate: () => Promise<any>;
      cancelUpdate: () => Promise<any>;
      installUpdate: () => Promise<void>;
      getVersion: () => Promise<string>;
      onStatus: (callback: (data: any) => void) => (() => void);
    };
  };
}

// Allow importing the `ogl` package without TypeScript types in this repo
declare module 'ogl';
