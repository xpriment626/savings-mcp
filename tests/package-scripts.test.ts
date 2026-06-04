import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

interface PackageJson {
  scripts?: Record<string, string>;
}

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageJson;
const localTypescriptTargetPattern = /\b(?:src|tests|scripts)\/[^\s'"]+\.ts\b/g;

function trackedPathspecMatches(pathspec: string): string[] {
  return execFileSync('git', ['ls-files', '--', pathspec], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.length > 0);
}

describe('public package scripts', () => {
  it('only point contributor commands at tracked local files', () => {
    const scripts = Object.entries(packageJson.scripts ?? {});

    for (const [name, command] of scripts) {
      assert.equal(
        command.includes('scripts/'),
        false,
        `${name} points at ignored internal scripts/: ${command}`
      );

      const localTargets = command.match(localTypescriptTargetPattern) ?? [];
      for (const target of localTargets) {
        assert.notEqual(
          trackedPathspecMatches(target).length,
          0,
          `${name} points at an untracked local target: ${target}`
        );
      }
    }
  });
});
