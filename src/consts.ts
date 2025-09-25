import type { Site, Metadata, Socials } from "@types";

export const SITE: Site = {
  NAME: "Yewolf",
  EMAIL: "contact@yewolf.fr",
  NUM_POSTS_ON_HOMEPAGE: 4,
  NUM_WORKS_ON_HOMEPAGE: 2,
  NUM_PROJECTS_ON_HOMEPAGE: 4,
};

export const HOME: Metadata = {
  TITLE: "Home",
  DESCRIPTION: "Yewolf's personal portfolio - Go developer and distributed systems specialist.",
};

export const BLOG: Metadata = {
  TITLE: "Blog",
  DESCRIPTION: "A collection of articles on topics I am passionate about.",
};

export const WORK: Metadata = {
  TITLE: "Work",
  DESCRIPTION: "Where I have worked and what I have done.",
};

export const PROJECTS: Metadata = {
  TITLE: "Projects",
  DESCRIPTION: "A collection of my projects, with links to repositories and demos.",
};

export const TALKS: Metadata = {
  TITLE: "Talks",
  DESCRIPTION: "Talks and presentations I've given at conferences and meetups.",
};

export const SOCIALS: Socials = [
  { 
    NAME: "github",
    HREF: "https://github.com/yyewolf"
  },
  { 
    NAME: "linkedin",
    HREF: "https://www.linkedin.com/in/tristan-smagghe-70178a24b/"
  },
  { 
    NAME: "email",
    HREF: "mailto:contact@yewolf.fr"
  }
];
