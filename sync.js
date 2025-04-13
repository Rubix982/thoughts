#!/usr/bin/env node

/**
 * @license
 * MIT License
 *
 * Copyright (c) 2025 Thoughts Contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { promises as fs } from "fs";
import fs_extra from "fs-extra";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import simpleGit from "simple-git";
import chalk from "chalk";

const execAsync = promisify(exec);

/**
 * Initialize a Git repository in the thoughts directory
 * @param {string} dir - The thoughts directory path
 */
export async function initGit(dir) {
  try {
    const git = simpleGit(dir);
    const isGitRepo = await git.checkIsRepo().catch(() => false);

    if (!isGitRepo) {
      console.log(chalk.blue("Initializing Git repository for thoughts..."));
      await git.init();

      // Create .gitignore file
      const gitignorePath = path.join(dir, ".gitignore");
      await fs.writeFile(
        gitignorePath,
        `# Thoughts Git repository
.DS_Store
.thoughts_config.json
*.tmp
`,
      );

      // Initial commit
      await git.add(".gitignore");
      await git.commit("Initial commit: Set up thoughts repository");
      console.log(chalk.green("Git repository initialized successfully!"));
    } else {
      console.log(chalk.blue("Git repository already exists."));
    }

    return true;
  } catch (error) {
    console.error(
      chalk.red(`Error initializing Git repository: ${error.message}`),
    );
    return false;
  }
}

/**
 * Commit changes to the Git repository
 * @param {string} dir - The thoughts directory path
 * @param {string} message - The commit message
 */
export async function commitChanges(dir, message = "Update thoughts") {
  try {
    const git = simpleGit(dir);
    const isGitRepo = await git.checkIsRepo().catch(() => false);

    if (!isGitRepo) {
      console.log(chalk.yellow("No Git repository found. Initializing..."));
      const initialized = await initGit(dir);
      if (!initialized) return false;
    }

    // Check for changes
    const status = await git.status();

    if (
      status.modified.length === 0 &&
      status.not_added.length === 0 &&
      status.deleted.length === 0
    ) {
      console.log(chalk.blue("No changes to commit."));
      return true;
    }

    // Add all changes
    await git.add(".");

    // Commit changes
    await git.commit(message);
    console.log(chalk.green("Changes committed successfully!"));

    return true;
  } catch (error) {
    console.error(chalk.red(`Error committing changes: ${error.message}`));
    return false;
  }
}

/**
 * Set up a remote Git repository
 * @param {string} dir - The thoughts directory path
 * @param {string} remoteUrl - The remote repository URL
 */
export async function setupRemote(dir, remoteUrl) {
  try {
    const git = simpleGit(dir);
    const isGitRepo = await git.checkIsRepo().catch(() => false);

    if (!isGitRepo) {
      console.log(chalk.yellow("No Git repository found. Initializing..."));
      const initialized = await initGit(dir);
      if (!initialized) return false;
    }

    // Check if remote already exists
    const remotes = await git.getRemotes();
    const originExists = remotes.some((remote) => remote.name === "origin");

    if (originExists) {
      // Update the remote URL
      await git.remote(["set-url", "origin", remoteUrl]);
      console.log(chalk.green("Remote repository updated successfully!"));
    } else {
      // Add the remote
      await git.addRemote("origin", remoteUrl);
      console.log(chalk.green("Remote repository added successfully!"));
    }

    return true;
  } catch (error) {
    console.error(
      chalk.red(`Error setting up remote repository: ${error.message}`),
    );
    return false;
  }
}

/**
 * Push changes to the remote repository
 * @param {string} dir - The thoughts directory path
 */
export async function pushChanges(dir) {
  try {
    const git = simpleGit(dir);
    const isGitRepo = await git.checkIsRepo().catch(() => false);

    if (!isGitRepo) {
      console.log(chalk.yellow("No Git repository found. Cannot push."));
      return false;
    }

    // Check if remote exists
    const remotes = await git.getRemotes();
    const originExists = remotes.some((remote) => remote.name === "origin");

    if (!originExists) {
      console.log(
        chalk.yellow(
          'No remote repository configured. Use "thoughts sync --remote URL" to configure.',
        ),
      );
      return false;
    }

    // Push to remote
    await git.push("origin", "master");
    console.log(chalk.green("Changes pushed to remote repository!"));

    return true;
  } catch (error) {
    console.error(chalk.red(`Error pushing changes: ${error.message}`));
    return false;
  }
}

/**
 * Pull changes from the remote repository
 * @param {string} dir - The thoughts directory path
 */
export async function pullChanges(dir) {
  try {
    const git = simpleGit(dir);
    const isGitRepo = await git.checkIsRepo().catch(() => false);

    if (!isGitRepo) {
      console.log(chalk.yellow("No Git repository found. Cannot pull."));
      return false;
    }

    // Check if remote exists
    const remotes = await git.getRemotes();
    const originExists = remotes.some((remote) => remote.name === "origin");

    if (!originExists) {
      console.log(
        chalk.yellow(
          'No remote repository configured. Use "thoughts sync --remote URL" to configure.',
        ),
      );
      return false;
    }

    // Pull from remote
    await git.pull("origin", "master");
    console.log(
      chalk.green("Successfully pulled changes from remote repository!"),
    );

    return true;
  } catch (error) {
    console.error(chalk.red(`Error pulling changes: ${error.message}`));
    return false;
  }
}

/**
 * Create a backup of the thoughts directory
 * @param {string} sourceDir - The thoughts directory to backup
 * @param {string} backupDir - The directory to store backups (optional)
 */
export async function createBackup(sourceDir, backupDir = null) {
  try {
    // If no backup directory specified, create one in the user's home directory
    if (!backupDir) {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      backupDir = path.join(homeDir, "thoughts_backup");
    }

    // Create backup directory if it doesn't exist
    await fs_extra.ensureDir(backupDir);

    // Create a timestamped backup folder
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `thoughts_backup_${timestamp}`);

    // Copy all files from thoughts directory to backup
    await fs_extra.copy(sourceDir, backupPath, {
      filter: (src) => {
        // Skip .git directory during backup
        return !src.includes(".git");
      },
    });

    console.log(chalk.green(`Backup created successfully at: ${backupPath}`));
    return backupPath;
  } catch (error) {
    console.error(chalk.red(`Error creating backup: ${error.message}`));
    return null;
  }
}

/**
 * Sync with cloud services like Dropbox or Google Drive
 * @param {string} dir - The thoughts directory
 * @param {string} service - The cloud service to sync with ('dropbox', 'gdrive')
 * @param {string} targetPath - The target path in the cloud service
 */
export async function syncWithCloud(dir, service, targetPath) {
  try {
    switch (service.toLowerCase()) {
      case "dropbox": {
        // Check if Dropbox CLI is installed
        try {
          await execAsync("which dbxcli");
        } catch (error) {
          console.log(
            chalk.yellow("Dropbox CLI not found. Please install it first:"),
          );
          console.log(chalk.blue("See: https://github.com/dropbox/dbxcli"));
          return false;
        }

        const targetDir = targetPath || "/thoughts";

        // Create directory in Dropbox if it doesn't exist
        try {
          await execAsync(`dbxcli mkdir ${targetDir}`);
        } catch (error) {
          // Directory might already exist, which is fine
        }

        // Upload files to Dropbox
        const files = await fs.readdir(dir);
        for (const file of files) {
          if (file === ".git" || file === ".gitignore") continue;

          const filePath = path.join(dir, file);
          const stats = await fs.stat(filePath);

          if (stats.isFile()) {
            await execAsync(`dbxcli put ${filePath} ${targetDir}/${file}`);
            console.log(chalk.blue(`Uploaded ${file} to Dropbox`));
          }
        }

        console.log(chalk.green("Successfully synced with Dropbox!"));
        return true;
      }

      case "gdrive": {
        // Check if Google Drive CLI is installed
        try {
          await execAsync("which drive");
        } catch (error) {
          console.log(
            chalk.yellow(
              "Google Drive CLI not found. Please install it first:",
            ),
          );
          console.log(chalk.blue("See: https://github.com/odeke-em/drive"));
          return false;
        }

        const targetDir = targetPath || "thoughts";

        // Create a temporary directory for Google Drive sync
        const tempDir = path.join(
          process.env.HOME || process.env.USERPROFILE,
          ".thoughts_gdrive_sync",
        );
        await fs_extra.ensureDir(tempDir);

        // Initialize Google Drive in the temp directory if needed
        try {
          await execAsync("drive init", { cwd: tempDir });
        } catch (error) {
          // Might already be initialized
        }

        // Create the target directory structure
        const syncDir = path.join(tempDir, targetDir);
        await fs_extra.ensureDir(syncDir);

        // Copy files to the sync directory
        await fs_extra.copy(dir, syncDir, {
          filter: (src) => {
            return !src.includes(".git") && !src.includes(".gitignore");
          },
        });

        // Push to Google Drive
        await execAsync(`drive push -no-prompt ${targetDir}`, { cwd: tempDir });

        console.log(chalk.green("Successfully synced with Google Drive!"));

        // Clean up temp directory
        await fs_extra.remove(tempDir);
        return true;
      }

      default:
        console.log(chalk.yellow(`Unsupported cloud service: ${service}`));
        console.log(chalk.blue("Supported services: dropbox, gdrive"));
        return false;
    }
  } catch (error) {
    console.error(
      chalk.red(`Error syncing with cloud service: ${error.message}`),
    );
    return false;
  }
}

/**
 * Set up automatic backups using cron
 * @param {string} dir - The thoughts directory
 * @param {string} frequency - The backup frequency ('daily', 'weekly', 'monthly')
 */
export async function setupAutomaticBackups(dir, frequency) {
  try {
    // Check if crontab is available
    try {
      await execAsync("which crontab");
    } catch (error) {
      console.log(
        chalk.yellow("Crontab not found. Cannot set up automatic backups."),
      );
      return false;
    }

    // Get the absolute path to the thoughts script
    const scriptsDir = path.dirname(process.argv[1]);
    const thoughtsPath = path.resolve(process.argv[1]);

    // Create backup script
    const backupScriptPath = path.join(scriptsDir, "thoughts_backup.sh");

    let cronSchedule;
    switch (frequency) {
      case "daily":
        cronSchedule = "0 0 * * *"; // At midnight every day
        break;
      case "weekly":
        cronSchedule = "0 0 * * 0"; // At midnight on Sunday
        break;
      case "monthly":
        cronSchedule = "0 0 1 * *"; // At midnight on the first day of the month
        break;
      default:
        cronSchedule = "0 0 * * *"; // Default to daily
    }

    // Create backup script
    const backupScript = `#!/bin/bash
# Automatic backup script for thoughts
${thoughtsPath} backup
`;

    await fs.writeFile(backupScriptPath, backupScript);
    await execAsync(`chmod +x ${backupScriptPath}`);

    // Add to crontab
    const cronCommand = `(crontab -l 2>/dev/null || echo "") | grep -v "${backupScriptPath}" | { cat; echo "${cronSchedule} ${backupScriptPath}"; } | crontab -`;
    await execAsync(cronCommand);

    console.log(chalk.green(`Automatic backups set up to run ${frequency}!`));
    return true;
  } catch (error) {
    console.error(
      chalk.red(`Error setting up automatic backups: ${error.message}`),
    );
    return false;
  }
}
