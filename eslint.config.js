import js from '@eslint/js';
import globals from 'globals';
import security from 'eslint-plugin-security';

export default [
  { ignores: ['node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['server.js', 'server/**', 'scripts/**', 'test/**'], languageOptions: { globals: globals.node, sourceType: 'module' } },
  { files: ['public/**', 'shared/**'], languageOptions: { globals: { ...globals.browser }, sourceType: 'module' } },
];
