import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // A privileged app: durable browser storage is never a place for a token, so it is a lint error to reach for it.
      'no-restricted-globals': ['error', { name: 'localStorage', message: 'The admin session lives in memory only.' }, { name: 'sessionStorage', message: 'The admin session lives in memory only.' }],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'localStorage', message: 'The admin session lives in memory only.' },
        { object: 'window', property: 'sessionStorage', message: 'The admin session lives in memory only.' },
      ],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-properties': 'off' },
  }
)
