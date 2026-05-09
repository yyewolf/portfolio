import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import yeskunallumami from "@yeskunall/astro-umami";

export default defineConfig({
  site: "https://yewolf.fr",
  integrations: [mdx(), sitemap(), tailwind(), yeskunallumami({ id: "8308e0b2-3258-4dab-9ac8-01ad87ab64dd" })],
});