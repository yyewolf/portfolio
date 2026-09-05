import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().optional()
  }),
});

const work = defineCollection({
  type: "content",
  schema: z.object({
    company: z.string(),
    role: z.string(),
    dateStart: z.coerce.date(),
    dateEnd: z.union([z.coerce.date(), z.string()]),
    url: z.string().optional(),
  }),
});

const education = defineCollection({
  type: "content",
  schema: z.object({
    institution: z.string(),
    degree: z.string(),
    dateStart: z.coerce.date(),
    dateEnd: z.union([z.coerce.date(), z.string()]),
    skills: z.array(z.string()).optional(),
    url: z.string().optional(),
  }),
});

const projects = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().optional(),
    demoURL: z.string().optional(),
    repoURL: z.string().optional()
  }),
});

const talks = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    event: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().optional(),
    slidesURL: z.string().optional(),
    repoURL: z.string().optional(),
    videoURL: z.string().optional(),
  }),
});

const certifications = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    issuer: z.string(),
    description: z.string(),
    dateEarned: z.coerce.date(),
    expirationDate: z.coerce.date().optional(),
    credentialURL: z.string().optional(),
    badgeURL: z.string().optional(),
    skills: z.array(z.string()).optional(),
    draft: z.boolean().optional(),
  }),
});

const courses = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string(),
    level: z.enum(["beginner", "intermediate", "advanced"]),
    order: z.number(),
    logo: z.string().optional(),
    logoAlt: z.string().optional(),
    draft: z.boolean().optional(),
  }),
});

const lessons = defineCollection({
  type: "content",
  schema: z.object({
    track: z.string(),
    order: z.number(),
    // Which phase of the track this belongs to. The depth tier (core /
    // practical / deep) is a property of the phase, not the lesson, so it lives
    // in the track's phases.json and is derived from this number. Storing it
    // twice would let the two drift.
    phase: z.number(),
    title: z.string(),
    description: z.string(),
    minutes: z.number(),
    tags: z.array(z.string()).default([]),
    // Interactive modes this lesson is planned to offer, all backed by the same
    // simulation engine: watch the system decide, drive it yourself, or open it
    // up and inspect the mechanics.
    modes: z.array(z.enum(["visualize", "operate", "inspect"])).default([]),
    // Keeps the sidebar glossary out of sight until the reader finishes. Set it
    // when the lesson is built around working an idea out, since the sidebar
    // would otherwise name that idea before the lesson gets to it.
    holdGlossary: z.boolean().default(false),
    draft: z.boolean().optional(),
  }),
});

export const collections = { blog, work, projects, education, talks, certifications, courses, lessons };
