import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface SmartReporterOptions {
  outputFile?: string;
  historyFile?: string;
  maxHistoryRuns?: number;
  performanceThreshold?: number;
}

interface TestHistoryEntry {
  passed: boolean;
  duration: number;
  timestamp: string;
}

interface TestHistory {
  [testId: string]: TestHistoryEntry[];
}

interface TestResultData {
  testId: string;
  title: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: string;
  errorStack?: string;
  retry: number;
  flakinessScore?: number;
  flakinessIndicator?: string;
  performanceTrend?: string;
  averageDuration?: number;
  aiSuggestion?: string;
}

// ============================================================================
// Smart Reporter
// ============================================================================

class SmartReporter implements Reporter {
  private options: Required<SmartReporterOptions>;
  private results: TestResultData[] = [];
  private history: TestHistory = {};
  private startTime: number = 0;
  private outputDir: string = '';

  constructor(options: SmartReporterOptions = {}) {
    this.options = {
      outputFile: options.outputFile ?? 'smart-report.html',
      historyFile: options.historyFile ?? 'test-history.json',
      maxHistoryRuns: options.maxHistoryRuns ?? 10,
      performanceThreshold: options.performanceThreshold ?? 0.2,
    };
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.startTime = Date.now();
    this.outputDir = config.rootDir;
    this.loadHistory();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const testId = this.getTestId(test);
    const file = path.relative(this.outputDir, test.location.file);

    const testData: TestResultData = {
      testId,
      title: test.title,
      file,
      status: result.status,
      duration: result.duration,
      retry: result.retry,
    };

    if (result.status === 'failed' || result.status === 'timedOut') {
      const error = result.errors[0];
      if (error) {
        testData.error = error.message || 'Unknown error';
        testData.errorStack = error.stack;
      }
    }

    // Calculate flakiness
    const historyEntries = this.history[testId] || [];
    if (historyEntries.length > 0) {
      const failures = historyEntries.filter((e) => !e.passed).length;
      const flakinessScore = failures / historyEntries.length;
      testData.flakinessScore = flakinessScore;
      testData.flakinessIndicator = this.getFlakinessIndicator(flakinessScore);

      // Calculate performance trend
      const avgDuration =
        historyEntries.reduce((sum, e) => sum + e.duration, 0) /
        historyEntries.length;
      testData.averageDuration = avgDuration;
      testData.performanceTrend = this.getPerformanceTrend(
        result.duration,
        avgDuration
      );
    } else {
      testData.flakinessIndicator = '⚪ New';
      testData.performanceTrend = '→ Baseline';
    }

    this.results.push(testData);
  }

  async onEnd(result: FullResult): Promise<void> {
    // Get AI suggestions for failures
    await this.addAiSuggestions();

    // Generate HTML report
    const html = this.generateHtml(result);
    const outputPath = path.resolve(this.outputDir, this.options.outputFile);
    fs.writeFileSync(outputPath, html);
    console.log(`\n📊 Smart Report: ${outputPath}`);

    // Update history
    this.updateHistory();
  }

  // ============================================================================
  // History Management
  // ============================================================================

  private loadHistory(): void {
    const historyPath = path.resolve(this.outputDir, this.options.historyFile);
    if (fs.existsSync(historyPath)) {
      try {
        this.history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      } catch {
        this.history = {};
      }
    }
  }

  private updateHistory(): void {
    const timestamp = new Date().toISOString();

    for (const result of this.results) {
      if (!this.history[result.testId]) {
        this.history[result.testId] = [];
      }

      this.history[result.testId].push({
        passed: result.status === 'passed',
        duration: result.duration,
        timestamp,
      });

      // Keep only last N runs
      if (this.history[result.testId].length > this.options.maxHistoryRuns) {
        this.history[result.testId] = this.history[result.testId].slice(
          -this.options.maxHistoryRuns
        );
      }
    }

    const historyPath = path.resolve(this.outputDir, this.options.historyFile);
    fs.writeFileSync(historyPath, JSON.stringify(this.history, null, 2));
  }

  // ============================================================================
  // Flakiness & Performance
  // ============================================================================

  private getTestId(test: TestCase): string {
    const file = path.relative(this.outputDir, test.location.file);
    return `${file}::${test.title}`;
  }

  private getFlakinessIndicator(score: number): string {
    if (score < 0.1) return '🟢 Stable';
    if (score < 0.3) return '🟡 Unstable';
    return '🔴 Flaky';
  }

  private getPerformanceTrend(current: number, average: number): string {
    const diff = (current - average) / average;
    if (diff > this.options.performanceThreshold) {
      return `↑ ${Math.round(diff * 100)}% slower`;
    }
    if (diff < -this.options.performanceThreshold) {
      return `↓ ${Math.round(Math.abs(diff) * 100)}% faster`;
    }
    return '→ Stable';
  }

  // ============================================================================
  // AI Suggestions
  // ============================================================================

  private async addAiSuggestions(): Promise<void> {
    const failedTests = this.results.filter(
      (r) => r.status === 'failed' || r.status === 'timedOut'
    );

    if (failedTests.length === 0) return;

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!anthropicKey && !openaiKey) {
      console.log(
        '💡 Tip: Set ANTHROPIC_API_KEY or OPENAI_API_KEY for AI failure analysis'
      );
      return;
    }

    console.log(`\n🤖 Analyzing ${failedTests.length} failure(s) with AI...`);

    for (const test of failedTests) {
      try {
        const prompt = this.buildAiPrompt(test);

        if (anthropicKey) {
          test.aiSuggestion = await this.callAnthropic(prompt, anthropicKey);
        } else if (openaiKey) {
          test.aiSuggestion = await this.callOpenAI(prompt, openaiKey);
        }
      } catch (err) {
        console.error(`Failed to get AI suggestion for "${test.title}":`, err);
      }
    }
  }

  private buildAiPrompt(test: TestResultData): string {
    return `Analyze this Playwright test failure and suggest a fix. Be concise (2-3 sentences max).

Test: ${test.title}
File: ${test.file}
Error: ${test.error || 'Unknown error'}

Stack trace:
${test.errorStack || 'No stack trace available'}

Provide a brief, actionable suggestion to fix this failure.`;
  }

  private async callAnthropic(
    prompt: string,
    apiKey: string
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    return data.content[0]?.text || 'No suggestion available';
  }

  private async callOpenAI(prompt: string, apiKey: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || 'No suggestion available';
  }

  // ============================================================================
  // HTML Generation
  // ============================================================================

  private generateHtml(result: FullResult): string {
    const totalDuration = Date.now() - this.startTime;
    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed').length;
    const skipped = this.results.filter((r) => r.status === 'skipped').length;
    const flaky = this.results.filter(
      (r) => r.flakinessScore && r.flakinessScore >= 0.3
    ).length;
    const slow = this.results.filter((r) =>
      r.performanceTrend?.startsWith('↑')
    ).length;

    const testsJson = JSON.stringify(this.results);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Test Report</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .test-card { transition: all 0.2s ease; }
    .test-card:hover { transform: translateY(-1px); }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <div class="max-w-6xl mx-auto p-6">
    <!-- Header -->
    <div class="bg-white rounded-xl shadow-sm p-6 mb-6">
      <div class="flex items-center justify-between mb-4">
        <h1 class="text-2xl font-bold text-gray-800">🧪 Smart Test Report</h1>
        <span class="text-sm text-gray-500">${new Date().toLocaleString()}</span>
      </div>

      <!-- Summary Stats -->
      <div class="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div class="bg-green-50 rounded-lg p-4 text-center">
          <div class="text-2xl font-bold text-green-600">${passed}</div>
          <div class="text-sm text-green-700">Passed</div>
        </div>
        <div class="bg-red-50 rounded-lg p-4 text-center">
          <div class="text-2xl font-bold text-red-600">${failed}</div>
          <div class="text-sm text-red-700">Failed</div>
        </div>
        <div class="bg-gray-100 rounded-lg p-4 text-center">
          <div class="text-2xl font-bold text-gray-600">${skipped}</div>
          <div class="text-sm text-gray-700">Skipped</div>
        </div>
        <div class="bg-yellow-50 rounded-lg p-4 text-center">
          <div class="text-2xl font-bold text-yellow-600">${flaky}</div>
          <div class="text-sm text-yellow-700">Flaky</div>
        </div>
        <div class="bg-orange-50 rounded-lg p-4 text-center">
          <div class="text-2xl font-bold text-orange-600">${slow}</div>
          <div class="text-sm text-orange-700">Slow</div>
        </div>
        <div class="bg-blue-50 rounded-lg p-4 text-center">
          <div class="text-2xl font-bold text-blue-600">${this.formatDuration(totalDuration)}</div>
          <div class="text-sm text-blue-700">Duration</div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="bg-white rounded-xl shadow-sm p-4 mb-6">
      <div class="flex flex-wrap gap-2">
        <button onclick="filterTests('all')" class="filter-btn px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium" data-filter="all">
          All (${this.results.length})
        </button>
        <button onclick="filterTests('passed')" class="filter-btn px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200" data-filter="passed">
          ✅ Passed (${passed})
        </button>
        <button onclick="filterTests('failed')" class="filter-btn px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200" data-filter="failed">
          ❌ Failed (${failed})
        </button>
        <button onclick="filterTests('skipped')" class="filter-btn px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200" data-filter="skipped">
          ⏭️ Skipped (${skipped})
        </button>
        <button onclick="filterTests('flaky')" class="filter-btn px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200" data-filter="flaky">
          🔴 Flaky (${flaky})
        </button>
        <button onclick="filterTests('slow')" class="filter-btn px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200" data-filter="slow">
          🐢 Slow (${slow})
        </button>
      </div>
    </div>

    <!-- Test List -->
    <div id="test-list" class="space-y-3">
      ${this.results.map((test) => this.generateTestCard(test)).join('\n')}
    </div>
  </div>

  <script>
    const tests = ${testsJson};

    function filterTests(filter) {
      // Update button styles
      document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.filter === filter) {
          btn.className = 'filter-btn px-4 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium';
        } else {
          btn.className = 'filter-btn px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200';
        }
      });

      // Filter test cards
      document.querySelectorAll('.test-card').forEach(card => {
        const status = card.dataset.status;
        const isFlaky = card.dataset.flaky === 'true';
        const isSlow = card.dataset.slow === 'true';

        let show = false;
        if (filter === 'all') show = true;
        else if (filter === 'passed' && status === 'passed') show = true;
        else if (filter === 'failed' && (status === 'failed' || status === 'timedOut')) show = true;
        else if (filter === 'skipped' && status === 'skipped') show = true;
        else if (filter === 'flaky' && isFlaky) show = true;
        else if (filter === 'slow' && isSlow) show = true;

        card.style.display = show ? 'block' : 'none';
      });
    }

    function toggleDetails(id) {
      const details = document.getElementById('details-' + id);
      const icon = document.getElementById('icon-' + id);
      if (details.classList.contains('hidden')) {
        details.classList.remove('hidden');
        icon.textContent = '▼';
      } else {
        details.classList.add('hidden');
        icon.textContent = '▶';
      }
    }
  </script>
</body>
</html>`;
  }

  private generateTestCard(test: TestResultData): string {
    const statusColors: Record<string, string> = {
      passed: 'border-l-green-500 bg-green-50',
      failed: 'border-l-red-500 bg-red-50',
      timedOut: 'border-l-red-500 bg-red-50',
      skipped: 'border-l-gray-400 bg-gray-50',
      interrupted: 'border-l-yellow-500 bg-yellow-50',
    };

    const statusIcons: Record<string, string> = {
      passed: '✅',
      failed: '❌',
      timedOut: '⏱️',
      skipped: '⏭️',
      interrupted: '⚠️',
    };

    const cardColor = statusColors[test.status] || 'border-l-gray-400 bg-gray-50';
    const icon = statusIcons[test.status] || '❓';
    const isFlaky = test.flakinessScore !== undefined && test.flakinessScore >= 0.3;
    const isSlow = test.performanceTrend?.startsWith('↑') || false;
    const hasDetails =
      test.error || test.aiSuggestion || test.status !== 'passed';
    const cardId = this.sanitizeId(test.testId);

    return `
      <div class="test-card bg-white rounded-xl shadow-sm border-l-4 ${cardColor} overflow-hidden"
           data-status="${test.status}"
           data-flaky="${isFlaky}"
           data-slow="${isSlow}">
        <div class="p-4 cursor-pointer ${hasDetails ? 'hover:bg-gray-50' : ''}"
             ${hasDetails ? `onclick="toggleDetails('${cardId}')"` : ''}>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <span class="text-xl">${icon}</span>
              <div>
                <div class="font-medium text-gray-800">${this.escapeHtml(test.title)}</div>
                <div class="text-sm text-gray-500">${this.escapeHtml(test.file)}</div>
              </div>
            </div>
            <div class="flex items-center gap-4 text-sm">
              <span class="text-gray-600">${this.formatDuration(test.duration)}</span>
              ${test.flakinessIndicator ? `<span class="px-2 py-1 rounded-full bg-gray-100 text-xs">${test.flakinessIndicator}</span>` : ''}
              ${test.performanceTrend ? `<span class="text-gray-600 text-xs">${test.performanceTrend}</span>` : ''}
              ${hasDetails ? `<span id="icon-${cardId}" class="text-gray-400">▶</span>` : ''}
            </div>
          </div>
        </div>
        ${hasDetails ? this.generateTestDetails(test, cardId) : ''}
      </div>
    `;
  }

  private generateTestDetails(test: TestResultData, cardId: string): string {
    let details = '';

    if (test.error) {
      details += `
        <div class="mb-4">
          <div class="text-sm font-medium text-red-700 mb-2">Error</div>
          <pre class="bg-red-900 text-red-100 p-3 rounded-lg text-xs overflow-x-auto">${this.escapeHtml(test.error)}</pre>
        </div>
      `;
    }

    if (test.errorStack) {
      details += `
        <div class="mb-4">
          <div class="text-sm font-medium text-gray-700 mb-2">Stack Trace</div>
          <pre class="bg-gray-800 text-gray-100 p-3 rounded-lg text-xs overflow-x-auto max-h-48">${this.escapeHtml(test.errorStack)}</pre>
        </div>
      `;
    }

    if (test.aiSuggestion) {
      details += `
        <div class="mb-4">
          <div class="text-sm font-medium text-blue-700 mb-2">🤖 AI Suggestion</div>
          <div class="bg-blue-50 border border-blue-200 p-3 rounded-lg text-sm text-blue-900">${this.escapeHtml(test.aiSuggestion)}</div>
        </div>
      `;
    }

    if (test.averageDuration !== undefined) {
      details += `
        <div class="text-xs text-gray-500">
          Average duration: ${this.formatDuration(test.averageDuration)} (current: ${this.formatDuration(test.duration)})
        </div>
      `;
    }

    return `
      <div id="details-${cardId}" class="hidden px-4 pb-4 pt-2 border-t border-gray-100">
        ${details}
      </div>
    `;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private sanitizeId(str: string): string {
    return str.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

export default SmartReporter;
