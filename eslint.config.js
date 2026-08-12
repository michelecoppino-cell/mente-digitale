import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Il codebase usa ref condivisi via prop (pagesCache/tasksCache) e function
      // declaration hoisted negli effect: pattern voluti, non errori bloccanti.
      //
      // I 18 warning che restano sono tutti e soli questi due, e non sono rumore:
      // sono un debito dichiarato. Le omissioni di dipendenza *intenzionali*
      // hanno invece un eslint-disable con la ragione scritta accanto, così
      // l'output di `npm run lint` si legge — se compare qualcosa che non è uno
      // di questi due pattern, è nuovo.
      //
      // Toglierli davvero vuol dire sostituire la cache a ref condivisi
      // (App.jsx → Panel/PlannerView/SearchOverlay) con il query client, che è
      // un lavoro a sé: cambiarne la forma per far tacere un linter, in una
      // vista da 2400 righe senza test, sarebbe il verso sbagliato.
      'react-hooks/immutability': 'warn',
    },
  },
])
