import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: [
        'pwa-512.png'
      ],

      manifest: {
        name: '激安日記帳',
        short_name: '激安日記',
        description: 'AWS LambdaとDynamoDBで動く激安アプリ',

        theme_color: '#ffffff',
        background_color: '#f4f4f9',
        display: 'standalone',
        start_url: '/',

        icons: [
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'pwa-512.png',
            sizes: '192x192',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
