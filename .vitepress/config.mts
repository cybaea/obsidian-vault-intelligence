import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { buildEndGenerateOpenGraphImages } from '@nolebase/vitepress-plugin-og-image'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getSidebarItems(dir: string, prefix: string) {
    const fullPath = path.resolve(__dirname, '..', dir)
    if (!fs.existsSync(fullPath)) return []

    return fs.readdirSync(fullPath)
        .filter(file => file.endsWith('.md') && file.toLowerCase() !== 'index.md')
        .map(file => {
            const fileName = file.replace(/\.md$/, '')
            const content = fs.readFileSync(path.join(fullPath, file), 'utf-8')
            const match = content.match(/^#\s+(.*)/)
            let text = match ? match[1].trim() : fileName.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

            // Custom overrides for cleaner presentation
            if (fileName === '2026-agent-support') text = 'Agent Support 2026'
            if (fileName === 'ARCHITECTURE') text = 'Architecture'

            return {
                text,
                link: `/${prefix}/${fileName}`
            }
        })
        .sort((a, b) => a.text.localeCompare(b.text))
}

// https://vitepress.dev/reference/site-config
export default withMermaid(defineConfig({
    title: "Vault Intelligence",
    description: "AI research assistant for your Obsidian vault",
    base: '/obsidian-vault-intelligence/',
    lastUpdated: true,
    sitemap: {
        hostname: 'https://cybaea.github.io/obsidian-vault-intelligence/'
    },
    head: [
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:title', content: 'Vault Intelligence' }],
        ['meta', { property: 'og:description', content: 'AI research assistant for your Obsidian vault' }],
        ['meta', { property: 'og:image', content: '/obsidian-vault-intelligence/images/vault-intelligence-social-1280.png' }],
        ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
        ['meta', { name: 'twitter:title', content: 'Vault Intelligence' }],
        ['meta', { name: 'twitter:description', content: 'AI research assistant for your Obsidian vault' }],
        ['meta', { name: 'twitter:image', content: '/obsidian-vault-intelligence/images/vault-intelligence-social-1280.png' }],
    ],
    srcExclude: ['devs/adr/**'],
    vite: {
        build: {
            chunkSizeWarningLimit: 600
        }
    },
    themeConfig: {
        // https://vitepress.dev/reference/default-theme-config
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Guide', link: '/docs/configuration' },
            { text: 'Changelog', link: '/CHANGELOG' }
        ],

        sidebar: [
            {
                text: 'Introduction',
                items: [
                    { text: 'Getting Started', link: '/docs/tutorials/getting-started' },
                    { text: 'Roadmap', link: '/ROADMAP' },
                    { text: 'Changelog', link: '/CHANGELOG' }
                ]
            },
            {
                text: 'Tutorials',
                items: [
                    { text: 'Getting Started', link: '/docs/tutorials/getting-started' }
                ]
            },
            {
                text: 'How-To Guides',
                items: [
                    { text: 'Researcher Workflows', link: '/docs/how-to/researcher-workflows' },
                    { text: 'Data Analysis (Python)', link: '/docs/how-to/data-analysis' },
                    { text: 'Maintain Vault Hygiene', link: '/docs/how-to/maintain-vault' }
                ]
            },
            {
                text: 'Reference',
                items: [
                    { text: 'Configuration', link: '/docs/reference/configuration' },
                    { text: 'Troubleshooting', link: '/docs/reference/troubleshooting' }
                ]
            },
            {
                text: 'Explanation',
                items: [
                    { text: 'The Research Engine', link: '/docs/explanation/research-engine' },
                    { text: 'Vault Hygiene Philosophy', link: '/docs/explanation/vault-hygiene' }
                ]
            },
            {
                text: 'Development',
                items: [
                    { text: 'Contributing', link: '/CONTRIBUTING' },
                    { text: 'Internal Agents Guide', link: '/AGENTS' },
                    { text: 'Documentation Standards', link: '/devs/documentation-standards' }
                ]
            }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/cybaea/obsidian-vault-intelligence' }
        ],

        search: {
            provider: 'local'
        },

        editLink: {
            pattern: 'https://github.com/cybaea/obsidian-vault-intelligence/edit/main/:path',
            text: 'Edit this page on GitHub'
        }
    },
    // Map .md files from root and subdirs
    async buildEnd(siteConfig) {
        await buildEndGenerateOpenGraphImages({
            baseUrl: 'https://cybaea.github.io/obsidian-vault-intelligence/',
            category: {
                byLevel: 1
            }
        })(siteConfig)
    }
}))
