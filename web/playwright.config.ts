// Minimal config for the draft-pick state-machine tests (web/tests/). Scoped
// deliberately narrow: these tests mock every API call via page.route()/
// routeWebSocket(), so there's no real backend, no auth, no seeded data --
// just the dev server serving the actual React bundle against synthetic
// responses. Not a general-purpose e2e suite (yet); expand testDir/projects
// if that's ever wanted.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    // localhost, not 127.0.0.1 -- confirmed live that Next 16 dev's new
    // allowedDevOrigins check 403s every JS chunk request when the browser's
    // origin is 127.0.0.1 (nothing in next.config.js allowlists it), which
    // silently prevented the app from ever hydrating -- the page loaded a
    // bare HTML shell with no React tree, which is why every locator saw
    // "element(s) not found" rather than a real assertion failure. localhost
    // sidesteps it without touching next.config.js (a real, shared file)
    // for a local-test-only concern.
    baseURL: 'http://localhost:8851',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Starts the real Next.js dev server for the test run -- every request it
  // would normally proxy to the backend gets intercepted client-side before
  // it leaves the browser (see tests/mocks.ts), so the configured proxy
  // target is never actually reached regardless of what it points at.
  webServer: {
    command: 'npm run dev -- -p 8851',
    url: 'http://localhost:8851',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
