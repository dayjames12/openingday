import type { Command } from "commander";
import { basename, resolve } from "node:path";
import chalk from "chalk";
import { input, select, confirm } from "@inquirer/prompts";
import {
  DiskStorage,
  defaultConfig,
  createWorkTree,
  createCodeTree,
  createProjectState,
  getAllTasks,
  seedFromSpec,
} from "@openingday/core";
import { scanRepo as scanRepoMap } from "@openingday/core/scanner/scan";
import { ensureGitignore } from "@openingday/core/scanner/gitignore";
import type { RepoMap } from "@openingday/core/scanner/types";
import type { WorkTree, CodeTree } from "@openingday/core";
import { STACK_PRESETS } from "../presets/stacks.js";
import type { StackPreset } from "../presets/stacks.js";
import { formatWorkTree } from "../utils/display.js";

type ScaleChoice = "small" | "medium" | "large";

/* ─── Marin's personality engine ─── */

const y = chalk.yellow;
const g = chalk.green;
const c = chalk.cyan;
const r = chalk.red;
const dim = chalk.gray;

function marin(text: string): string {
  return y(text);
}

function printMarinBanner(): void {
  console.log();
  console.log(y("  🥜🌭⚾🍺🥜"));
  console.log();
  console.log(y("  PEANUTS! GETCHA PEANUTS HEAH!"));
  console.log(y("  ...oh wait, you want SOFTWARE?"));
  console.log(y("  Even bettah, kid. EVEN BETTAH!"));
  console.log();
  console.log(dim("  Marin's Artisanal Software Stand") + dim.dim("  est. 2024"));
  console.log();
}

function printMarinGreeting(): void {
  console.log(marin("Hey hey HEY! Welcome to the mahket, kid! Name's Marin —"));
  console.log(marin("I sell the finest hand-crafted software architectuahs this"));
  console.log(marin("side of the Green Monstah! Wicked good stuff, I promise ya."));
  console.log();
  console.log(marin("Now whatcha buildin' today? Don't be shy — I've seen it all,"));
  console.log(marin("from hot dog stands to rocket ships to that one guy who wanted"));
  console.log(marin("a blockchain for his cat. Yeah. THAT guy."));
  console.log();
}

/**
 * Assemble the user's answers into a rich spec string for the seeder.
 * Same logic as new.ts — the spec format is machine-consumed, no personality needed.
 */
function buildSpecFromAnswers(answers: {
  description: string;
  preset: StackPreset | null;
  customStack: string | null;
  scale: ScaleChoice;
  requirements: string;
}): string {
  const lines: string[] = [];

  lines.push(`# Project Specification`);
  lines.push("");
  lines.push(`## What We're Building`);
  lines.push("");
  lines.push(answers.description);
  lines.push("");

  lines.push(`## Tech Stack`);
  lines.push("");

  if (answers.preset) {
    lines.push(`**Preset:** ${answers.preset.name}`);
    lines.push("");
    lines.push(`**Technologies:**`);
    for (const tech of answers.preset.technologies) {
      lines.push(`- ${tech}`);
    }
    lines.push("");
    lines.push(`**Patterns:**`);
    for (const pattern of answers.preset.patterns) {
      lines.push(`- ${pattern}`);
    }
  } else if (answers.customStack) {
    lines.push(answers.customStack);
  }

  lines.push("");
  lines.push(`## Scale`);
  lines.push("");
  const scaleLabels: Record<ScaleChoice, string> = {
    small: "Small — personal project or MVP",
    medium: "Medium — startup, ~10k users",
    large: "Large — production, 100k+ users",
  };
  lines.push(scaleLabels[answers.scale] ?? answers.scale);
  lines.push("");

  if (answers.requirements.trim()) {
    lines.push(`## Additional Requirements`);
    lines.push("");
    lines.push(answers.requirements);
    lines.push("");
  }

  return lines.join("\n");
}

export function registerMarinSpecial(program: Command): void {
  program.command("marinSpecial", { hidden: true }).action(async () => {
    const storage = new DiskStorage(".openingday");
    if (await storage.exists()) {
      console.log(r("Whoa whoa WHOA kid! There's already a project heah in .openingday/!"));
      console.log(
        marin("You gotta clear that out first — can't stack two Fenway Franks in one bun!"),
      );
      return;
    }

    printMarinBanner();
    printMarinGreeting();

    // Step 1: What are you building?
    const description = await input({
      message: marin("So tell me kid, what's the big idea? What are we cookin' up?"),
      validate: (val) => (val.trim() ? true : "C'mon kid, gimme SOMETHIN' to work with heah!"),
    });

    console.log();
    console.log(
      marin(
        "Oh THAT'S what we're doin'?! I LOVE it! That's like a triple-deckah hot dog with all the fixins!",
      ),
    );
    console.log();

    // Step 2: Tech stack selection
    const stackChoices = [
      ...STACK_PRESETS.map((preset) => {
        const marinDescriptions: Record<string, string> = {
          "SST Platform": "The full Fenway Frank! Serverless, DynamoDB, the works — a GRAND SLAM!",
          "Next.js": "Classic peanuts and crackah jack! React, Tailwind, Vercel — crowd pleasah!",
          "Express API": "Ya basic dog, no shame in it — sometimes simple is WICKED good!",
          Remix: "The fancy craft beah of web frameworks! Progressive enhancement, baby!",
        };
        const desc = marinDescriptions[preset.name] ?? preset.description;
        return {
          name: `${chalk.bold.cyan(preset.name)} — ${y(desc)}`,
          value: preset.name,
        };
      }),
      {
        name: `${chalk.bold.cyan("Custom")} — ${y("Bringin' ya own recipe? I RESPECT that, kid!")}`,
        value: "custom",
      },
    ];

    console.log(marin("Alright alright ALRIGHT! Now what kinda ingredients we workin' with heah?"));
    console.log(marin("Pick ya flavahs:"));
    console.log();

    const stackChoice = await select({
      message: marin("Tech stack?"),
      choices: stackChoices,
    });

    let selectedPreset: StackPreset | null = null;
    let customStack: string | null = null;

    if (stackChoice === "custom") {
      console.log();
      console.log(marin("A custom ordah! I like ya style — ya know what ya want!"));
      customStack = await input({
        message: marin("Lay it on me — languages, frameworks, databases, the whole menu:"),
        validate: (val) =>
          val.trim() ? true : "Kid, I can't make a hot dog outta thin air! Gimme ya stack!",
      });
    } else {
      selectedPreset = STACK_PRESETS.find((p) => p.name === stackChoice) ?? null;
      if (selectedPreset) {
        console.log();
        console.log(
          marin(
            `${selectedPreset.name}! EXCELLENT choice! That's like orderin' the best seat in the house!`,
          ),
        );
      }
    }

    console.log();

    // Step 3: Scale
    console.log(marin("Now how many fans we packin' into this stadium?"));
    console.log();

    const scale = await select<ScaleChoice>({
      message: marin("How big we goin'?"),
      choices: [
        {
          name: `${c("Small")}  — ${y("Little league! Ya mom and 12 friends. Everyone gets a peanut!")}`,
          value: "small" as ScaleChoice,
        },
        {
          name: `${c("Medium")} — ${y("College ball! Real crowd, real pressure, real hot dogs!")}`,
          value: "medium" as ScaleChoice,
        },
        {
          name: `${c("Large")}  — ${y("FENWAY BABY! 100k screamin' fans! SELL ALL THE PEANUTS!")}`,
          value: "large" as ScaleChoice,
        },
      ],
    });

    const scaleReactions: Record<ScaleChoice, string> = {
      small: "Small but mighty! Even the Red Sox started in a sandlot, am I right?!",
      medium: "Medium! That's the sweet spot, kid — like a perfectly salted pretzel!",
      large: "LARGE?! WE'RE GOIN' TO THE BIG LEAGUES! I'm gonna need more peanuts!",
    };
    console.log();
    console.log(marin(scaleReactions[scale]));
    console.log();

    // Step 4: Additional requirements
    console.log(marin("Any extra toppings? Mustahd? Relish? Special requirements?"));
    const requirements = await input({
      message: marin("Extra requirements? (optional — press Entah to skip, no judgment!)"),
      default: "",
    });

    if (requirements.trim()) {
      console.log();
      console.log(
        marin("Oh you FANCY fancy! Extra toppings, I like it! The customah is always right!"),
      );
    }

    // Step 5: Project name
    console.log();
    console.log(marin("Almost there kid! Every great ballplayer needs a name on the jersey!"));

    const defaultName = basename(process.cwd());
    const projectName = await input({
      message: marin("What do we call this mastahpiece?"),
      default: defaultName,
      validate: (val) => (val.trim() ? true : "Even hot dogs have names, kid! Gimme something!"),
    });

    const projectDir = resolve(process.cwd());
    console.log();
    console.log(dim(`  Home field: ${projectDir}`));
    console.log();

    console.log(marin("Alright kid, I got the whole ordah written down on my napkin heah..."));
    console.log(marin("Ready for me to fire up the grill and cook this bad boy?"));
    console.log();

    const proceed = await confirm({
      message: marin("Generate the game plan?"),
      default: true,
    });

    if (!proceed) {
      console.log();
      console.log(marin("No worries kid, come back anytime! I'll save ya a pretzel! 🥨"));
      return;
    }

    // Step 6: Generate plan
    console.log();
    const spinnerFrames = [
      "🥜 Roastin' peanuts",
      "🌭 Grillin' hot dogs",
      "🍺 Pourin' cold ones",
      "⚾ Warmin' up the arm",
      "🥨 Twistin' pretzels",
      "🎯 Aimin' for the strike zone",
    ];
    let spinIdx = 0;
    const spinnerInterval = setInterval(() => {
      const frame = spinnerFrames[spinIdx % spinnerFrames.length];
      const dots = ".".repeat((spinIdx % 3) + 1).padEnd(3);
      process.stdout.write(`\r${y(frame)}${y(dots)}`);
      spinIdx++;
    }, 500);

    const specText = buildSpecFromAnswers({
      description,
      preset: selectedPreset,
      customStack,
      scale,
      requirements,
    });

    let workTree: WorkTree = createWorkTree();
    let codeTree: CodeTree = createCodeTree();

    // Scan existing repo
    let repoMap: RepoMap | null = null;
    try {
      repoMap = await scanRepoMap(process.cwd(), "standard");
    } catch {
      // No existing files — that's fine, fresh stadium!
    }

    try {
      const result = await seedFromSpec(specText, projectName, process.cwd(), undefined, repoMap);
      if (result) {
        workTree = result.workTree;
        codeTree = result.codeTree;
      } else {
        clearInterval(spinnerInterval);
        process.stdout.write("\r" + " ".repeat(60) + "\r");
        console.log(
          marin(
            "Hmm, the seedah came back empty... like a bag of peanuts with no peanuts! Usin' empty trees.",
          ),
        );
      }
    } catch (err) {
      clearInterval(spinnerInterval);
      process.stdout.write("\r" + " ".repeat(60) + "\r");
      const message = err instanceof Error ? err.message : String(err);
      console.log(r(`Aw nuts! Seedin' hit a foul ball: ${message}`));
      console.log(marin("No worries, we'll use empty trees — every comeback starts somewhere!"));
      workTree = createWorkTree();
      codeTree = createCodeTree();
    }

    clearInterval(spinnerInterval);
    process.stdout.write("\r" + " ".repeat(60) + "\r");

    // Step 7: Summary
    const milestoneCount = workTree.milestones.length;
    const taskCount = getAllTasks(workTree).length;
    const fileCount = codeTree.modules.reduce((n, m) => n + m.files.length, 0);

    console.log();
    console.log(g("  HOLY SMOKES KID! Look at this BEAUTIFUL lineup!"));
    console.log();
    console.log(
      y(`  ⚾ ${milestoneCount} milestones`) +
        dim(` — that's ${milestoneCount} innings of PURE MAGIC!`),
    );
    console.log(
      y(`  🥜 ${taskCount} tasks`) +
        dim(` — like ${taskCount} bags of the finest roasted peanuts!`),
    );
    console.log(
      y(`  🌭 ${fileCount} files`) + dim(` — more files than I got hot dogs! And I got a LOT!`),
    );
    console.log();

    // Step 8: Review?
    if (milestoneCount > 0) {
      console.log(marin("Wanna take a peek at the rostah? See who's battin' first?"));
      console.log();

      const review = await confirm({
        message: marin("Review the game plan?"),
        default: true,
      });

      if (review) {
        console.log();
        console.log(formatWorkTree(workTree));
        console.log();
      }
    }

    console.log(marin("This is it kid — one swing and we're in business!"));
    console.log();

    const save = await confirm({
      message: marin("Save and initialize? Let's PLAY BALL?"),
      default: true,
    });

    if (!save) {
      console.log();
      console.log(
        marin("Ah, cold feet! It's alright kid. Come back when ya hungry — I'll be heah! 🥜"),
      );
      return;
    }

    // Step 9: Write to .openingday/
    await storage.initialize();
    await ensureGitignore(process.cwd());
    const config = defaultConfig(projectName, "interactive");
    await storage.writeProjectConfig(config);
    await storage.writeProjectState(createProjectState());
    await storage.writeWorkTree(workTree);
    await storage.writeCodeTree(codeTree);
    if (repoMap) await storage.writeRepoMap(repoMap);

    console.log();
    console.log(g("  ⚾⚾⚾ AND THE CROWD GOES WILD! ⚾⚾⚾"));
    console.log();
    console.log(g(`  Project "${projectName}" is IN THE GAME!`));
    console.log(dim("  Stored in .openingday/ — ya home field advantage!"));
    console.log();
    console.log(
      marin("Run ") +
        chalk.bold.cyan("openingday run") +
        marin(" to start swingin' for the fences!"),
    );
    console.log();
    console.log(y("  ────────────────────────────────────────"));
    console.log();
    console.log(marin("It's been a PLEASUAH doin' business with ya, kid!"));
    console.log(marin("Remember — every great app starts with a great plan"));
    console.log(marin("and a WICKED good attitude! Now get out theah and BUILD!"));
    console.log();
    console.log(dim("  — Marin, Fenway's Finest Software Vendor, signing off 🥜⚾"));
    console.log();
  });
}
