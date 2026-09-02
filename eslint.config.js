import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
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
    plugins: { react },
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
      // Il codebase usa ref condivisi via prop (pagesCache) e function
      // declaration hoisted negli effect: pattern voluti, non errori bloccanti.
      'react-hooks/immutability': 'warn',
      // Un componente usato e mai importato.
      //
      // `no-undef` non lo prende: dentro il JSX il nome di un componente è un
      // JSXIdentifier, e quella regola guarda solo gli identificatori normali.
      // Il risultato è che un componente spostato in un altro file e non
      // importato passa tipi, lint e build senza una parola, e si scopre a
      // schermo bianco — che in questo progetto vuol dire dopo il merge, perché
      // l'app si prova solo in produzione. È successo separando PlannerView.
      //
      // Del plugin react serve questa regola e nient'altro: il resto sono
      // convenzioni di stile che qui non servono a niente.
      'react/jsx-no-undef': 'error',
    },
  },
])
