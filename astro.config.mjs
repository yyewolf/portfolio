import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import matomo from 'astro-matomo';

export default defineConfig({
  site: "https://yewolf.fr",
  integrations: [
    mdx(), 
    sitemap(), 
    tailwind(),
    matomo({
      enabled: true,
      host: "https://analytics.yewolf.fr/",
      setCookieDomain: "*.yewolf.fr",
      trackerUrl: "matomo.php",
      srcUrl: "matomo.js",
      siteId: 1,
      heartBeatTimer: 5,
      disableCookies: true,
      debug: false,
      viewTransition: {
        contentElement: "main"
      }
    }),
  ],
});
