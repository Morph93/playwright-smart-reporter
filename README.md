# playwright-smart-reporter

An intelligent Playwright HTML reporter with AI-powered failure analysis, flakiness detection, and performance regression alerts.

## Features

- **AI Failure Analysis** - Get AI-powered suggestions to fix failing tests (Claude/OpenAI)
- **Flakiness Detection** - Tracks test history to identify unreliable tests
- **Performance Regression Alerts** - Warns when tests get significantly slower
- **Beautiful HTML Reports** - Modern UI with Tailwind CSS

## Installation

```bash
npm install playwright-smart-reporter
```

## Usage

Add to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['playwright-smart-reporter', {
      outputFile: 'smart-report.html',  // optional
    }],
  ],
});
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `outputFile` | `smart-report.html` | Path for the HTML report |
| `historyFile` | `test-history.json` | Path for test history storage |
| `maxHistoryRuns` | `10` | Number of runs to keep in history |
| `performanceThreshold` | `0.2` | Threshold for performance regression (20%) |

### AI Analysis

To enable AI-powered failure analysis, set one of these environment variables:

```bash
# Using Anthropic Claude
export ANTHROPIC_API_KEY=your-api-key

# OR using OpenAI
export OPENAI_API_KEY=your-api-key
```

The reporter will automatically analyze failures and provide fix suggestions in the report.

## Report Features

### Summary Dashboard
- Pass/fail/skip counts
- Flaky test count
- Slow test count
- Total duration

### Flakiness Indicators
- 🟢 **Stable** (<10% failure rate)
- 🟡 **Unstable** (10-30% failure rate)
- 🔴 **Flaky** (>30% failure rate)
- ⚪ **New** (no history yet)

### Performance Trends
- ↑ **Regression** - Test is slower than average
- ↓ **Improved** - Test is faster than average
- → **Stable** - Test is within normal range

### Filtering
Filter tests by status: All, Passed, Failed, Skipped, Flaky, or Slow

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run demo tests
npm run test:demo
```

## License

MIT
