import tsParser from '@typescript-eslint/parser';
import noFeatureDeps from './eslint/no-feature-deps.js';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    plugins: {
      bulkly: {
        rules: {
          'no-feature-deps': noFeatureDeps,
        },
      },
    },
    rules: {
      'bulkly/no-feature-deps': 'error',
    },
  },
];
