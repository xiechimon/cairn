import starlight from '@astrojs/starlight';
import { defineConfig, passthroughImageService } from 'astro/config';

const docs = (slug) => ({ slug: `docs/${slug}` });

export default defineConfig({
  site: 'https://cairn.xmon.me',
  redirects: {
    '/docs': '/docs/intro/',
    '/zh-cn/docs': '/zh-cn/docs/intro/',
  },
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: 'Cairn',
      description:
        'An open-source personal assistant for people who write code. Start with the Mac desktop app; self-host on Linux or headless servers as the advanced path. Agents work on your own hardware with your own subscriptions and wait for your yes on anything irreversible.',
      favicon: '/logo.svg',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/xiechimon/cairn' }],
      editLink: { baseUrl: 'https://github.com/xiechimon/cairn/edit/main/site/' },
      sidebar: [
        {
          label: 'Start here',
          translations: { 'zh-CN': '开始' },
          items: [docs('intro'), docs('install'), docs('models'), docs('runner'), docs('first-task')],
        },
        {
          label: 'Guides',
          translations: { 'zh-CN': '专题指南' },
          items: [
            { slug: 'guides' },
            { slug: 'guides/claude-code-subscribers' },
            { slug: 'guides/chatgpt-codex-subscribers' },
            { slug: 'guides/mac-mini-always-on-runner' },
            { slug: 'guides/multi-machine-linux-vps-runners' },
            { slug: 'guides/privacy-local-first-developers' },
          ],
        },
        {
          label: 'Help',
          translations: { 'zh-CN': '帮助' },
          items: [docs('faq')],
        },
      ],
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
      },
      customCss: ['./src/styles/fonts.css', './src/styles/tokens.css', './src/styles/docs.css'],
      expressiveCode: {
        themes: ['github-dark-default', 'github-light-default'],
        useStarlightUiThemeColors: true,
        defaultProps: { frame: 'code' },
        styleOverrides: {
          borderRadius: '12px',
          borderColor: 'var(--line)',
          codeFontFamily: 'var(--font-mono)',
          uiFontFamily: 'var(--font-sans)',
          frames: { frameBoxShadowCssValue: 'none' },
        },
      },
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://cairn.xmon.me/img/share-card-en.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        {
          tag: 'script',
          attrs: {
            defer: true,
            src: 'https://static.cloudflareinsights.com/beacon.min.js',
            'data-cf-beacon': '{"token":"a2f5ef9618404d5ea00a0820a8a1fba3"}',
          },
        },
      ],
    }),
  ],
});
