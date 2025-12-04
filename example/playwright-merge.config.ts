import { defineConfig } from '@playwright/test';

// Config used for merging blob reports from multiple machines
export default defineConfig({
  reporter: [
    ['../dist/smart-reporter.js', {
      outputFile: 'blob-reports/merged/smart-report.html',
      historyFile: 'blob-reports/merged/test-history.json',
    }],
  ],
});

