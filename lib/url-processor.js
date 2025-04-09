import fs from "fs-extra";
import path from "path";
import axios from "axios";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import slugify from "slugify";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import prettier from "prettier";

// Helper function to word wrap text to a specific width
function wordWrap(text, width = 79) {
  if (!text) return "";
  
  const lines = text.split("\n");
  return lines.map(line => {
    if (line.length <= width) return line;
    
    const words = line.split(" ");
    let result = [];
    let currentLine = "";
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 <= width) {
        currentLine += (currentLine ? " " : "") + word;
      } else {
        result.push(currentLine);
        currentLine = word;
      }
    }
    
    if (currentLine) {
      result.push(currentLine);
    }
    
    return result.join("\n");
  }).join("\n");
}

/**
 * Represents metadata for web content saved as a thought
 */
class WebContentMetadata {
  /**
   * @typedef {Object} AI
   * @property {string|null} model - The name of the model
   * @property {string|null} promptType - The type of the prompt
   * @property {number} processingTimeMs - The time it took to process the prompt
   */

  /**
   * @typedef {Object} ContentStats
   * @property {number} originalSizeBytes - Size of the original HTML in bytes
   * @property {number} processedSizeBytes - Size of the processed content in bytes
   * @property {number} wordCount - Number of words in the content
   * @property {number} estimatedReadingTimeMinutes - Estimated reading time
   */

  /**
   * @typedef {Object} ContentPaths
   * @property {string|null} originalPath - Path to the original HTML file
   * @property {string|null} processedPath - Path to the processed Markdown file
   * @property {string|null} summaryPath - Path to the summary file
   * @property {string|null} audioPath - Path to the audio file
   */

  /**
   * @typedef {Object} ReadStatus
   * @property {boolean} isRead - Whether the content has been read
   * @property {string|null} lastAccessedDate - ISO timestamp of the last access
   * @property {number} completionPercentage - Percentage read (0-100)
   */

  /**
   * @typedef {Object} DetectedEntities
   * @property {string[]} technologies - List of detected technologies
   * @property {string[]} people - List of detected people
   * @property {string[]} companies - List of detected companies
   */

  /**
   * @typedef {Object} CodeSnippet
   * @property {string} language - Programming language of the snippet
   * @property {string} code - The code snippet text
   * @property {number} lineCount - Number of lines in the snippet
   */

  /**
   * Create a new WebContentMetadata instance
   * @param {string} contentId - Unique identifier for the content
   * @param {string} url - Original URL of the content
   * @param {string} title - Title of the content
   * @param {string} thoughtFile - Filename of the associated thought
   */
  constructor(contentId, url, title, thoughtFile) {
    /** @type {string} */
    this.id = contentId;

    /** @type {string} */
    this.url = url;

    /** @type {string} */
    this.title = title;

    /** @type {string} */
    this.thoughtFile = thoughtFile;

    /** @type {'complete'|'pending'|'error'} */
    this.status = "complete";

    /** @type {ContentStats} */
    this.contentStats = {
      originalSizeBytes: 0,
      processedSizeBytes: 0,
      wordCount: 0,
      estimatedReadingTimeMinutes: 0,
    };

    /** @type {ContentPaths} */
    this.content = {
      originalPath: null,
      processedPath: null,
      summaryPath: null,
      audioPath: null,
    };

    /** @type {string[]} */
    this.tags = [];

    /** @type {ReadStatus} */
    this.readStatus = {
      isRead: false,
      lastAccessedDate: null,
      completionPercentage: 0,
    };

    /** @type {AI} */
    this.ai = {
      model: "",
      promptType: "",
      processingTimeMs: 0,
    };

    /** @type {DetectedEntities} */
    this.detectedEntities = {
      technologies: [],
      people: [],
      companies: [],
    };

    /** @type {CodeSnippet[]} */
    this.codeSnippets = [];

    /** @type {string} */
    this.timestamp = "0";
  }

  /**
   * Update content statistics
   * @param {number} originalSize - Size of the original HTML in bytes
   * @param {number} processedSize - Size of the processed content in bytes
   * @param {number} wordCount - Total number of words in the content
   * @returns {WebContentMetadata} - This instance for chaining
   */
  updateContentStats(originalSize, processedSize, wordCount) {
    this.contentStats.originalSizeBytes = originalSize;
    this.contentStats.processedSizeBytes = processedSize;
    this.contentStats.wordCount = wordCount;
    this.contentStats.estimatedReadingTimeMinutes = Math.ceil(wordCount / 200);
    return this;
  }

  /**
   * Set paths to the content files
   * @param {string} original - Path to the original HTML file
   * @param {string} processed - Path to the processed Markdown file
   * @param {string|null} [summary=null] - Path to the summary file
   * @param {string|null} [audio=null] - Path to the audio file
   * @returns {WebContentMetadata} - This instance for chaining
   */
  setContentPaths(original, processed, summary = null, audio = null) {
    this.content = this.content || {
      originalPath: null,
      processedPath: null,
      summaryPath: null,
      audioPath: null,
    };
    this.content.originalPath = original;
    this.content.processedPath = processed;
    this.content.summaryPath = summary;
    this.content.audioPath = audio;
    return this;
  }

  /**
   * Add a tag to the metadata
   * @param {string} tag - Tag to add
   * @returns {WebContentMetadata} - This instance for chaining
   */
  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
    return this;
  }

  /**
   * Mark content as read
   * @returns {WebContentMetadata} - This instance for chaining
   */
  markAsRead() {
    this.readStatus.isRead = true;
    this.readStatus.lastAccessedDate = new Date().toISOString();
    this.readStatus.completionPercentage = 100;
    return this;
  }

  /**
   * Create a WebContentMetadata instance from an existing object
   * @param {Object} obj - Object with metadata properties
   * @returns {WebContentMetadata} - This instance for chaining
   */
  static fromObject(obj) {
    const metadata = new WebContentMetadata(
      obj.id,
      obj.url,
      obj.title,
      obj.thoughtFile,
    );

    // Copy all the properties from the object
    return Object.assign(metadata, obj);
  }

  /**
   * Create a WebContentMetadata instance from article information
   * @param {string} contentId - Unique identifier
   * @param {string} url - Article URL
   * @param {Object} article - Article object from Readability
   * @param {string} article.title - Article title
   * @param {string} thoughtFile - Associated thought filename
   * @returns {WebContentMetadata} - New WebContentMetadata instance
   */
  static fromArticle(contentId, url, article, thoughtFile) {
    return new WebContentMetadata(contentId, url, article.title, thoughtFile);
  }
}

// Initialize Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});

/**
 * Process a URL by fetching content and extracting relevant information
 * @param {string} url - The URL to process
 * @param {string} thoughtsDir - Directory where thoughts are stored
 * @param {Object} options - Processing options
 * @param {boolean} [options.summarize=false] - Whether to generate an AI summary
 * @param {boolean} [options.audio=false] - Whether to generate audio
 * @param {boolean} [options.force=false] - Whether to force reprocessing if URL exists
 * @returns {Promise<{
 *   metadata: WebContentMetadata,
 *   thoughtContent: string,
 *   thoughtFilename: string,
 *   isExisting: boolean
 * }>} The processed content and metadata
 */
export async function processUrl(url, thoughtsDir, options = {}) {
  try {
    // Create required directories if they don't exist
    const webContentDir = path.join(thoughtsDir, "web-content");
    const originalDir = path.join(webContentDir, "original");
    const processedDir = path.join(webContentDir, "processed");
    const summariesDir = path.join(webContentDir, "summaries");
    const audioDir = path.join(webContentDir, "audio");
    const metadataDir = path.join(thoughtsDir, ".metadata");

    await fs.ensureDir(webContentDir);
    await fs.ensureDir(originalDir);
    await fs.ensureDir(processedDir);
    await fs.ensureDir(summariesDir);
    await fs.ensureDir(audioDir);
    await fs.ensureDir(metadataDir);

    // Check if we already have this URL in our index
    const indexPath = path.join(metadataDir, "web-content-index.json");
    let index = {
      entries: [],
      stats: {
        totalEntries: 0,
        totalReadingTimeMinutes: 0,
        totalWordCount: 0,
        lastUpdated: new Date().toISOString(),
      },
      tagIndex: {},
      urlMap: {}, // Add a map of URL to entry index for quick lookups
    };

    try {
      if (await fs.pathExists(indexPath)) {
        index = JSON.parse(await fs.readFile(indexPath, "utf8"));
        
        // Create URL map if it doesn't exist
        if (!index.urlMap) {
          index.urlMap = {};
          index.entries.forEach((entry, idx) => {
            index.urlMap[entry.url] = idx;
          });
        }
      }
    } catch (err) {
      console.warn("Could not read existing index file, creating new one");
    }

    // Check if URL already exists in our index
    const urlHash = crypto.createHash('md5').update(url).digest('hex');
    const existingEntryIndex = index.urlMap?.[url];
    
    if (existingEntryIndex !== undefined && !options.force) {
      console.log(`URL already processed. Using existing entry.`);
      const existingMetadata = index.entries[existingEntryIndex];
      
      // Get the thought filename from metadata
      const thoughtFilename = existingMetadata.thoughtFile;
      
      // Load the thought content
      const thoughtPath = path.join(thoughtsDir, thoughtFilename);
      let thoughtContent = "";
      if (await fs.pathExists(thoughtPath)) {
        thoughtContent = await fs.readFile(thoughtPath, "utf8");
      } else {
        console.warn("Thought file doesn't exist. Will recreate it.");
        
        // Get the processed markdown
        const processedPath = path.join(thoughtsDir, existingMetadata.content.processedPath);
        const markdown = await fs.readFile(processedPath, "utf8");
        
        // Recreate thought content
        thoughtContent =
          `# ${existingMetadata.title}\n\n` +
          `> Source: [${url}](${url})\n` +
          `> Saved on: ${new Date(existingMetadata.timestamp).toLocaleString()}\n\n` +
          `## Summary\n\n` +
          `*This content was automatically saved from the web. No AI summary is available yet.*\n\n` +
          `## Content\n\n` +
          markdown;
          
        await fs.writeFile(thoughtPath, thoughtContent);
      }
      
      return {
        metadata: existingMetadata,
        thoughtContent,
        thoughtFilename,
        isExisting: true
      };
    }

    // If we get here, we need to process the URL (either it's new or force=true)
    const contentId = uuidv4();

    // Fetch the URL content
    console.log(`Fetching content from ${url}...`);
    const response = await axios.get(url);
    const html = response.data;

    // Format HTML with prettier for better readability when saved
    let formattedHtml = html;
    try {
      formattedHtml = await prettier.format(html, {
        parser: 'html',
        printWidth: 100,
        tabWidth: 2,
        useTabs: false
      });
    } catch (err) {
      console.warn("Could not format HTML, saving original:", err.message);
    }

    // Parse the HTML
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // Extract title
    const title = doc.title || "Untitled Document";

    // Create a readable version of the content using Readability
    const reader = new Readability(doc);
    const article = reader.parse();

    if (!article) {
      throw new Error("Could not parse article content");
    }

    // Generate a slug for filenames
    const slug = slugify(title, {
      lower: true,
      strict: true,
      replacement: "-",
      remove: /[*+~.()'"!:@]/g,
    });

    // Create filenames
    const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
    const baseFilename = `${timestamp}-${slug}`;
    const htmlFilename = `${urlHash.substring(0, 8)}-${slug}.html`;
    const mdFilename = `${urlHash.substring(0, 8)}-${slug}.md`;

    // Save original HTML (formatted for readability)
    const originalPath = path.join(originalDir, htmlFilename);
    await fs.writeFile(originalPath, formattedHtml);

    // Convert article content to Markdown
    const markdown = turndownService.turndown(article.content);
    
    // Word wrap the markdown to 79 characters
    const wrappedMarkdown = wordWrap(markdown);

    // Save processed Markdown with word wrapping
    const processedPath = path.join(processedDir, mdFilename);
    await fs.writeFile(processedPath, wrappedMarkdown);

    // Create thought content with metadata (also word wrapped)
    const thoughtHeader = 
      `# ${article.title}\n\n` +
      `> Source: [${url}](${url})\n` +
      `> Saved on: ${new Date().toLocaleString()}\n\n` +
      `## Summary\n\n` +
      `*This content was automatically saved from the web. No AI summary is available yet.*\n\n` +
      `## Content\n\n`;
    
    const thoughtContent = thoughtHeader + wrappedMarkdown;

    // Extract word count
    const wordCount = wrappedMarkdown.split(/\s+/).length;

    // Create metadata using our class
    const metadata = new WebContentMetadata(
      contentId,
      url,
      article.title,
      `${baseFilename}.md`,
    );

    // Update content stats
    metadata.updateContentStats(formattedHtml.length, wrappedMarkdown.length, wordCount);

    // Set content paths
    metadata.setContentPaths(
      path.relative(thoughtsDir, originalPath),
      path.relative(thoughtsDir, processedPath),
      null,
      null,
    );

    // Add timestamp
    metadata.timestamp = new Date().toISOString();

    // Add or update entry in the index
    if (existingEntryIndex !== undefined) {
      // Update existing entry
      index.entries[existingEntryIndex] = metadata;
    } else {
      // Add new entry
      index.entries.push(metadata);
      index.urlMap = index.urlMap || {};
      index.urlMap[url] = index.entries.length - 1;
    }

    // Update stats
    index.stats.totalEntries = index.entries.length;
    index.stats.totalReadingTimeMinutes = index.entries.reduce(
      (total, entry) =>
        total + (entry.contentStats?.estimatedReadingTimeMinutes || 0),
      0,
    );
    index.stats.totalWordCount = index.entries.reduce(
      (total, entry) => total + (entry.contentStats?.wordCount || 0),
      0,
    );
    index.stats.lastUpdated = new Date().toISOString();

    // Save the updated index
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));

    return {
      metadata,
      thoughtContent,
      thoughtFilename: `${baseFilename}.md`,
      isExisting: false
    };
  } catch (error) {
    console.error("Error processing URL:", error);
    throw error;
  }
}
