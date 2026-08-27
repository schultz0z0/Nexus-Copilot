import { defineConfig } from '@playwright/test';

const baseURL = process.env.MARKETING_OPS_E2E_BASE_URL ?? 'http://127.0.0.1:8088';
const pictureFake = process.env.PICTURE_HERMES_E2E_FAKE === 'true';
const marketingOpsFake = process.env.MARKETING_OPS_HERMES_E2E_FAKE === 'true';
const fakeWebServer = pictureFake || marketingOpsFake;

export default defineConfig({
  testDir: './e2e',
  outputDir: '../../tmp/playwright-phase-2',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  webServer: fakeWebServer ? {
    command: 'npm run dev -- --host 127.0.0.1 --port 8088',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
      VITE_SUPABASE_ANON_KEY: 'picture-e2e-anon-key',
      VITE_CHATBOT_PROXY_URL: 'http://127.0.0.1:18081',
      NEXT_PUBLIC_CHATBOT_PROXY_URL: 'http://127.0.0.1:18081',
      VITE_MARKETING_OPS_URL: 'http://127.0.0.1:19091',
      VITE_MARKETING_OPS_ENABLED: 'true',
      VITE_MARKETING_OPS_READ: 'true',
      VITE_MARKETING_OPS_WRITE: 'true',
      VITE_MARKETING_OPS_APPROVALS: 'true',
      VITE_CHAT_STREAM_FILE_HOSTS: '127.0.0.1,localhost',
    },
  } : undefined,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: false
  },
  projects: [
    {
      name: 'desktop-chromium',
      grepInvert: /@mobile/,
      use: { viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'mobile-chromium',
      grep: /@mobile/,
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      }
    }
  ]
});
