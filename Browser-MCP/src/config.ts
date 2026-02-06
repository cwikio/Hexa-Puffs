export interface ProxyEnv {
  BROWSER_PROXY_ENABLED?: string;
  BROWSER_PROXY_SERVER?: string;
  BROWSER_PROXY_USERNAME?: string;
  BROWSER_PROXY_PASSWORD?: string;
  BROWSER_PROXY_BYPASS?: string;
  BROWSER_ISOLATED?: string;
  [key: string]: string | undefined;
}

export interface ProxyResult {
  useProxy: boolean;
  warning?: string;
}

/** Browser launch config matching @playwright/mcp's Config shape */
export interface BrowserConfig {
  browser?: {
    isolated?: boolean;
    launchOptions?: {
      headless?: boolean;
      proxy?: {
        server: string;
        username?: string;
        password?: string;
        bypass?: string;
      };
    };
  };
}

/**
 * Determine whether proxy should be active based on env vars.
 * Proxy is OFF by default. Requires both BROWSER_PROXY_ENABLED=true AND BROWSER_PROXY_SERVER.
 */
export function resolveProxy(env: ProxyEnv): ProxyResult {
  const enabled = env.BROWSER_PROXY_ENABLED === 'true';
  const hasServer = !!env.BROWSER_PROXY_SERVER;

  if (enabled && !hasServer) {
    return {
      useProxy: false,
      warning: 'BROWSER_PROXY_ENABLED=true but BROWSER_PROXY_SERVER is not set. Starting without proxy.',
    };
  }

  return { useProxy: enabled && hasServer };
}

/**
 * Build the @playwright/mcp Config from environment variables.
 */
export function buildConfig(env: ProxyEnv): BrowserConfig {
  const { useProxy } = resolveProxy(env);

  // true  (default): each session spawns Chrome with a fresh temp profile dir,
  //        so no lock file conflicts between restarts — but cookies/logins are lost.
  // false: reuses a persistent profile at ~/Library/Caches/ms-playwright/mcp-chrome,
  //        keeping cookies and sessions across restarts — but risks SingletonLock
  //        conflicts if the previous Chrome wasn't cleanly shut down.
  const isolated = env.BROWSER_ISOLATED !== 'false';

  return {
    browser: {
      isolated,
      launchOptions: {
        headless: true,
        proxy: useProxy
          ? {
              server: env.BROWSER_PROXY_SERVER!,
              username: env.BROWSER_PROXY_USERNAME,
              password: env.BROWSER_PROXY_PASSWORD,
              bypass: env.BROWSER_PROXY_BYPASS ?? 'localhost,127.0.0.1',
            }
          : undefined,
      },
    },
  };
}
