#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import inquirer from "inquirer";
import { Command } from "commander";
import chalk from "chalk";
import { parseISO, format, isAfter, isBefore, isEqual } from "date-fns";
import { glob } from "glob";
import { marked } from "marked";
import terminalLink from "terminal-link";
import Fuse from "fuse.js";
import {
  initGit,
  commitChanges,
  setupRemote,
  pushChanges,
  pullChanges,
  createBackup,
  syncWithCloud,
  setupAutomaticBackups,
} from "./sync.js";
import { startTUI } from "./tui.js";
import { processUrl } from "./lib/url-processor.js";
import { createClaudeProcessor } from "./lib/claude-processor.js";
import * as todoMatrix from "./lib/todo-matrix.js";
import { startTodoTUI } from "./lib/todo-tui.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default directory to save thoughts
const DEFAULT_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  "thoughts",
);

// Create a program with commander
const program = new Command();

// Setup program metadata
program
  .name("thoughts")
  .description("A CLI for capturing and searching your thoughts")
  .version("1.0.0");

async function ensureDirectoryExists(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error(`Error creating directory: ${err.message}`);
    process.exit(1);
  }
}

async function openEditor(filepath) {
  return new Promise((resolve) => {
    // Try to use THOUGHTS_EDITOR, then fall back to EDITOR, then to common editors
    const editor = process.env.THOUGHTS_EDITOR || process.env.EDITOR || "nano";

    const child = spawn(editor, [filepath], {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", () => {
      resolve();
    });
  });
}

async function createThought() {
  try {
    // Ensure thoughts directory exists
    await ensureDirectoryExists(DEFAULT_DIR);

    // Ask for thought title
    const { title } = await inquirer.prompt([
      {
        type: "input",
        name: "title",
        message: "Title for your thought:",
        default: new Date().toISOString().split("T")[0],
      },
    ]);

    // Create a safe filename
    const safeTitle = title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${timestamp}-${safeTitle}.md`;
    const filepath = path.join(DEFAULT_DIR, filename);

    // Create the file with title as header
    await fs.writeFile(filepath, `# ${title}\n\n`);

    // Open the editor
    await openEditor(filepath);

    // Check if file was actually modified
    const content = await fs.readFile(filepath, "utf8");
    if (content.trim() === `# ${title}`) {
      console.log("Thought was empty, deleting file.");
      await fs.unlink(filepath);
    } else {
      console.log(`Thought saved to: ${filepath}`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

async function getAllThoughts() {
  await ensureDirectoryExists(DEFAULT_DIR);
  const pattern = path.join(DEFAULT_DIR, "*.md");
  const files = await glob(pattern);

  return Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(file, "utf8");
      const filename = path.basename(file);
      // Extract date from filename (ISO format at the beginning)
      const datePart = filename.split("-").slice(0, 3).join("-");
      let date;
      try {
        date = parseISO(datePart);
      } catch (e) {
        date = new Date(0); // Default to epoch if can't parse
      }

      // Extract title from content or filename
      let title = "";
      const firstLine = content.split("\n")[0];
      if (firstLine.startsWith("# ")) {
        title = firstLine.substring(2);
      } else {
        // Try to get title from filename (after date part)
        const titlePart = filename
          .replace(/^[0-9T\-:]+Z?-/, "")
          .replace(".md", "");
        title = titlePart.replace(/_/g, " ");
      }

      return {
        path: file,
        filename,
        date,
        title,
        content,
      };
    }),
  );
}

function highlight(text, query, matches) {
  if (!query) return text;

  // If we have fuzzy matches with specific indices
  if (matches) {
    // Extract the match positions
    const parts = [];
    let lastEnd = 0;

    // Get all indices and sort them
    const indices = [];
    matches.forEach((match) => {
      if (match.indices) {
        match.indices.forEach((idx) => indices.push(idx));
      }
    });

    // Sort indices by start position
    indices.sort((a, b) => a[0] - b[0]);

    // Handle overlapping matches by merging them
    const mergedIndices = [];
    if (indices.length > 0) {
      let current = indices[0];
      for (let i = 1; i < indices.length; i++) {
        if (indices[i][0] <= current[1]) {
          // Overlapping indices, merge them
          current[1] = Math.max(current[1], indices[i][1]);
        } else {
          // Non-overlapping, add the current one and move to next
          mergedIndices.push(current);
          current = indices[i];
        }
      }
      mergedIndices.push(current);
    }

    // Highlight the merged indices
    mergedIndices.forEach(([start, end]) => {
      // Add text before this match
      if (start > lastEnd) {
        parts.push(text.substring(lastEnd, start));
      }

      // Add the highlighted match
      parts.push(chalk.bold.yellow(text.substring(start, end + 1)));

      lastEnd = end + 1;
    });

    // Add any remaining text
    if (lastEnd < text.length) {
      parts.push(text.substring(lastEnd));
    }

    return parts.join("");
  }

  // Simple regex-based highlighting (case insensitive) for regular search
  try {
    // Escape special regex characters
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, "gi");
    return text.replace(regex, chalk.bold.yellow("$1"));
  } catch (e) {
    // If regex fails, return original text
    return text;
  }
}

// Perform fuzzy search on thoughts
function performFuzzySearch(thoughts, query, options) {
  // Configure Fuse.js for fuzzy searching
  const fuseOptions = {
    keys: ["title", "content"],
    includeScore: true,
    threshold: options.threshold || 0.4, // Default threshold (0 = exact match, 1 = match anything)
    minMatchCharLength: 2,
    ignoreLocation: options.ignoreLocation !== false, // Ignore location by default
    useExtendedSearch: options.extended !== false, // Use extended search by default
    findAllMatches: true,
    location: 0,
    distance: 100,
  };

  const fuse = new Fuse(thoughts, fuseOptions);
  const results = fuse.search(query);

  // Transform results back to our format with added score
  return results.map((result) => ({
    ...result.item,
    score: result.score,
    matches: result.matches,
  }));
}

// Helper function to extract matching text snippets for highlighting
function extractMatchSnippets(thought, matches) {
  const snippets = [];

  if (!matches) return snippets;

  matches.forEach((match) => {
    const { key, indices } = match;
    let text = thought[key];

    // Skip if this key doesn't exist or isn't a string
    if (!text || typeof text !== "string") return;

    // Get context for each match (a few characters before and after)
    indices.forEach(([start, end]) => {
      // Get context around the match
      const contextStart = Math.max(0, start - 30);
      const contextEnd = Math.min(text.length, end + 30);

      // Extract the relevant section
      const prefix = start > contextStart ? "..." : "";
      const suffix = end < contextEnd ? "..." : "";
      const textSnippet =
        prefix + text.substring(contextStart, contextEnd) + suffix;

      // Mark the exact match position within the snippet for highlighting
      const matchStart = Math.max(0, start - contextStart);
      const matchEnd = Math.min(
        textSnippet.length,
        end - contextStart + prefix.length,
      );

      snippets.push({
        key,
        text: textSnippet,
        matchStart,
        matchEnd,
      });
    });
  });

  return snippets;
}

async function searchThoughts(query, options) {
  try {
    const thoughts = await getAllThoughts();

    // Filter thoughts based on options
    let filteredThoughts = thoughts;

    // Date filtering
    if (options.date) {
      const targetDate = parseISO(options.date);
      filteredThoughts = filteredThoughts.filter((thought) => {
        const thoughtDate = thought.date;
        return (
          format(thoughtDate, "yyyy-MM-dd") === format(targetDate, "yyyy-MM-dd")
        );
      });
    }

    if (options.before) {
      const beforeDate = parseISO(options.before);
      filteredThoughts = filteredThoughts.filter(
        (thought) =>
          isBefore(thought.date, beforeDate) ||
          isEqual(thought.date, beforeDate),
      );
    }

    if (options.after) {
      const afterDate = parseISO(options.after);
      filteredThoughts = filteredThoughts.filter(
        (thought) =>
          isAfter(thought.date, afterDate) || isEqual(thought.date, afterDate),
      );
    }

    // Text search - use fuzzy search if enabled
    if (query) {
      if (options.fuzzy) {
        filteredThoughts = performFuzzySearch(filteredThoughts, query, options);
      } else {
        // Regular search
        filteredThoughts = filteredThoughts.filter(
          (thought) =>
            thought.content.toLowerCase().includes(query.toLowerCase()) ||
            thought.title.toLowerCase().includes(query.toLowerCase()),
        );
      }
    }

    // Sort by date (newest first by default)
    filteredThoughts.sort((a, b) =>
      options.oldest ? a.date - b.date : b.date - a.date,
    );

    // Limit results if needed
    if (options.limit && options.limit > 0) {
      filteredThoughts = filteredThoughts.slice(0, options.limit);
    }

    if (filteredThoughts.length === 0) {
      console.log(chalk.yellow("No thoughts found matching your criteria."));
      return;
    }

    // Display results
    console.log(chalk.bold(`Found ${filteredThoughts.length} thought(s):\n`));

    filteredThoughts.forEach((thought, index) => {
      const formattedDate = format(thought.date, "yyyy-MM-dd HH:mm:ss");

      // Display score for fuzzy search results
      const scoreInfo =
        thought.score !== undefined
          ? ` ${chalk.cyan(`(match: ${Math.round((1 - thought.score) * 100)}%)`)}`
          : "";

      console.log(
        chalk.green(
          `${index + 1}. ${highlight(thought.title, query, thought.matches)} (${chalk.blue(formattedDate)})${scoreInfo}`,
        ),
      );

      // If we have fuzzy matches, extract and show snippets
      if (thought.matches && options.snippets !== false) {
        const snippets = extractMatchSnippets(thought, thought.matches).slice(
          0,
          2,
        ); // Limit to 2 snippets

        if (snippets.length > 0) {
          snippets.forEach((snippet) => {
            // Show which field the snippet is from
            const fieldName = snippet.key === "title" ? "Title" : "Content";
            console.log(
              chalk.gray(
                `   [${fieldName}]: ${highlight(snippet.text, query, [{ indices: [[snippet.matchStart, snippet.matchEnd]] }])}`,
              ),
            );
          });
        }
      } else if (options.preview) {
        // Get a preview of the content (first few lines, excluding the title)
        const contentLines = thought.content.split("\n");
        const previewLines = contentLines.slice(
          contentLines[0].startsWith("# ") ? 1 : 0,
          options.preview + (contentLines[0].startsWith("# ") ? 1 : 0),
        );
        const preview = previewLines.join("\n").trim();

        if (preview) {
          console.log(
            chalk.gray(
              `   ${highlight(preview.substring(0, 150) + (preview.length > 150 ? "..." : ""), query)}`,
            ),
          );
        }
      }

      // Make the path clickable if the terminal supports it
      const shortPath = thought.path.replace(DEFAULT_DIR, "~/thoughts");
      if (terminalLink.isSupported) {
        console.log(`   ${terminalLink(shortPath, `file://${thought.path}`)}`);
      } else {
        console.log(`   ${shortPath}`);
      }

      console.log(""); // Add a blank line between entries
    });

    // Offer to open one of the found thoughts
    if (filteredThoughts.length > 0 && !options.noPrompt) {
      const { choice } = await inquirer.prompt([
        {
          type: "input",
          name: "choice",
          message: "Enter number to open (or press Enter to cancel):",
          validate: (input) => {
            if (input === "") return true;
            const num = parseInt(input, 10);
            if (isNaN(num) || num < 1 || num > filteredThoughts.length) {
              return `Please enter a number between 1 and ${filteredThoughts.length}`;
            }
            return true;
          },
        },
      ]);

      if (choice !== "") {
        const selected = filteredThoughts[parseInt(choice, 10) - 1];
        await openEditor(selected.path);
      }
    }
  } catch (err) {
    console.error(`Error searching thoughts: ${err.message}`);
    process.exit(1);
  }
}

async function listRecentThoughts(options) {
  try {
    const limit = options.limit || 10;
    const thoughts = await getAllThoughts();

    thoughts.sort((a, b) => b.date - a.date);
    const recentThoughts = thoughts.slice(0, limit);

    if (recentThoughts.length === 0) {
      console.log(chalk.yellow("No thoughts found."));
      return;
    }

    console.log(chalk.bold(`${recentThoughts.length} most recent thoughts:\n`));

    recentThoughts.forEach((thought, index) => {
      const formattedDate = format(thought.date, "yyyy-MM-dd HH:mm:ss");
      console.log(
        chalk.green(
          `${index + 1}. ${thought.title} (${chalk.blue(formattedDate)})`,
        ),
      );

      // Make the path clickable if the terminal supports it
      const shortPath = thought.path.replace(DEFAULT_DIR, "~/thoughts");
      if (terminalLink.isSupported) {
        console.log(`   ${terminalLink(shortPath, `file://${thought.path}`)}`);
      } else {
        console.log(`   ${shortPath}`);
      }

      console.log(""); // Add a blank line between entries
    });

    // Offer to open one of the found thoughts
    if (recentThoughts.length > 0 && !options.noPrompt) {
      const { choice } = await inquirer.prompt([
        {
          type: "input",
          name: "choice",
          message: "Enter number to open (or press Enter to cancel):",
          validate: (input) => {
            if (input === "") return true;
            const num = parseInt(input, 10);
            if (isNaN(num) || num < 1 || num > recentThoughts.length) {
              return `Please enter a number between 1 and ${recentThoughts.length}`;
            }
            return true;
          },
        },
      ]);

      if (choice !== "") {
        const selected = recentThoughts[parseInt(choice, 10) - 1];
        await openEditor(selected.path);
      }
    }
  } catch (err) {
    console.error(`Error listing thoughts: ${err.message}`);
    process.exit(1);
  }
}

// Setup command line interface
program
  .command("new", { isDefault: true })
  .description("Create a new thought")
  .action(createThought);

program
  .command("search")
  .description("Search through your thoughts")
  .argument("[query]", "Search term to find in your thoughts")
  .option("-d, --date <date>", "Filter by specific date (YYYY-MM-DD)")
  .option("-b, --before <date>", "Find thoughts before a date (YYYY-MM-DD)")
  .option("-a, --after <date>", "Find thoughts after a date (YYYY-MM-DD)")
  .option(
    "-p, --preview <lines>",
    "Show a preview of content with specified number of lines",
    parseInt,
  )
  .option("-l, --limit <number>", "Limit the number of results", parseInt)
  .option("-o, --oldest", "Sort by oldest first (default is newest first)")
  .option("-f, --fuzzy", "Use fuzzy search instead of exact matching")
  .option(
    "-t, --threshold <number>",
    "Fuzzy search threshold (0-1, lower is stricter)",
    parseFloat,
  )
  .option(
    "-s, --snippets",
    "Show snippets of matching text in fuzzy search results",
    true,
  )
  .option("--no-prompt", "Disable interactive prompt to open found thoughts")
  .action((query, options) => {
    searchThoughts(query, options);
  });

program
  .command("list")
  .description("List recent thoughts")
  .option("-l, --limit <number>", "Limit the number of results", parseInt)
  .option("--no-prompt", "Disable interactive prompt to open found thoughts")
  .action((options) => {
    listRecentThoughts(options);
  });

program
  .command("open <index>")
  .description("Open a recent thought by its number (from list command)")
  .action(async (index) => {
    try {
      const thoughts = await getAllThoughts();
      thoughts.sort((a, b) => b.date - a.date);

      const idx = parseInt(index, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= thoughts.length) {
        console.error(
          `Invalid index. Please use a number between 1 and ${thoughts.length}.`,
        );
        process.exit(1);
      }

      await openEditor(thoughts[idx].path);
    } catch (err) {
      console.error(`Error opening thought: ${err.message}`);
      process.exit(1);
    }
  });

// Sync command with subcommands
program
  .command("sync")
  .description("Sync and backup your thoughts")
  .option("-i, --init", "Initialize Git repository for version control")
  .option(
    "-c, --commit [message]",
    "Commit changes to Git repository",
    "Update thoughts",
  )
  .option("-r, --remote <url>", "Set up remote Git repository")
  .option("-p, --push", "Push changes to remote repository")
  .option("-l, --pull", "Pull changes from remote repository")
  .option("-d, --dropbox [path]", "Sync with Dropbox")
  .option("-g, --gdrive [path]", "Sync with Google Drive")
  .action(async (options) => {
    try {
      if (options.init) {
        await initGit(DEFAULT_DIR);
      }

      if (options.commit) {
        await commitChanges(
          DEFAULT_DIR,
          options.commit === true ? "Update thoughts" : options.commit,
        );
      }

      if (options.remote) {
        await setupRemote(DEFAULT_DIR, options.remote);
      }

      if (options.push) {
        await pushChanges(DEFAULT_DIR);
      }

      if (options.pull) {
        await pullChanges(DEFAULT_DIR);
      }

      if (options.dropbox) {
        const targetPath =
          options.dropbox === true ? "/thoughts" : options.dropbox;
        await syncWithCloud(DEFAULT_DIR, "dropbox", targetPath);
      }

      if (options.gdrive) {
        const targetPath =
          options.gdrive === true ? "thoughts" : options.gdrive;
        await syncWithCloud(DEFAULT_DIR, "gdrive", targetPath);
      }

      // If no options specified, show help
      if (!Object.keys(options).some((key) => options[key])) {
        console.log(chalk.blue("Sync and backup options:"));
        console.log(
          "  --init            Initialize Git repository for version control",
        );
        console.log("  --commit [msg]    Commit changes to Git repository");
        console.log("  --remote <url>    Set up remote Git repository");
        console.log("  --push            Push changes to remote repository");
        console.log("  --pull            Pull changes from remote repository");
        console.log("  --dropbox [path]  Sync with Dropbox");
        console.log("  --gdrive [path]   Sync with Google Drive");
        console.log("");
        console.log("Examples:");
        console.log(
          "  thoughts sync --init                         Initialize Git repo",
        );
        console.log(
          '  thoughts sync --commit "Add meeting notes"   Commit changes',
        );
        console.log(
          "  thoughts sync --remote https://github.com/user/thoughts.git  Set remote",
        );
        console.log(
          "  thoughts sync --push                         Push to remote",
        );
        console.log(
          "  thoughts sync --dropbox                      Sync with Dropbox",
        );
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// Backup command
program
  .command("backup")
  .description("Backup your thoughts")
  .option("-p, --path <path>", "Custom backup directory path")
  .option(
    "-a, --auto <frequency>",
    "Set up automatic backups (daily, weekly, monthly)",
  )
  .action(async (options) => {
    try {
      if (options.auto) {
        if (!["daily", "weekly", "monthly"].includes(options.auto)) {
          console.log(
            chalk.yellow(
              "Invalid frequency. Please use daily, weekly, or monthly.",
            ),
          );
          return;
        }

        await setupAutomaticBackups(DEFAULT_DIR, options.auto);
      } else {
        // Create a one-time backup
        await createBackup(DEFAULT_DIR, options.path);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// TUI command - Interactive Terminal User Interface
program
  .command("tui")
  .description("Open thoughts in a terminal user interface")
  .action(async () => {
    try {
      // Ensure the thoughts directory exists
      await ensureDirectoryExists(DEFAULT_DIR);

      // Start the TUI
      await startTUI(DEFAULT_DIR);
    } catch (err) {
      console.error(`Error launching TUI: ${err.message}`);
      process.exit(1);
    }
  });

// Save URL command - save web content as a thought
program
  .command("save-url")
  .description("Save web content as a thought")
  .argument("<url>", "URL to save")
  .option("-s, --summarize", "Generate an AI summary with Claude")
  .option("-a, --audio", "Generate audio version of the summary (requires system TTS)")
  .option("-o, --open", "Open the saved thought in your editor after saving")
  .option("-f, --force", "Force reprocessing even if URL was already saved")
  .option("--voice <voice>", "Specify TTS voice to use (system-dependent)")
  .option("--api-key <key>", "Claude API key (can also be set via CLAUDE_API_KEY env var)")
  .option("--model <model>", "Claude model to use", "claude-3-opus-20240229")
  .option("--max-tokens <number>", "Maximum tokens for Claude response", "4000")
  .option("--temperature <number>", "Temperature for Claude response", "0.7")
  .action(async (url, options) => {
    try {
      // Ensure the thoughts directory exists
      await ensureDirectoryExists(DEFAULT_DIR);

      console.log(chalk.blue(`Saving content from ${url}...`));

      let result;
      
      // Add the force flag to options if specified
      options.force = options.force || false;
      
      // Check if we should use Claude for summarization
      if (options.summarize) {
        // Get API key from options or environment variable
        const apiKey = options.apiKey || process.env.CLAUDE_API_KEY;
        
        if (!apiKey) {
          console.log(chalk.yellow("No Claude API key provided. Use --api-key or set CLAUDE_API_KEY environment variable."));
          console.log(chalk.yellow("Proceeding without AI summarization..."));
          
          // Fall back to regular URL processing
          result = await processUrl(url, DEFAULT_DIR, options);
          
          if (result.isExisting && !options.force) {
            console.log(chalk.blue("URL was previously processed. Using existing content."));
          }
        } else {
          // Configure Claude processor
          const claudeProcessor = createClaudeProcessor(apiKey);
          
          // Override config if specified in options
          if (options.model) claudeProcessor.config.model = options.model;
          if (options.maxTokens) claudeProcessor.config.maxTokens = parseInt(options.maxTokens, 10);
          if (options.temperature) claudeProcessor.config.temperature = parseFloat(options.temperature);
          
          console.log(chalk.blue("Using Claude AI to enhance content..."));
          console.log(chalk.blue(`Model: ${claudeProcessor.config.model}`));
          
          // Process with Claude
          const summaryOptions = {
            includeKeyPoints: true,
            includeEntities: true,
            includeCodeSnippets: true,
            maxLength: 500,
            // Pass audio options
            audio: options.audio,
            generateAudio: options.audio,
            audioOptions: {
              voice: options.voice
            }
          };
          
          // Show spinner or processing message
          const startTime = Date.now();
          
          // Process the URL with Claude
          result = await claudeProcessor.processUrlWithClaude(url, DEFAULT_DIR, summaryOptions);
          
          const processingTime = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(chalk.green(`✓ Content processed with Claude in ${processingTime}s`));
          
          // Show detected entities if available
          if (result.metadata.detectedEntities) {
            const { technologies, people, companies } = result.metadata.detectedEntities;
            
            if (technologies && technologies.length > 0) {
              console.log(chalk.blue("Technologies detected:"), chalk.cyan(technologies.join(", ")));
            }
            
            if (people && people.length > 0) {
              console.log(chalk.blue("People mentioned:"), chalk.cyan(people.join(", ")));
            }
            
            if (companies && companies.length > 0) {
              console.log(chalk.blue("Organizations mentioned:"), chalk.cyan(companies.join(", ")));
            }
          }
        }
      } else {
        // Regular URL processing without Claude
        result = await processUrl(url, DEFAULT_DIR, options);
        
        if (result.isExisting && !options.force) {
          console.log(chalk.blue("URL was previously processed. Using existing content."));
        }
      }

      // Save the thought
      const thoughtPath = path.join(DEFAULT_DIR, result.thoughtFilename);
      await fs.writeFile(thoughtPath, result.thoughtContent);

      console.log(chalk.green("✓ Content saved successfully!"));
      console.log(chalk.blue(`Saved to: ${thoughtPath}`));
      console.log(chalk.blue(`Title: ${result.metadata.title}`));
      console.log(
        chalk.blue(`Word count: ${result.metadata.contentStats.wordCount}`),
      );
      console.log(
        chalk.blue(
          `Reading time: ~${result.metadata.contentStats.estimatedReadingTimeMinutes} minutes`,
        ),
      );
      
      // Show audio info if available
      if (result.metadata.content.audioPath) {
        console.log(
          chalk.blue(`Audio summary: ${path.join(DEFAULT_DIR, result.metadata.content.audioPath)}`),
        );
      }

      // Open the thought if needed
      if (options.open) {
        await openEditor(thoughtPath);
      }

      // Auto-commit if git is set up
      await autoCommitChanges();
    } catch (err) {
      console.error(chalk.red(`Error saving URL: ${err.message}`));
      if (err.response && err.response.data) {
        console.error(chalk.red("API Error details:"), err.response.data);
      }
      process.exit(1);
    }
  });

// Add a hook to automatically commit changes after creating or editing a thought
async function autoCommitChanges() {
  // Check if Git repository exists
  try {
    const files = await fs.readdir(DEFAULT_DIR);
    if (files.includes(".git")) {
      await commitChanges(DEFAULT_DIR, "Auto-commit: Update thoughts");
    }
  } catch (error) {
    // Silently fail if auto-commit doesn't work
  }
}

// Add auto-commit to createThought
const originalCreateThought = createThought;
createThought = async function () {
  await originalCreateThought();
  await autoCommitChanges();
};

// Todo matrix command
program
  .command("todo")
  .description("Manage your todos using the Eisenhower Matrix")
  .option("-a, --add", "Add a new todo")
  .option("-l, --list", "List all todos")
  .option("-t, --toggle <id>", "Toggle completion status (accepts friendly IDs like A1, B2)")
  .option("-e, --edit <id>", "Edit a todo (accepts friendly IDs like A1, B2)")
  .option("-d, --delete <id>", "Delete a todo (accepts friendly IDs like A1, B2)")
  .option("-v, --view <id>", "View todo details (accepts friendly IDs like A1, B2)")
  .option("-s, --search <text>", "Search todos")
  .option("--priority <high|low>", "Filter by priority")
  .option("--urgency <urgent|not-urgent>", "Filter by urgency")
  .option("--completed", "Filter by completed status")
  .option("--active", "Filter by active status")
  .option("--convert <id>", "Convert todo to thought (accepts friendly IDs like A1, B2)")
  .option("--from-thought <path>", "Create todo from thought")
  .action(async (options) => {
    try {
      // Ensure the thoughts directory exists
      await ensureDirectoryExists(DEFAULT_DIR);
      
      // If no options are specified or only general options, start the TUI
      const specificActionOptions = [
        'add', 'list', 'toggle', 'edit', 'delete', 'view', 'search',
        'convert', 'fromThought'
      ];
      
      const hasSpecificAction = specificActionOptions.some(opt => options[opt]);
      
      if (!hasSpecificAction) {
        // Launch TUI
        await startTodoTUI(DEFAULT_DIR);
        return;
      }
      
      // Handle specific commands
      if (options.add) {
        const { title, priority, urgency, tags, description } = await inquirer.prompt([
          {
            type: 'input',
            name: 'title',
            message: 'Todo title:',
            validate: input => input ? true : 'Title is required',
          },
          {
            type: 'list',
            name: 'priority',
            message: 'Priority:',
            choices: [
              { name: 'High', value: 'high' },
              { name: 'Low', value: 'low' },
            ],
            default: 'low',
          },
          {
            type: 'list',
            name: 'urgency',
            message: 'Urgency:',
            choices: [
              { name: 'Urgent', value: 'urgent' },
              { name: 'Not Urgent', value: 'not-urgent' },
            ],
            default: 'not-urgent',
          },
          {
            type: 'input',
            name: 'tags',
            message: 'Tags (comma separated):',
          },
          {
            type: 'input',
            name: 'description',
            message: 'Description:',
          },
        ]);
        
        const todo = todoMatrix.createTodo(title, {
          priority,
          urgency,
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          description,
        });
        
        await todoMatrix.addTodo(DEFAULT_DIR, todo);
        console.log(chalk.green(`Todo added: ${title}`));
      }
      
      if (options.list) {
        // Get todo matrix
        const matrix = await todoMatrix.loadTodoMatrix(DEFAULT_DIR);
        
        // Apply filters if specified
        let filteredTodos = [];
        
        for (const quadrant of ['important_urgent', 'important_not_urgent', 'not_important_urgent', 'not_important_not_urgent']) {
          // Apply filters within each quadrant
          let todos = [...matrix[quadrant]];
          
          if (options.completed) {
            todos = todos.filter(todo => todo.completed);
          } else if (options.active) {
            todos = todos.filter(todo => !todo.completed);
          }
          
          if (options.priority) {
            todos = todos.filter(todo => todo.priority === options.priority);
          }
          
          if (options.urgency) {
            todos = todos.filter(todo => todo.urgency === options.urgency);
          }
          
          if (options.search) {
            const searchText = options.search.toLowerCase();
            todos = todos.filter(todo => 
              todo.title.toLowerCase().includes(searchText) ||
              todo.description.toLowerCase().includes(searchText)
            );
          }
          
          if (todos.length > 0) {
            const color = todoMatrix.getQuadrantColor(quadrant);
            const title = todoMatrix.getQuadrantName(quadrant);
            
            filteredTodos.push({
              quadrant,
              title,
              color,
              todos,
            });
          }
        }
        
        // Display results
        if (filteredTodos.length === 0) {
          console.log(chalk.yellow('No todos match the specified filters.'));
        } else {
          for (const { quadrant, title, color, todos } of filteredTodos) {
            console.log(color(`\n${title} (${todos.length}):`));
            console.log(color('-'.repeat(title.length + 10)));
            
            todos.forEach((todo, i) => {
              // Generate a display ID for each todo using our helper function
              const displayId = todoMatrix.generateDisplayId(matrix, todo);
              // Store the display ID on the todo for future reference
              todo.displayId = displayId;
              
              const status = todo.completed ? '✓' : '☐';
              const titleText = todo.completed ? chalk.gray(todo.title) : todo.title;
              console.log(`${i + 1}. ${chalk.bold(displayId)}: [${status}] ${titleText}`);
              
              if (todo.tags.length > 0) {
                console.log(`   Tags: ${todo.tags.join(', ')}`);
              }
              
              if (todo.description) {
                const shortDesc = todo.description.length > 50 
                  ? todo.description.substring(0, 47) + '...'
                  : todo.description;
                console.log(`   ${chalk.gray(shortDesc)}`);
              }
            });
          }
          
          // Add a helpful tip at the end
          console.log(chalk.blue("\nTip: You can now use the short IDs (A1, B2, etc.) with commands:"));
          console.log(chalk.blue("  thoughts todo --toggle A1"));
          console.log(chalk.blue("  thoughts todo --edit B2"));
          console.log(chalk.blue("  thoughts todo --view C3"));
        }
      }
      
      if (options.toggle) {
        await todoMatrix.toggleTodo(DEFAULT_DIR, options.toggle);
        const todo = await todoMatrix.getTodoById(DEFAULT_DIR, options.toggle);
        
        if (todo) {
          console.log(chalk.green(`Todo status updated: [${todo.completed ? '✓' : '☐'}] ${todo.title}`));
        }
      }
      
      if (options.edit) {
        const todo = await todoMatrix.getTodoById(DEFAULT_DIR, options.edit);
        
        if (!todo) {
          console.log(chalk.red(`Todo with ID ${options.edit} not found.`));
          return;
        }
        
        const { title, priority, urgency, completed, tags, description } = await inquirer.prompt([
          {
            type: 'input',
            name: 'title',
            message: 'Todo title:',
            default: todo.title,
            validate: input => input ? true : 'Title is required',
          },
          {
            type: 'list',
            name: 'priority',
            message: 'Priority:',
            choices: [
              { name: 'High', value: 'high' },
              { name: 'Low', value: 'low' },
            ],
            default: todo.priority,
          },
          {
            type: 'list',
            name: 'urgency',
            message: 'Urgency:',
            choices: [
              { name: 'Urgent', value: 'urgent' },
              { name: 'Not Urgent', value: 'not-urgent' },
            ],
            default: todo.urgency,
          },
          {
            type: 'confirm',
            name: 'completed',
            message: 'Completed:',
            default: todo.completed,
          },
          {
            type: 'input',
            name: 'tags',
            message: 'Tags (comma separated):',
            default: todo.tags.join(', '),
          },
          {
            type: 'input',
            name: 'description',
            message: 'Description:',
            default: todo.description,
          },
        ]);
        
        const updates = {
          title,
          priority,
          urgency,
          completed,
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          description,
        };
        
        await todoMatrix.updateTodo(DEFAULT_DIR, options.edit, updates);
        console.log(chalk.green(`Todo updated: ${title}`));
      }
      
      if (options.delete) {
        const todo = await todoMatrix.getTodoById(DEFAULT_DIR, options.delete);
        
        if (!todo) {
          console.log(chalk.red(`Todo with ID ${options.delete} not found.`));
          return;
        }
        
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to delete todo "${todo.title}"?`,
            default: false,
          },
        ]);
        
        if (confirm) {
          await todoMatrix.deleteTodo(DEFAULT_DIR, options.delete);
          console.log(chalk.green(`Todo deleted: ${todo.title}`));
        }
      }
      
      if (options.view) {
        const todo = await todoMatrix.getTodoById(DEFAULT_DIR, options.view);
        
        if (!todo) {
          console.log(chalk.red(`Todo with ID ${options.view} not found.`));
          return;
        }
        
        const quadrant = todoMatrix.getQuadrantKey(todo);
        const quadrantName = todoMatrix.getQuadrantName(quadrant);
        const color = todoMatrix.getQuadrantColor(quadrant);
        
        // Generate the user-friendly display ID
        const matrix = await todoMatrix.loadTodoMatrix(DEFAULT_DIR);
        const displayId = todoMatrix.generateDisplayId(matrix, todo);
        
        console.log(color(`\n${todo.title}`));
        console.log(color('-'.repeat(todo.title.length + 10)));
        console.log(`ID: ${chalk.bold(displayId)} (internal: ${todo.id.substring(0, 8)}...)`);
        console.log(`Status: ${todo.completed ? '✓ Completed' : '☐ Active'}`);
        console.log(`Quadrant: ${quadrantName}`);
        console.log(`Priority: ${todo.priority === 'high' ? 'High' : 'Low'}`);
        console.log(`Urgency: ${todo.urgency === 'urgent' ? 'Urgent' : 'Not Urgent'}`);
        
        if (todo.completedAt) {
          console.log(`Completed: ${new Date(todo.completedAt).toLocaleString()}`);
        }
        
        console.log(`Created: ${new Date(todo.createdAt).toLocaleString()}`);
        
        if (todo.tags.length > 0) {
          console.log(`Tags: ${todo.tags.join(', ')}`);
        }
        
        if (todo.description) {
          console.log(`\nDescription:\n${todo.description}`);
        }
        
        if (todo.links.length > 0) {
          console.log(`\nLinks:`);
          todo.links.forEach((link, i) => {
            console.log(`${i + 1}. ${link}`);
          });
        }
        
        // Show hint about using the ID in commands
        console.log(chalk.blue(`\nTip: You can refer to this todo with the ID ${chalk.bold(displayId)} in commands like:`));
        console.log(chalk.blue(`  thoughts todo --toggle ${displayId}`));
        console.log(chalk.blue(`  thoughts todo --edit ${displayId}`));
      }
      
      if (options.search) {
        const results = await todoMatrix.searchTodos(DEFAULT_DIR, { text: options.search });
        
        if (results.length === 0) {
          console.log(chalk.yellow(`No todos found matching "${options.search}".`));
        } else {
          console.log(chalk.blue(`\nSearch results for "${options.search}" (${results.length}):`));
          console.log(chalk.blue('-'.repeat(50)));
          
          // Group results by quadrant to maintain correct numbering
          const todosByQuadrant = {
            'important_urgent': [],
            'important_not_urgent': [],
            'not_important_urgent': [],
            'not_important_not_urgent': []
          };
          
          // Load the full matrix for generating display IDs
          const matrix = await todoMatrix.loadTodoMatrix(DEFAULT_DIR);
          
          // First pass: group todos by quadrant
          results.forEach(todo => {
            const quadrant = todoMatrix.getQuadrantKey(todo);
            todosByQuadrant[quadrant].push(todo);
          });
          
          // Second pass: display todos with correct IDs
          let displayIndex = 1;
          
          // Display each quadrant's todos
          for (const [quadrant, todos] of Object.entries(todosByQuadrant)) {
            if (todos.length === 0) continue;
            
            console.log(chalk.bold(`\n${todoMatrix.getQuadrantName(quadrant)}:`));
            
            todos.forEach((todo, i) => {
              // Generate a display ID for each todo
              const displayId = todoMatrix.generateDisplayId(matrix, todo);
              const status = todo.completed ? '✓' : '☐';
              const titleText = todo.completed ? chalk.gray(todo.title) : todo.title;
              
              // Store the human-readable ID for reference
              todo.displayId = displayId;
              
              console.log(`${displayIndex}. ${chalk.bold(displayId)}: [${status}] ${titleText}`);
              displayIndex++;
              
              if (todo.tags.length > 0) {
                console.log(`   Tags: ${todo.tags.join(', ')}`);
              }
              
              if (todo.description) {
                const shortDesc = todo.description.length > 50 
                  ? todo.description.substring(0, 47) + '...'
                  : todo.description;
                console.log(`   ${chalk.gray(shortDesc)}`);
              }
              
              console.log('');
            });
            
            // Add a helpful tip at the end
            console.log(chalk.blue("\nTip: You can now use the short IDs (A1, B2, etc.) with commands:"));
            console.log(chalk.blue("  thoughts todo --toggle A1"));
            console.log(chalk.blue("  thoughts todo --edit B2"));
            console.log(chalk.blue("  thoughts todo --view C3"));
          }
        }
      }
      
      if (options.convert) {
        const todo = await todoMatrix.getTodoById(DEFAULT_DIR, options.convert);
        
        if (!todo) {
          console.log(chalk.red(`Todo with ID ${options.convert} not found.`));
          return;
        }
        
        const filePath = await todoMatrix.todoToThought(DEFAULT_DIR, options.convert);
        console.log(chalk.green(`Created thought from todo: ${filePath}`));
      }
      
      if (options.fromThought) {
        const thoughtPath = path.isAbsolute(options.fromThought)
          ? options.fromThought
          : path.join(DEFAULT_DIR, options.fromThought);
        
        if (!await fs.pathExists(thoughtPath)) {
          console.log(chalk.red(`Thought file not found: ${thoughtPath}`));
          return;
        }
        
        const todo = await todoMatrix.thoughtToTodo(DEFAULT_DIR, thoughtPath);
        console.log(chalk.green(`Created todo from thought: ${todo.title}`));
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);
