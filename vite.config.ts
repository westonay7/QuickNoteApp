import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

function normalizeBase(raw: string): string {
  let b = raw.trim()
  if (!b || b === '.' || b === './') return '/'
  if (!b.startsWith('/')) b = `/${b}`
  if (!b.endsWith('/')) b = `${b}/`
  return b
}

const GITHUB_PAGES_DEFAULT_BASE = '/QuickNote---A-Premium-Note-App/'

function resolveBasePath(command: 'serve' | 'build'): string {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--base=')) {
      return normalizeBase(arg.slice('--base='.length))
    }
    if (arg === '--base' && args[i + 1]) {
      return normalizeBase(args[i + 1])
    }
  }

  if (command === 'serve') return '/'

  if (process.env.VITE_BASE_PATH) {
    return normalizeBase(process.env.VITE_BASE_PATH)
  }

  if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY) {
    const repoName = process.env.GITHUB_REPOSITORY.split('/')[1]
    if (repoName && !repoName.endsWith('.github.io')) {
      return normalizeBase(`/${repoName}/`)
    }
  }

  if (process.env.npm_lifecycle_event === 'build:pages') {
    return GITHUB_PAGES_DEFAULT_BASE
  }

  return '/'
}

function stripCloudflareRedirectsPlugin(): Plugin {
  return {
    name: 'strip-cloudflare-redirects',
    buildStart() {
      const pubRedirects = fileURLToPath(new URL('./public/_redirects', import.meta.url))
      if (fs.existsSync(pubRedirects)) {
        fs.unlinkSync(pubRedirects)
        console.log('Removed public/_redirects to eliminate circular redirect rule')
      }
    },
    closeBundle() {
      const distRedirects = fileURLToPath(new URL('./dist/_redirects', import.meta.url))
      if (fs.existsSync(distRedirects)) {
        fs.unlinkSync(distRedirects)
        console.log('Removed dist/_redirects to prevent Cloudflare error 100324')
      }
    },
  }
}

/**
 * Generates GitHub Pages SPA fallback files (`404.html`, `app/index.html`, and `.nojekyll`).
 * Always emits `.nojekyll` so dot-directories like `.well-known/assetlinks.json` are served
 * cleanly on GitHub Pages, and emits SPA fallbacks for GitHub Pages deployments (both root
 * `*.github.io` sites and repository subpaths such as `/QuickNote---A-Premium-Note-App/`).
 */
function githubPagesSpaPlugin(base: string): Plugin {
  return {
    name: 'github-pages-spa-fallback',
    closeBundle() {
      const distDir = fileURLToPath(new URL('./dist', import.meta.url))
      const indexHtml = path.join(distDir, 'index.html')
      if (!fs.existsSync(indexHtml)) return

      // Always emit .nojekyll so GitHub Pages never ignores .well-known/assetlinks.json
      fs.writeFileSync(path.join(distDir, '.nojekyll'), '')

      const isPagesBuild =
        base !== '/' ||
        process.env.GITHUB_ACTIONS === 'true' ||
        process.env.npm_lifecycle_event === 'build:pages'
      if (!isPagesBuild) return

      const html = fs.readFileSync(indexHtml, 'utf8')
      fs.writeFileSync(path.join(distDir, '404.html'), html)

      const appDir = path.join(distDir, 'app')
      fs.mkdirSync(appDir, { recursive: true })
      fs.writeFileSync(path.join(appDir, 'index.html'), html)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const base = resolveBasePath(command)

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      stripCloudflareRedirectsPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'inline',
        manifestFilename: 'manifest.webmanifest',
        includeAssets: [
          'favicon.svg',
          'icons.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-192x192.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          id: base,
          name: 'QuickNote - Notes App',
          short_name: 'QuickNote',
          description:
            'A professional note-taking application for creating, organizing and managing notes.',
          theme_color: '#5145E5',
          background_color: '#F7F7FC',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui', 'window-controls-overlay'],
          orientation: 'any',
          lang: 'en',
          dir: 'ltr',
          start_url: base,
          scope: base,
          categories: ['productivity', 'utilities'],
          prefer_related_applications: false,
          launch_handler: {
            client_mode: 'navigate-existing',
          },
          icons: [
            {
              src: `${base}pwa-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: `${base}pwa-maskable-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: `${base}pwa-maskable-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: 'New Note',
              short_name: 'New Note',
              description: 'Quickly create a new note',
              url: `${base}app/notes/new`,
              icons: [{ src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png' }],
            },
            {
              name: 'Search Notes',
              short_name: 'Search',
              description: 'Search your notes, folders, and tags',
              url: `${base}app/search`,
              icons: [{ src: `${base}pwa-192x192.png`, sizes: '192x192', type: 'image/png' }],
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          globPatterns: ['**/*.{js,css,html,woff,woff2}'],
          globIgnores: ['**/404.html', '**/app/index.html'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [
            /^\/api\//,
            /\/\.well-known\//,
            /\/manifest\.webmanifest$/,
            /\/sw\.js$/,
          ],
          runtimeCaching: [
            {
              // Never cache Supabase authentication, user notes, folders, tags, or private API responses.
              urlPattern: /^https:\/\/[^/]+\.supabase\.(co|in)\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-stylesheets',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          navigateFallback: 'index.html',
          suppressWarnings: true,
        },
      }),
      githubPagesSpaPlugin(base),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true,
      watch: {
        usePolling: true,
      },
    },
    build: {
      // Keep the initial bundle lean; the app is route-split by the router below.
      chunkSizeWarningLimit: 900,
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
        process.env.VITE_SUPABASE_URL && !process.env.VITE_SUPABASE_URL.includes('your-project-ref')
          ? process.env.VITE_SUPABASE_URL
          : 'https://xgfthqjrnqmsgcizddpq.supabase.co',
      ),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
        process.env.VITE_SUPABASE_ANON_KEY && !process.env.VITE_SUPABASE_ANON_KEY.includes('your-anon')
          ? process.env.VITE_SUPABASE_ANON_KEY
          : 'sb_publishable_J33jjhr_dbK69BnN5kx1hA_6hl3UJ64',
      ),
    },
  }
})
