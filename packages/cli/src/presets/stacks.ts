export interface StackPreset {
  name: string;
  description: string;
  technologies: string[];
  patterns: string[];
  standards: string[];
}

export const STACK_PRESETS: StackPreset[] = [
  {
    name: "SST Platform",
    description: "Serverless on AWS — SST v3, Hono, DynamoDB, Lambda, SNS/SQS, CloudFront",
    technologies: [
      "SST v3",
      "TypeScript",
      "Hono",
      "DynamoDB (single-table, ElectroDB)",
      "AWS Lambda (Node.js 22)",
      "S3",
      "SNS/SQS",
      "CloudFront",
      "pnpm monorepo",
    ],
    patterns: [
      "Single-table DynamoDB design",
      "Event-driven messaging (SNS fan-out to SQS)",
      "Lambda Powertools for logging/metrics",
      "Profile-based deployment (dev/staging/production)",
      "Feature-based infrastructure modules",
    ],
    standards: ["aws-serverless"],
  },
  {
    name: "Next.js",
    description: "Full-stack React — Next.js App Router, TypeScript, Tailwind, Vercel",
    technologies: ["Next.js 15", "React 19", "TypeScript", "Tailwind CSS v4", "Vercel"],
    patterns: [
      "App Router with server components",
      "Server actions for mutations",
      "Middleware for auth",
    ],
    standards: ["base"],
  },
  {
    name: "Express API",
    description: "REST API — Express, TypeScript, PostgreSQL or DynamoDB",
    technologies: ["Express 5", "TypeScript", "PostgreSQL/DynamoDB", "Vitest"],
    patterns: ["Controller/service/repository layers", "JWT auth middleware", "Request validation"],
    standards: ["base"],
  },
  {
    name: "Remix",
    description: "Full-stack web — Remix, React, TypeScript, Tailwind",
    technologies: ["Remix 2", "React 19", "TypeScript", "Tailwind CSS v4"],
    patterns: ["Loader/action pattern", "Nested routes", "Progressive enhancement"],
    standards: ["base"],
  },
];
