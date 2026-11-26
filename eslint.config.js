import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  security.configs.recommended,
  sonarjs.configs.recommended,
  {
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      complexity: ['error', 8],
      'max-lines-per-function': ['error', { max: 35, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      'max-params': ['error', 3],
      'sonarjs/cognitive-complexity': ['error', 10],
      'sonarjs/no-duplicate-string': 'error',
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Tests repeat fixture strings and use http://localhost fixtures and fake IPs on purpose.
    files: ['test/**'],
    rules: {
      'max-lines-per-function': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-hardcoded-ip': 'off',
    },
  },
  { files: ['server.js', 'server/**', 'test/**'], languageOptions: { globals: globals.node, sourceType: 'module' } },
  { files: ['public/**', 'shared/**'], languageOptions: { globals: { ...globals.browser }, sourceType: 'module' } },
];
