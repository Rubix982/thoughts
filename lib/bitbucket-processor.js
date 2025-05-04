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

import axios from "axios";
import { promises as fs } from "fs";
import path from "path";
import chalk from "chalk";
import { format } from "date-fns";
import slugify from "slugify";
import { v4 as uuidv4 } from "uuid";
import { ClaudeProcessor } from "./claude-processor.js";

/**
 * Class to handle Bitbucket PR integration
 */
export class BitbucketProcessor {
  constructor(baseUrl, username, appPassword) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.username = username;
    this.appPassword = appPassword;
    this.isBitbucketCloud = this.baseUrl.includes("bitbucket.org");

    // For Bitbucket Cloud, use the API URL
    const apiBaseURL = this.isBitbucketCloud
      ? "https://api.bitbucket.org"
      : this.baseUrl;

    // Configure client with appropriate auth
    const clientConfig = {
      baseURL: apiBaseURL,
      headers: {
        "Content-Type": "application/json",
      },
    };

    // For Bitbucket Cloud, we can try different auth strategies
    if (this.isBitbucketCloud) {
      // If the appPassword looks like a token (>20 chars, no spaces), use Bearer token
      if (
        this.appPassword &&
        this.appPassword.length > 20 &&
        !this.appPassword.includes(" ")
      ) {
        console.log("Using Authorization Bearer token for Bitbucket Cloud");
        clientConfig.headers["Authorization"] = `Bearer ${this.appPassword}`;
      } else {
        // Otherwise use Basic Auth
        console.log("Using Basic Auth for Bitbucket Cloud");
        clientConfig.auth = {
          username: this.username,
          password: this.appPassword,
        };
      }
    } else {
      // For Bitbucket Server, always use Basic Auth
      clientConfig.auth = {
        username: this.username,
        password: this.appPassword,
      };
    }

    this.client = axios.create(clientConfig);

    console.log(`Initialized BitbucketProcessor with baseUrl: ${this.baseUrl}`);
    console.log(`Using API baseURL: ${apiBaseURL}`);
    console.log(`Is Bitbucket Cloud: ${this.isBitbucketCloud}`);
  }

  /**
   * Test the API connection and auth credentials
   * @returns {Promise<Object>} - Results of the test
   */
  async testConnection() {
    console.log("Testing Bitbucket API connection...");

    try {
      // For auth testing, we'll use a simple endpoint that requires authentication
      // but doesn't need specific permissions beyond basic read access
      let endpoint, authInfo;

      if (this.isBitbucketCloud) {
        // Test with a simple Cloud endpoint
        endpoint = "/2.0/user";
        console.log(`Testing Bitbucket Cloud auth with endpoint: ${endpoint}`);

        // Try different auth methods
        try {
          // 1. Try with basic auth
          console.log("Trying with HTTP Basic Auth...");
          const authResponse = await axios.get(
            `https://api.bitbucket.org${endpoint}`,
            {
              auth: {
                username: this.username,
                password: this.appPassword,
              },
            },
          );
          authInfo = authResponse.data;
          console.log("✓ Basic Auth successful!");
        } catch (authError) {
          console.log(`✗ Basic Auth failed: ${authError.message}`);

          if (authError.response) {
            console.log(`Status: ${authError.response.status}`);
            console.log(
              `Headers: ${JSON.stringify(authError.response.headers)}`,
            );

            if (authError.response.data) {
              console.log(
                `Response data: ${JSON.stringify(authError.response.data)}`,
              );
            }
          }

          // 2. Try with OAuth header style
          try {
            console.log("Trying with Bearer token...");
            const bearerResponse = await axios.get(
              `https://api.bitbucket.org${endpoint}`,
              {
                headers: {
                  Authorization: `Bearer ${this.appPassword}`,
                },
              },
            );
            authInfo = bearerResponse.data;
            console.log("✓ Bearer token successful!");
          } catch (bearerError) {
            console.log(`✗ Bearer token failed: ${bearerError.message}`);

            // 3. Try with API key in query
            try {
              console.log("Trying with API key in query...");
              const apiKeyResponse = await axios.get(
                `https://api.bitbucket.org${endpoint}?access_token=${this.appPassword}`,
              );
              authInfo = apiKeyResponse.data;
              console.log("✓ API key query successful!");
            } catch (apiKeyError) {
              console.log(`✗ API key query failed: ${apiKeyError.message}`);
              throw new Error("All authentication methods failed");
            }
          }
        }
      } else {
        // Test with a Server endpoint
        endpoint = "/rest/api/1.0/projects";
        console.log(`Testing Bitbucket Server auth with endpoint: ${endpoint}`);

        const response = await this.client.get(endpoint);
        authInfo = response.data;
      }

      return {
        success: true,
        message: "Authentication successful",
        details: authInfo,
      };
    } catch (error) {
      console.error("Authentication test failed:", error.message);

      let errorDetails = {
        message: error.message,
      };

      if (error.response) {
        errorDetails.status = error.response.status;
        errorDetails.statusText = error.response.statusText;
        errorDetails.data = error.response.data;

        // Provide more specific error messages for common issues
        if (error.response.status === 401) {
          errorDetails.suggestion =
            "Your credentials (username or app password) may be incorrect or the app password may not have the required permissions. For Bitbucket Cloud, ensure your app password has 'Repository' and 'Pull Request' read permissions.";
        } else if (error.response.status === 403) {
          errorDetails.suggestion =
            "You don't have permission to access this resource. Ensure your app password has sufficient permissions.";
        } else if (error.response.status === 404) {
          errorDetails.suggestion =
            "The endpoint couldn't be found. Verify that the baseUrl is correct.";
        }
      }

      return {
        success: false,
        message: "Authentication failed",
        error: errorDetails,
      };
    }
  }

  /**
   * Extract repository and PR info from URL
   * @param {string} url - The Bitbucket PR URL
   * @returns {Object} - Repository and PR information
   */
  parsePrUrl(url) {
    // Handle multiple Bitbucket URL formats:
    // 1. Bitbucket Server URLs like:
    //    https://bitbucket.example.com/projects/PROJECT/repos/REPO/pull-requests/123
    // 2. Bitbucket Cloud URLs with UUID like:
    //    https://bitbucket.org/workspace/%7Brepo-uuid%7D/pull-requests/123
    //    Example: https://bitbucket.org/securitiai/%7Ba521bb3e-e683-43b1-9ef9-593bdc202ea4%7D/pull-requests/32819

    console.log(`Parsing URL: ${url}`);

    // Server format
    const serverRegex =
      /\/projects\/([^\/]+)\/repos\/([^\/]+)\/pull-requests\/(\d+)/;

    // Cloud format with encoded braces in repo UUID
    const cloudRegex =
      /bitbucket\.org\/([^\/]+)\/(%7B[^%]+%7D)\/pull-requests\/(\d+)/;

    let matches = url.match(serverRegex);

    if (matches) {
      console.log("Matched Bitbucket Server URL pattern");
      return {
        projectKey: matches[1],
        repoSlug: matches[2],
        prId: matches[3],
      };
    }

    matches = url.match(cloudRegex);

    if (matches) {
      const workspace = matches[1]; // Workspace/Team name (e.g., "securitiai")
      const encodedRepoId = matches[2]; // URL-encoded repo UUID with braces
      const prId = matches[3];

      // Extract the UUID without braces and URL encoding
      // Convert %7Ba521bb3e-e683-43b1-9ef9-593bdc202ea4%7D to a521bb3e-e683-43b1-9ef9-593bdc202ea4
      const repoId = encodedRepoId.replace(/%7B(.*?)%7D/, "$1");

      console.log(
        `Matched Bitbucket Cloud URL pattern: workspace=${workspace}, repoId=${repoId}, prId=${prId}`,
      );

      return {
        workspace: workspace,
        repoId: repoId,
        prId: prId,
      };
    }

    throw new Error(`Invalid Bitbucket PR URL format: ${url}`);
  }

  /**
   * Fetch PR details from Bitbucket
   * @param {string} url - The Bitbucket PR URL
   * @returns {Promise<Object>} - PR details
   */
  async fetchPRDetails(url, options = {}) {
    try {
      const prInfo = this.parsePrUrl(url);
      let prResponse, changesResponse, commentsResponse;
      // Additional data for enhanced PR summaries
      let commitsResponse,
        diffstatResponse,
        activitiesResponse,
        statusesResponse,
        tasksResponse;

      if (this.isBitbucketCloud) {
        // Bitbucket Cloud API endpoints
        if (!prInfo.workspace || !prInfo.repoId) {
          throw new Error(
            "Missing workspace or repository ID for Bitbucket Cloud URL",
          );
        }

        const workspace = prInfo.workspace; // Workspace name (e.g., "securitiai")
        const repoId = prInfo.repoId; // Repository UUID without braces
        const prId = prInfo.prId;

        console.log(
          `Fetching PR details for Bitbucket Cloud repository: ${workspace}/${repoId}`,
        );

        // Create a client for this specific repository
        // If repoToken is provided in options, use it
        const repoClient = this.createRepoClient(
          workspace,
          repoId,
          options.repoToken,
        );

        // Try different repository ID formats
        let baseEndpoint = `/2.0/repositories/${workspace}/${repoId}/pullrequests/${prId}`;
        let encodedEndpoint = `/2.0/repositories/${workspace}/%7B${repoId}%7D/pullrequests/${prId}`;

        console.log(
          `Trying PR endpoints:\n- ${baseEndpoint}\n- ${encodedEndpoint}`,
        );

        // First test the connection with a simpler endpoint to verify auth
        console.log("Verifying auth before fetching PR...");
        try {
          const testResponse = await this.client.get("/2.0/user");
          console.log(
            "✓ Auth verification with main client successful, username:",
            testResponse.data.username || testResponse.data.display_name,
          );
        } catch (authError) {
          console.error(
            "✗ Auth verification with main client failed:",
            authError.message,
          );
        }

        try {
          // Try both endpoints in sequence
          let endpoint;
          let successful = false;
          const endpoints = [baseEndpoint, encodedEndpoint];

          for (endpoint of endpoints) {
            console.log(`Trying endpoint: ${endpoint}`);
            try {
              prResponse = await repoClient.get(endpoint);
              console.log(`✓ Successfully fetched PR details from ${endpoint}`);
              successful = true;
              baseEndpoint = endpoint.replace(/\/pullrequests\/\d+$/, "");
              break;
            } catch (endpointError) {
              console.log(
                `✗ Failed with endpoint ${endpoint}: ${endpointError.message}`,
              );
              if (endpointError.response) {
                console.log(`Status: ${endpointError.response.status}`);
                if (endpointError.response.data) {
                  console.log(
                    `Response data: ${JSON.stringify(endpointError.response.data)}`,
                  );
                }
              }
            }
          }

          if (!successful) {
            // If neither endpoint worked, try with the user's token on the workspace endpoint
            // This helps verify if the user has access to at least list repositories
            console.log(
              "Checking if user has access to workspace repositories...",
            );
            try {
              const workspaceEndpoint = `/2.0/repositories/${workspace}`;
              const workspaceResponse =
                await this.client.get(workspaceEndpoint);
              console.log("✓ User has access to workspace repositories");
              console.log(
                "Repositories in workspace:",
                workspaceResponse.data.values.length,
              );

              // List repositories to help user identify the correct one
              console.log("Available repositories:");
              workspaceResponse.data.values.forEach((repo) => {
                console.log(`- ${repo.name} (${repo.uuid})`);
              });

              throw new Error(
                `Repository not found or no access to repository with ID: ${repoId}`,
              );
            } catch (wsError) {
              console.log(
                "✗ User does not have access to workspace repositories",
              );
              throw new Error(
                `No access to workspace ${workspace} or PR ${prId}. Check permissions and repository ID.`,
              );
            }
          }

          // Fetch PR diff for file changes
          console.log(`Fetching PR diff from ${baseEndpoint}/diff`);
          changesResponse = await repoClient.get(`${baseEndpoint}/diff`);
          console.log("✓ Successfully fetched PR diff");

          // Fetch PR comments
          console.log(`Fetching PR comments from ${baseEndpoint}/comments`);
          commentsResponse = await repoClient.get(`${baseEndpoint}/comments`);
          console.log("✓ Successfully fetched PR comments");

          // Enhanced data fetching - wrapped in try/catch to continue even if some fail

          // 1. Fetch PR commits
          try {
            console.log(`Fetching commits from: ${baseEndpoint}/commits`);
            commitsResponse = await this.client.get(`${baseEndpoint}/commits`);
          } catch (error) {
            console.log(`Error fetching commits: ${error.message}`);
            commitsResponse = { data: { values: [] } };
          }

          // 2. Fetch PR diffstat for file change statistics
          try {
            console.log(`Fetching diffstat from: ${baseEndpoint}/diffstat`);
            diffstatResponse = await this.client.get(
              `${baseEndpoint}/diffstat`,
            );
          } catch (error) {
            console.log(`Error fetching diffstat: ${error.message}`);
            diffstatResponse = { data: { values: [] } };
          }

          // 3. Fetch PR activities/timeline
          try {
            console.log(`Fetching activities from: ${baseEndpoint}/activity`);
            activitiesResponse = await this.client.get(
              `${baseEndpoint}/activity`,
            );
          } catch (error) {
            console.log(`Error fetching activities: ${error.message}`);
            activitiesResponse = { data: { values: [] } };
          }

          // 4. Fetch PR statuses (CI results)
          try {
            console.log(`Fetching statuses from: ${baseEndpoint}/statuses`);
            statusesResponse = await this.client.get(
              `${baseEndpoint}/statuses`,
            );
          } catch (error) {
            console.log(`Error fetching statuses: ${error.message}`);
            statusesResponse = { data: { values: [] } };
          }

          // 5. Fetch PR tasks
          try {
            console.log(`Fetching tasks from: ${baseEndpoint}/tasks`);
            tasksResponse = await this.client.get(`${baseEndpoint}/tasks`);
          } catch (error) {
            console.log(`Error fetching tasks: ${error.message}`);
            tasksResponse = { data: { values: [] } };
          }
        } catch (error) {
          console.error(`Error in core PR data fetching: ${error.message}`);
          throw error; // Re-throw core API errors
        }
      } else {
        // Bitbucket Server API endpoints
        if (!prInfo.projectKey || !prInfo.repoSlug) {
          throw new Error(
            "Missing project key or repository slug for Bitbucket Server URL",
          );
        }

        const prEndpoint = `/rest/api/1.0/projects/${prInfo.projectKey}/repos/${prInfo.repoSlug}/pull-requests/${prInfo.prId}`;
        prResponse = await this.client.get(prEndpoint);

        // Fetch PR changes
        const changesEndpoint = `${prEndpoint}/changes`;
        changesResponse = await this.client.get(changesEndpoint);

        // Fetch PR comments
        const commentsEndpoint = `${prEndpoint}/activities`;
        commentsResponse = await this.client.get(commentsEndpoint);

        // Fetch PR commits for Server too
        try {
          commitsResponse = await this.client.get(`${prEndpoint}/commits`);
        } catch (error) {
          console.log(`Error fetching commits from Server: ${error.message}`);
          commitsResponse = { data: { values: [] } };
        }
      }

      // Return all the PR data
      return {
        prDetails: prResponse.data,
        changes: changesResponse.data,
        comments: commentsResponse.data,
        // Include the enhanced data (will be undefined for Server unless explicitly fetched)
        commits: commitsResponse?.data,
        diffstat: diffstatResponse?.data,
        activities: activitiesResponse?.data,
        statuses: statusesResponse?.data,
        tasks: tasksResponse?.data,
      };
    } catch (error) {
      console.error("Error fetching PR details:", error.message);
      if (error.response) {
        console.error("API Response Error:", error.response.data);
        console.error("Status:", error.response.status);
        console.error("Headers:", error.response.headers);
      }
      throw new Error(`Failed to fetch PR details: ${error.message}`);
    }
  }

  /**
   * Generate an AI-enhanced summary using Claude
   * @param {Object} prData - The complete PR data
   * @param {string} baseSummary - The base summary generated by rule-based system
   * @param {string} claudeApiKey - Claude API key
   * @returns {Promise<string>} - Claude-enhanced summary
   */
  async generateClaudeSummary(prData, baseSummary, claudeApiKey) {
    // Early return if no API key
    if (!claudeApiKey) {
      return baseSummary;
    }

    try {
      // Create Claude processor
      const claude = new ClaudeProcessor({
        apiKey: claudeApiKey,
        model: "claude-3-haiku-20240307", // Use a smaller, faster model for PR summaries
        maxTokens: 1000,
        temperature: 0.3, // Lower temperature for more focused response
      });

      // Extract PR information for Claude
      const { prDetails, changes } = prData;
      const title = prDetails.title;
      const description = prDetails.description || "";
      const author = prDetails.author.user.displayName;
      const status = prDetails.state;
      const sourceRef = prDetails.fromRef.displayId;
      const targetRef = prDetails.toRef.displayId;

      // Collect changed files information
      const changedFiles = [];
      if (changes && changes.values) {
        changes.values.forEach((change) => {
          const filePath = change.path.toString;
          // Simplify addition and truncate for brevity
          if (changedFiles.length < 20) {
            changedFiles.push(filePath);
          }
        });
      }

      // Build the prompt for Claude
      const systemPrompt = `You are an expert software engineer analyzing a pull request on Bitbucket. 
Your task is to generate an insightful, concise summary of the PR's changes and purpose.

First, I'll give you the basic PR information and a base summary that was already generated.
Your job is to:
1. Enhance this summary with additional technical insights
2. Identify patterns in the changes that might not be obvious
3. Clarify the overall purpose and impact of the changes
4. Note any potential areas that might need special attention (performance, security, etc.)

Keep your response concise and focused on what would be most useful to a developer looking at this PR later.
Format your response as plain text that explains the changes in simple, clear language.

Exclude any preamble like "Here's my analysis" or "I've reviewed the PR". 
Begin directly with your enhanced summary.`;

      // User message with PR details
      const userMessage = `PR Information:
Title: ${title}
Description: ${description}
Status: ${status}
Author: ${author}
Source Branch: ${sourceRef}
Target Branch: ${targetRef}

Changed Files (${changedFiles.length} total):
${changedFiles.length <= 20 ? changedFiles.join("\n") : changedFiles.join("\n") + "\n... and more"}

Base Summary (already generated):
${baseSummary}

Please enhance this summary with deeper technical insights and a clearer explanation of this PR's purpose and impact.`;

      // Call Claude API
      const response = await axios.post(
        claude.config.apiEndpoint,
        {
          model: claude.config.model,
          max_tokens: claude.config.maxTokens,
          temperature: claude.config.temperature,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": claude.config.apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      );

      // Extract and format the enhanced summary
      const enhancedSummary = response.data.content[0].text.trim();

      // Combine the base summary with Claude's enhanced version
      return `${baseSummary}\n\n## AI-Enhanced Analysis\n${enhancedSummary}`;
    } catch (error) {
      console.warn("Error generating Claude summary:", error.message);
      // Return the original summary if Claude processing fails
      return baseSummary;
    }
  }

  /**
   * Generate a meaningful summary of the PR changes
   * @param {string} title - PR title
   * @param {string} description - PR description
   * @param {Array} changedFileNames - Names of changed files
   * @param {Array} changedFilePaths - Paths of changed files
   * @param {Array} fileTypes - Detected file types
   * @param {Array} tags - Generated tags
   * @returns {string} - Generated summary
   */
  generateChangeSummary(
    title,
    description,
    changedFileNames,
    changedFilePaths,
    fileTypes,
    tags,
  ) {
    // Initialize summary components
    const components = [];

    // Extract the most common directories affected
    const directories = new Map();
    changedFilePaths.forEach((filePath) => {
      const dir = path.dirname(filePath);
      if (dir !== ".") {
        const dirParts = dir.split("/");
        // Consider up to 2 levels of directories for categorization
        const mainDir = dirParts
          .slice(0, Math.min(2, dirParts.length))
          .join("/");
        directories.set(mainDir, (directories.get(mainDir) || 0) + 1);
      }
    });

    // Get top directories (up to 3)
    const topDirs = Array.from(directories.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([dir]) => dir);

    // Generate a summary based on the PR title, description, and files changed
    let summary = "";

    // Step 1: Look for indicators in the title
    const titleLower = title.toLowerCase();
    if (titleLower.includes("fix") || titleLower.includes("bug")) {
      summary += "This PR fixes ";
    } else if (titleLower.includes("add") || titleLower.includes("feature")) {
      summary += "This PR implements ";
    } else if (
      titleLower.includes("update") ||
      titleLower.includes("improve")
    ) {
      summary += "This PR updates ";
    } else if (titleLower.includes("refactor")) {
      summary += "This PR refactors ";
    } else {
      summary += "This PR changes ";
    }

    // Add what was changed based on title or common pattern
    if (
      titleLower.startsWith("fix:") ||
      titleLower.startsWith("feat:") ||
      titleLower.startsWith("chore:") ||
      titleLower.startsWith("docs:") ||
      titleLower.startsWith("refactor:") ||
      titleLower.startsWith("test:")
    ) {
      // Use the title content after the prefix
      const colonIndex = title.indexOf(":");
      if (colonIndex !== -1 && colonIndex < title.length - 1) {
        summary += title
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
      } else {
        summary += title.toLowerCase();
      }
    } else {
      summary += title.toLowerCase();
    }

    // Step 2: Add details about affected areas
    if (topDirs.length > 0) {
      summary += `. Primarily affects ${topDirs.join(", ")} directories`;
    }

    // Step 3: Mention relevant technologies
    if (fileTypes.length > 0) {
      const significantTypes = fileTypes
        .filter((type) => !["documentation", "config"].includes(type))
        .slice(0, 3);

      if (significantTypes.length > 0) {
        summary += `. Involves ${significantTypes.join(", ")} code`;
      }
    }

    // Step 4: Extract key points from description if available
    if (description && description.length > 0) {
      // Look for explicit sections in the description
      const sections = {
        changes: null,
        why: null,
        summary: null,
        notes: null,
        motivation: null,
        details: null,
      };

      // Try to extract structured sections
      Object.keys(sections).forEach((sectionName) => {
        const pattern = new RegExp(
          `\\b${sectionName}\\b[:\\s]+(.*?)(?=\\n\\s*\\n|\\n\\s*#|$)`,
          "si",
        );
        const match = description.match(pattern);
        if (match) {
          sections[sectionName] = match[1].trim();
        }
      });

      // Use the first found section (in order of preference)
      const foundSection = [
        "summary",
        "changes",
        "why",
        "motivation",
        "details",
        "notes",
      ].find((section) => sections[section]);

      if (foundSection) {
        // Extract a concise sentence or two from the section
        const sectionText = sections[foundSection];
        const sentences = sectionText
          .split(/[.!?]/)
          .filter((s) => s.trim().length > 0);

        if (sentences.length > 0) {
          // Take up to 2 sentences from the section
          const excerpt = sentences.slice(0, 2).join(". ").trim() + ".";
          summary += `\n\nFrom description: "${excerpt}"`;
        }
      } else {
        // No structured sections found, take the first paragraph or sentence
        const firstParagraph = description.split(/\n\s*\n/)[0];
        if (firstParagraph && firstParagraph.length > 0) {
          const sentences = firstParagraph
            .split(/[.!?]/)
            .filter((s) => s.trim().length > 0);
          if (sentences.length > 0) {
            const excerpt = sentences[0].trim() + ".";
            summary += `\n\nFrom description: "${excerpt}"`;
          }
        }
      }
    }

    // Step 5: Include significant files if there are few of them
    if (changedFileNames.length <= 5) {
      summary += `\n\nChanged files: ${changedFileNames.join(", ")}`;
    } else {
      // For many files, include a sampling and count
      const sampleFiles = changedFileNames.slice(0, 3);
      summary += `\n\nChanged ${changedFileNames.length} files including: ${sampleFiles.join(", ")}, ...`;
    }

    return summary;
  }

  /**
   * Process PR data and generate tags
   * @param {Object} prData - PR data
   * @returns {Object} - Processed PR data with tags
   */
  processPRData(prData) {
    const {
      prDetails,
      changes,
      comments,
      commits,
      diffstat,
      activities,
      statuses,
      tasks,
    } = prData;

    console.log(
      `Processing PR data: ${JSON.stringify(prDetails, null, 2).substring(0, 200)}...`,
    );

    // Extract basic PR info, handling different structures between Server and Cloud
    const title = prDetails.title;
    const description = prDetails.description || "";

    // Handle different author and user structures between Server and Cloud
    let author;
    if (prDetails.author && prDetails.author.user) {
      // Bitbucket Server format
      author = prDetails.author.user.displayName;
    } else if (prDetails.author && prDetails.author.display_name) {
      // Bitbucket Cloud format
      author = prDetails.author.display_name;
    } else {
      author = "Unknown Author";
    }

    // Handle different state/status keys
    const status = prDetails.state || prDetails.status;

    // Handle different date formats
    let createdDate, updatedDate;
    if (prDetails.createdDate) {
      // Bitbucket Server (numeric timestamp)
      createdDate = new Date(prDetails.createdDate);
      updatedDate = new Date(prDetails.updatedDate);
    } else if (prDetails.created_on) {
      // Bitbucket Cloud (ISO string)
      createdDate = new Date(prDetails.created_on);
      updatedDate = new Date(prDetails.updated_on);
    } else {
      createdDate = new Date();
      updatedDate = new Date();
    }

    // Handle different branch ref structures
    let sourceRef, targetRef;
    if (prDetails.fromRef && prDetails.fromRef.displayId) {
      // Bitbucket Server
      sourceRef = prDetails.fromRef.displayId;
      targetRef = prDetails.toRef.displayId;
    } else if (prDetails.source && prDetails.source.branch) {
      // Bitbucket Cloud
      sourceRef = prDetails.source.branch.name;
      targetRef = prDetails.destination.branch.name;
    } else {
      sourceRef = "unknown";
      targetRef = "unknown";
    }

    // Handle different URL structures
    let url;
    if (prDetails.links && prDetails.links.self) {
      // Bitbucket Server
      url = prDetails.links.self[0].href;
    } else if (prDetails.links && prDetails.links.html) {
      // Bitbucket Cloud
      url = prDetails.links.html.href;
    } else {
      url = "Unknown URL";
    }

    // Generate automatic tags
    const tags = new Set();

    // Add status tag
    tags.add(status);

    // Add branch tags
    tags.add(`source:${sourceRef}`);
    tags.add(`target:${targetRef}`);

    // Check file types and generate language/tech tags
    const fileExtensions = new Set();
    const fileTypes = new Set();
    const changedFileNames = [];
    const changedFilePaths = [];

    // Handle different file structure between Server and Cloud APIs
    if (changes && changes.values) {
      console.log(`Processing ${changes.values.length} changed files`);

      changes.values.forEach((change) => {
        let filePath;

        // Handle different file path structures
        if (change.path && change.path.toString) {
          // Bitbucket Server format
          filePath = change.path.toString;
        } else if (change.path) {
          // Bitbucket Cloud might directly provide path as string
          filePath = change.path;
        } else if (change.new && change.new.path) {
          // Bitbucket Cloud diff format
          filePath = change.new.path;
        } else {
          console.log(
            `Unable to determine file path for change: ${JSON.stringify(change).substring(0, 100)}...`,
          );
          return; // Skip this change
        }

        changedFilePaths.push(filePath);
        const fileName = path.basename(filePath);
        changedFileNames.push(fileName);
        const fileExt = path.extname(filePath).toLowerCase().replace(".", "");

        if (fileExt) {
          fileExtensions.add(fileExt);

          // Map extensions to broader categories
          if (["js", "jsx", "ts", "tsx"].includes(fileExt)) {
            fileTypes.add("javascript");
            if (["ts", "tsx"].includes(fileExt)) {
              fileTypes.add("typescript");
            }
            if (["jsx", "tsx"].includes(fileExt)) {
              fileTypes.add("react");
            }
          } else if (["py"].includes(fileExt)) {
            fileTypes.add("python");
          } else if (["java"].includes(fileExt)) {
            fileTypes.add("java");
          } else if (["rb"].includes(fileExt)) {
            fileTypes.add("ruby");
          } else if (["go"].includes(fileExt)) {
            fileTypes.add("golang");
          } else if (["php"].includes(fileExt)) {
            fileTypes.add("php");
          } else if (["html", "htm"].includes(fileExt)) {
            fileTypes.add("html");
          } else if (["css", "scss", "sass", "less"].includes(fileExt)) {
            fileTypes.add("css");
            if (["scss", "sass"].includes(fileExt)) {
              fileTypes.add("sass");
            }
            if (["less"].includes(fileExt)) {
              fileTypes.add("less");
            }
          } else if (["md", "markdown"].includes(fileExt)) {
            fileTypes.add("documentation");
          } else if (["json", "yaml", "yml", "toml"].includes(fileExt)) {
            fileTypes.add("config");
          } else if (["sql"].includes(fileExt)) {
            fileTypes.add("database");
          }
        }

        // Detect specific file patterns
        if (filePath.includes("test") || filePath.includes("spec")) {
          fileTypes.add("tests");
        }
        if (
          filePath.endsWith("package.json") ||
          filePath.endsWith("package-lock.json")
        ) {
          fileTypes.add("npm");
        }
        if (filePath.includes("docker") || filePath.endsWith("Dockerfile")) {
          fileTypes.add("docker");
        }
        if (filePath.includes("k8s") || filePath.includes("kubernetes")) {
          fileTypes.add("kubernetes");
        }
      });
    }

    // Add file type tags
    fileTypes.forEach((type) => tags.add(type));

    // Extract keywords from title and description
    const combinedText = `${title} ${description}`.toLowerCase();
    const commonKeywords = [
      "fix",
      "feature",
      "update",
      "improve",
      "refactor",
      "bug",
      "tests",
      "security",
      "performance",
      "ui",
      "ux",
      "frontend",
      "backend",
      "api",
      "database",
      "authentication",
      "authorization",
      "deployment",
    ];

    commonKeywords.forEach((keyword) => {
      if (combinedText.includes(keyword)) {
        tags.add(keyword);
      }
    });

    // Generate statistics about changes
    const changedFiles = changes && changes.values ? changes.values.length : 0;

    // Handle different comment structures between Server and Cloud
    let commentCount = 0;
    if (comments && comments.values) {
      if (comments.values[0] && comments.values[0].action) {
        // Bitbucket Server format - filter activities by "COMMENTED" action
        commentCount = comments.values.filter(
          (a) => a.action === "COMMENTED",
        ).length;
      } else {
        // Bitbucket Cloud format - directly returns comments
        commentCount = comments.values.length;
      }
    }

    // Generate a summary of the changes
    const changeSummary = this.generateChangeSummary(
      title,
      description,
      changedFileNames,
      changedFilePaths,
      Array.from(fileTypes),
      Array.from(tags),
    );

    // Extract information from commits (if available)
    const commitInfo = {
      count: 0,
      authors: new Set(),
      messages: [],
      summary: "",
    };

    if (commits && commits.values && commits.values.length > 0) {
      commitInfo.count = commits.values.length;

      // Extract commit authors and messages
      commits.values.forEach((commit) => {
        // Handle different author structures
        const authorName =
          commit.author?.user?.displayName ||
          commit.author?.user?.display_name ||
          commit.author?.display_name ||
          commit.author?.raw ||
          "Unknown";

        commitInfo.authors.add(authorName);

        // Get commit message and clean it up
        let message = commit.message || commit.summary || "";
        // Truncate long messages
        if (message.length > 100) {
          message = message.substring(0, 97) + "...";
        }

        commitInfo.messages.push(message);
      });

      // Generate a summary of commits
      if (commitInfo.messages.length > 0) {
        // Take at most 5 commit messages for the summary
        const sampleMessages = commitInfo.messages.slice(0, 5);
        commitInfo.summary =
          `The PR contains ${commitInfo.count} commits` +
          (commitInfo.authors.size > 1
            ? ` from ${commitInfo.authors.size} authors`
            : "") +
          `. Sample commits: ${sampleMessages.map((m) => `"${m}"`).join(", ")}` +
          (commitInfo.messages.length > 5 ? " and more..." : "");
      }
    }

    // Extract CI status information (if available)
    const ciStatus = {
      passed: 0,
      failed: 0,
      inProgress: 0,
      summary: "",
    };

    if (statuses && statuses.values && statuses.values.length > 0) {
      statuses.values.forEach((status) => {
        // Handle different status structures between Server and Cloud
        const state = status.state || status.status;
        if (
          state === "SUCCESSFUL" ||
          state === "successful" ||
          state === "passed"
        ) {
          ciStatus.passed++;
        } else if (
          state === "FAILED" ||
          state === "failed" ||
          state === "error"
        ) {
          ciStatus.failed++;
        } else {
          ciStatus.inProgress++;
        }
      });

      // Generate CI status summary
      if (
        ciStatus.passed > 0 ||
        ciStatus.failed > 0 ||
        ciStatus.inProgress > 0
      ) {
        ciStatus.summary = `CI checks: ${ciStatus.passed} passed, ${ciStatus.failed} failed, ${ciStatus.inProgress} in progress`;
      }
    }

    // Extract task information (if available)
    const taskInfo = {
      count: 0,
      resolved: 0,
      open: 0,
      summary: "",
    };

    if (tasks && tasks.values && tasks.values.length > 0) {
      taskInfo.count = tasks.values.length;

      tasks.values.forEach((task) => {
        if (task.resolved || task.state === "resolved") {
          taskInfo.resolved++;
        } else {
          taskInfo.open++;
        }
      });

      // Generate task summary
      if (taskInfo.count > 0) {
        taskInfo.summary = `PR has ${taskInfo.count} tasks: ${taskInfo.resolved} completed, ${taskInfo.open} open`;
      }
    }

    // Get improved diffstat if available
    let diffstatSummary = "";
    if (diffstat && diffstat.values && diffstat.values.length > 0) {
      const additions = diffstat.values.reduce(
        (sum, file) => sum + (file.lines_added || 0),
        0,
      );
      const deletions = diffstat.values.reduce(
        (sum, file) => sum + (file.lines_removed || 0),
        0,
      );

      diffstatSummary = `Changes: +${additions} -${deletions} lines across ${diffstat.values.length} files`;
    }

    // Format the data with enhanced information
    return {
      title,
      description,
      author,
      status,
      createdDate,
      updatedDate,
      sourceRef,
      targetRef,
      url,
      changedFiles,
      commentCount,
      changeSummary,
      changedFileNames,
      changedFilePaths,
      tags: Array.from(tags),
      fileExtensions: Array.from(fileExtensions),
      fileTypes: Array.from(fileTypes),
      // Add enhanced data
      commits: commitInfo,
      ciStatus: ciStatus,
      tasks: taskInfo,
      diffstatSummary,
    };
  }

  /**
   * Create a repository-specific client for Bitbucket Cloud
   * @param {string} workspace - The workspace name
   * @param {string} repoId - The repository ID
   * @param {string} repoToken - Optional repository access token
   * @returns {Object} - Repository-specific Axios client
   */
  createRepoClient(workspace, repoId, repoToken = null) {
    // Base URL for Bitbucket Cloud API
    const apiBaseURL = "https://api.bitbucket.org";

    const clientConfig = {
      baseURL: apiBaseURL,
      headers: {
        "Content-Type": "application/json",
      },
    };

    // If a repo token is provided, use it
    if (repoToken) {
      console.log("Using repository-specific access token");
      clientConfig.headers["Authorization"] = `Bearer ${repoToken}`;
    } else {
      // Otherwise use the global credentials
      console.log("Using global credentials for repository access");
      if (this.client.defaults.auth) {
        clientConfig.auth = this.client.defaults.auth;
      } else if (
        this.client.defaults.headers &&
        this.client.defaults.headers.Authorization
      ) {
        clientConfig.headers["Authorization"] =
          this.client.defaults.headers.Authorization;
      }
    }

    return axios.create(clientConfig);
  }

  /**
   * Fetch PR details from web UI (fallback when API access is restricted)
   * @param {string} url - PR URL
   * @returns {Promise<Object>} - PR details from web page
   */
  async fetchPRFromWebUI(url) {
    console.log(
      "Falling back to web UI scraping since API access is restricted",
    );

    try {
      // Fetch the HTML page
      console.log(`Fetching PR web page from: ${url}`);
      const response = await axios.get(url, {
        headers: {
          Accept: "text/html",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      });

      const html = response.data;
      console.log("Successfully fetched PR web page");

      // Extract title from HTML
      const titleMatch = html.match(/<title>(.*?)<\/title>/);
      const title = titleMatch
        ? titleMatch[1].replace(" — Bitbucket", "").trim()
        : "Untitled PR";

      // Extract PR info - this is based on typical Bitbucket HTML structure
      const prIdMatch = url.match(/\/pull-requests\/(\d+)/);
      const prId = prIdMatch ? prIdMatch[1] : "Unknown";

      const descriptionMatch = html.match(
        /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      );
      const description = descriptionMatch
        ? this.cleanHtml(descriptionMatch[1])
        : "";

      // Determine author based on URL or page content
      const authorMatch = html.match(/data-username="([^"]+)"/i);
      const author = authorMatch ? authorMatch[1] : "Unknown Author";

      // Extract status - open, merged, etc.
      const statusMatch = html.match(/pull-request-state[^>]*>([^<]+)</i);
      const status = statusMatch ? statusMatch[1].trim() : "Unknown";

      // Try to extract branch names
      const sourceBranchMatch = html.match(/source branch[^>]*>([^<]+)</i);
      const sourceRef = sourceBranchMatch
        ? sourceBranchMatch[1].trim()
        : "Unknown";

      const targetBranchMatch = html.match(/target branch[^>]*>([^<]+)</i);
      const targetRef = targetBranchMatch
        ? targetBranchMatch[1].trim()
        : "Unknown";

      // Try to extract file changes
      const filesChangedMatch = html.match(/(\d+) files? changed/i);
      const changedFiles = filesChangedMatch
        ? parseInt(filesChangedMatch[1])
        : 0;

      // Build a simplified response similar to what the API would return
      return {
        prDetails: {
          title,
          description,
          author: { user: { displayName: author } },
          state: status,
          createdDate: new Date().toISOString(),
          updatedDate: new Date().toISOString(),
          fromRef: { displayId: sourceRef },
          toRef: { displayId: targetRef },
          links: { self: [{ href: url }] },
        },
        changes: {
          values: [],
        },
        comments: {
          values: [],
        },
      };
    } catch (error) {
      console.error("Error fetching PR from web UI:", error.message);
      throw new Error(`Failed to fetch PR from web UI: ${error.message}`);
    }
  }

  /**
   * Clean HTML content
   * @param {string} html - HTML content to clean
   * @returns {string} - Cleaned text
   */
  cleanHtml(html) {
    return html
      .replace(/<[^>]*>/g, "") // Remove HTML tags
      .replace(/&nbsp;/g, " ") // Replace non-breaking spaces
      .replace(/&amp;/g, "&") // Replace HTML entities
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  /**
   * Save PR details as a thought
   * @param {string} url - PR URL
   * @param {string} thoughtsDir - Directory to save thoughts
   * @param {Object} options - Additional options (tags, notes, claudeApiKey, repoToken)
   * @returns {Promise<Object>} - Saved thought details
   */
  async savePRAsThought(url, thoughtsDir, options = {}) {
    try {
      let prData;

      // Try API first
      try {
        // Check if repoToken is provided in options
        if (options.repoToken) {
          console.log("Using provided repository access token");
        } else {
          console.log(
            "No repository access token provided, using global credentials",
          );
        }

        // Fetch PR details with repository token if provided
        prData = await this.fetchPRDetails(url, options);
      } catch (apiError) {
        console.log(`API access failed: ${apiError.message}`);
        console.log("Trying fallback to web UI...");

        // If API fails, try web UI fallback
        prData = await this.fetchPRFromWebUI(url);
      }

      // Process PR data
      const processedData = this.processPRData(prData);

      // Get custom tags from options
      const customTags = options.tags
        ? options.tags.split(",").map((t) => t.trim())
        : [];
      const allTags = [...processedData.tags, ...customTags];

      // Format the thought content
      const timestamp = new Date().toISOString();
      const formattedDate = format(processedData.createdDate, "yyyy-MM-dd");

      // Create a safe filename
      const safeTitle = slugify(processedData.title, {
        lower: true,
        strict: true,
      });
      const filename = `${timestamp.replace(/[:.]/g, "-")}-pr-${safeTitle}.md`;
      const filepath = path.join(thoughtsDir, filename);

      // Generate AI-enhanced summary if Claude API key is provided
      let enhancedSummary = processedData.changeSummary;
      if (options.claudeApiKey) {
        console.log(
          chalk.blue("Generating AI-enhanced summary with Claude..."),
        );
        enhancedSummary = await this.generateClaudeSummary(
          prData,
          processedData.changeSummary,
          options.claudeApiKey,
        );
        processedData.aiEnhancedSummary = true;
      }

      // Generate thought content with enhanced PR information
      let thoughtContent = `# ${processedData.title} (PR)

## Change Summary
${processedData.aiEnhancedSummary ? enhancedSummary : processedData.changeSummary || "*No summary generated*"}
${processedData.aiEnhancedSummary ? "\n*Summary enhanced with Claude AI*" : ""}

## PR Information
- **URL**: [${url}](${url})
- **Status**: ${processedData.status}
- **Author**: ${processedData.author}
- **Created**: ${format(processedData.createdDate, "yyyy-MM-dd HH:mm:ss")}
- **Last Updated**: ${format(processedData.updatedDate, "yyyy-MM-dd HH:mm:ss")}
- **Source Branch**: ${processedData.sourceRef}
- **Target Branch**: ${processedData.targetRef}
- **Files Changed**: ${processedData.changedFiles}
- **Comments**: ${processedData.commentCount}`;

      // Add diffstat summary if available
      if (processedData.diffstatSummary) {
        thoughtContent += `\n- **Changes**: ${processedData.diffstatSummary}`;
      }

      // Add commit information if available
      if (processedData.commits && processedData.commits.summary) {
        thoughtContent += `\n\n## Commits\n${processedData.commits.summary}`;
      }

      // Add CI status information if available
      if (processedData.ciStatus && processedData.ciStatus.summary) {
        thoughtContent += `\n\n## CI Status\n${processedData.ciStatus.summary}`;
      }

      // Add task information if available
      if (processedData.tasks && processedData.tasks.summary) {
        thoughtContent += `\n\n## Tasks\n${processedData.tasks.summary}`;
      }

      // Continue with the rest of the PR information
      thoughtContent += `\n\n## Description
${processedData.description || "*No description provided*"}

## Changed Files
${
  processedData.changedFilePaths.length <= 15
    ? processedData.changedFilePaths.map((file) => `- ${file}`).join("\\n")
    : processedData.changedFilePaths
        .slice(0, 15)
        .map((file) => `- ${file}`)
        .join("\\n") +
      `\\n- ... and ${processedData.changedFilePaths.length - 15} more files`
}

## Tags
${allTags.map((tag) => `- ${tag}`).join("\\n")}

## File Types
${processedData.fileTypes.map((type) => `- ${type}`).join("\\n")}

${options.notes ? `## Notes\n${options.notes}` : ""}

---
*PR saved on ${format(new Date(), "yyyy-MM-dd HH:mm:ss")}*
`;

      // Save the thought
      await fs.writeFile(filepath, thoughtContent);

      // Index the PR in the PR database
      await this.indexPR(thoughtsDir, {
        id: uuidv4(),
        url,
        title: processedData.title,
        author: processedData.author,
        status: processedData.status,
        createdDate: processedData.createdDate,
        savedDate: new Date(),
        tags: allTags,
        fileTypes: processedData.fileTypes,
        summary: processedData.aiEnhancedSummary
          ? enhancedSummary
          : processedData.changeSummary,
        aiEnhancedSummary: processedData.aiEnhancedSummary || false,
        changedFiles: processedData.changedFiles,
        commentCount: processedData.commentCount,
        changedFileNames: processedData.changedFileNames.slice(0, 10), // Store a sample of files
        thoughtFile: filename,
      });

      return {
        success: true,
        filepath,
        filename,
        title: processedData.title,
        tags: allTags,
      };
    } catch (error) {
      console.error("Error saving PR as thought:", error);
      throw error;
    }
  }

  /**
   * Save PR info to the PR index database
   * @param {string} thoughtsDir - Directory to save thoughts
   * @param {Object} prInfo - PR information to save
   * @returns {Promise<void>}
   */
  async indexPR(thoughtsDir, prInfo) {
    const prDbPath = path.join(thoughtsDir, ".pr_index.json");

    try {
      // Check if PR database exists, create it if it doesn't
      let prDatabase = [];
      try {
        const dbContent = await fs.readFile(prDbPath, "utf8");
        prDatabase = JSON.parse(dbContent);
      } catch (error) {
        // Database doesn't exist yet, will create it
      }

      // Add PR to database
      prDatabase.push(prInfo);

      // Save updated database
      await fs.writeFile(prDbPath, JSON.stringify(prDatabase, null, 2));
    } catch (error) {
      console.error("Error indexing PR:", error);
      throw error;
    }
  }

  /**
   * Search for PRs in the index
   * @param {string} thoughtsDir - Directory where thoughts are stored
   * @param {Object} query - Search query
   * @returns {Promise<Array>} - Matching PRs
   */
  async searchPRs(thoughtsDir, query = {}) {
    const prDbPath = path.join(thoughtsDir, ".pr_index.json");

    try {
      // Read PR database
      let prDatabase = [];
      try {
        const dbContent = await fs.readFile(prDbPath, "utf8");
        prDatabase = JSON.parse(dbContent);
      } catch (error) {
        // Database doesn't exist or can't be read
        return [];
      }

      // Filter PRs based on query
      let results = [...prDatabase];

      if (query.text) {
        const searchText = query.text.toLowerCase();
        results = results.filter(
          (pr) =>
            pr.title.toLowerCase().includes(searchText) ||
            (pr.summary && pr.summary.toLowerCase().includes(searchText)) ||
            pr.tags.some((tag) => tag.toLowerCase().includes(searchText)) ||
            pr.fileTypes.some((type) =>
              type.toLowerCase().includes(searchText),
            ) ||
            (pr.changedFileNames &&
              pr.changedFileNames.some((file) =>
                file.toLowerCase().includes(searchText),
              )),
        );
      }

      if (query.tag) {
        results = results.filter((pr) =>
          pr.tags.some((tag) => tag.toLowerCase() === query.tag.toLowerCase()),
        );
      }

      if (query.author) {
        results = results.filter((pr) =>
          pr.author.toLowerCase().includes(query.author.toLowerCase()),
        );
      }

      if (query.status) {
        results = results.filter(
          (pr) => pr.status.toLowerCase() === query.status.toLowerCase(),
        );
      }

      if (query.fileType) {
        results = results.filter((pr) =>
          pr.fileTypes.some(
            (type) => type.toLowerCase() === query.fileType.toLowerCase(),
          ),
        );
      }

      // Add a relevance score for better sorting when searching
      if (query.text) {
        const searchText = query.text.toLowerCase();
        results.forEach((pr) => {
          let relevance = 0;

          // Higher score for exact title matches
          if (pr.title.toLowerCase().includes(searchText)) {
            relevance += 10;
            // Even higher for title starts with
            if (pr.title.toLowerCase().startsWith(searchText)) {
              relevance += 5;
            }
          }

          // Good score for summary matches
          if (pr.summary && pr.summary.toLowerCase().includes(searchText)) {
            relevance += 8;
          }

          // Score for tag matches
          if (pr.tags.some((tag) => tag.toLowerCase().includes(searchText))) {
            relevance += 7;
          }

          // Score for file type matches
          if (
            pr.fileTypes.some((type) => type.toLowerCase().includes(searchText))
          ) {
            relevance += 6;
          }

          // Score for filename matches
          if (
            pr.changedFileNames &&
            pr.changedFileNames.some((file) =>
              file.toLowerCase().includes(searchText),
            )
          ) {
            relevance += 5;
          }

          pr.relevance = relevance;
        });

        // Sort by relevance first, then by date
        results.sort((a, b) => {
          if (a.relevance !== b.relevance) {
            return b.relevance - a.relevance; // Higher relevance first
          }
          return new Date(b.savedDate) - new Date(a.savedDate); // Then newer first
        });
      } else {
        // If not searching text, sort by date (newest first)
        results.sort((a, b) => new Date(b.savedDate) - new Date(a.savedDate));
      }

      // Apply limit if specified
      if (query.limit && !isNaN(parseInt(query.limit))) {
        results = results.slice(0, parseInt(query.limit));
      }

      return results;
    } catch (error) {
      console.error("Error searching PRs:", error);
      return [];
    }
  }

  /**
   * Get a list of all tags used in indexed PRs
   * @param {string} thoughtsDir - Directory where thoughts are stored
   * @returns {Promise<Array>} - List of unique tags
   */
  async getAllTags(thoughtsDir) {
    const prDbPath = path.join(thoughtsDir, ".pr_index.json");

    try {
      // Read PR database
      let prDatabase = [];
      try {
        const dbContent = await fs.readFile(prDbPath, "utf8");
        prDatabase = JSON.parse(dbContent);
      } catch (error) {
        // Database doesn't exist or can't be read
        return [];
      }

      // Extract and count all tags
      const tagCounts = {};
      prDatabase.forEach((pr) => {
        pr.tags.forEach((tag) => {
          if (tagCounts[tag]) {
            tagCounts[tag]++;
          } else {
            tagCounts[tag] = 1;
          }
        });
      });

      // Convert to array of objects with tag and count
      return Object.entries(tagCounts)
        .map(([tag, count]) => ({
          tag,
          count,
        }))
        .sort((a, b) => b.count - a.count);
    } catch (error) {
      console.error("Error getting tags:", error);
      return [];
    }
  }
}

/**
 * Create a new BitbucketProcessor instance
 * @param {Object} config - Configuration object with baseUrl, username, and appPassword
 * @returns {BitbucketProcessor} - BitbucketProcessor instance
 */
export function createBitbucketProcessor(config) {
  return new BitbucketProcessor(
    config.baseUrl,
    config.username,
    config.appPassword,
  );
}
