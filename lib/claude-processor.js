import fs from "fs-extra";
import path from "path";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { processUrl } from "./url-processor.js";
import { generateSummaryAudio, checkTTSAvailability } from "./audio-generator.js";

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
 * @typedef {Object} ClaudeConfig
 * @property {string} apiKey - Claude API key
 * @property {string} apiEndpoint - Base URL for Claude API
 * @property {string} model - Claude model to use (e.g., "claude-3-opus-20240229")
 * @property {number} maxTokens - Maximum tokens for response
 * @property {number} temperature - Temperature for response generation
 */

/**
 * @typedef {Object} SummaryOptions
 * @property {boolean} [includeKeyPoints=true] - Whether to include key points
 * @property {boolean} [includeEntities=true] - Whether to extract entities
 * @property {boolean} [includeCodeSnippets=true] - Whether to extract code snippets
 * @property {number} [maxLength=500] - Maximum length of summary in words
 */

/**
 * Class for handling Claude AI processing of web content
 */
export class ClaudeProcessor {
  /**
   * Create a new Claude processor
   * @param {ClaudeConfig} config - Claude API configuration
   */
  constructor(config) {
    /** @type {ClaudeConfig} */
    this.config = {
      apiKey: config.apiKey,
      apiEndpoint:
        config.apiEndpoint || "https://api.anthropic.com/v1/messages",
      model: config.model || "claude-3-opus-20240229",
      maxTokens: config.maxTokens || 4000,
      temperature: config.temperature || 0.7,
    };
  }

  /**
   * Process a URL with Claude for enhanced metadata and summaries
   * @param {string} url - URL to process
   * @param {string} thoughtsDir - Directory where thoughts are stored
   * @param {SummaryOptions} options - Options for summary generation
   * @returns {Promise<{
   *   metadata: import('./url-processor.js').WebContentMetadata,
   *   thoughtContent: string,
   *   thoughtFilename: string
   * }>} - The processed content with AI enhancements
   */
  async processUrlWithClaude(url, thoughtsDir, options = {}) {
    // First, process the URL normally
    const { metadata, thoughtContent, thoughtFilename } = await processUrl(
      url,
      thoughtsDir,
    );

    // Default options
    const summaryOptions = {
      includeKeyPoints: options.includeKeyPoints ?? true,
      includeEntities: options.includeEntities ?? true,
      includeCodeSnippets: options.includeCodeSnippets ?? true,
      maxLength: options.maxLength ?? 500,
    };

    try {
      // Get the processed markdown content
      const markdownContent = await fs.readFile(
        path.join(thoughtsDir, metadata.content.processedPath),
        "utf8",
      );

      // Generate a summary using Claude
      const summary = await this.generateSummary(
        markdownContent,
        metadata.title,
        url,
        summaryOptions,
      );

      // Update the thought content with AI summary
      const updatedThoughtContent = this.updateThoughtContent(
        thoughtContent,
        summary,
      );

      // Save summary to file with word wrapping
      const summariesDir = path.join(thoughtsDir, "web-content", "summaries");
      const audioDir = path.join(thoughtsDir, "web-content", "audio");
      await fs.ensureDir(summariesDir);
      await fs.ensureDir(audioDir);

      const summaryFilename = path
        .basename(metadata.content.processedPath)
        .replace(".md", "-summary.md");
      const summaryPath = path.join(summariesDir, summaryFilename);
      
      // Word wrap the summary for better readability
      const wrappedSummary = wordWrap(summary.fullSummary);
      
      await fs.writeFile(summaryPath, wrappedSummary);
      
      // Generate audio if requested and TTS is available
      if (options.audio || options.generateAudio) {
        try {
          const ttsAvailable = await checkTTSAvailability();
          
          if (ttsAvailable) {
            console.log("Generating audio for summary...");
            
            const audioFilename = path
              .basename(metadata.content.processedPath)
              .replace(".md", "-summary-audio");
            const audioPath = path.join(audioDir, audioFilename);
            
            // Generate audio from the summary
            const generatedAudioPath = await generateSummaryAudio(
              summary,
              audioPath,
              options.audioOptions || {}
            );
            
            // Update metadata with audio path
            metadata.content.audioPath = path.relative(thoughtsDir, generatedAudioPath);
            console.log("Audio generated successfully.");
          } else {
            console.log("Text-to-speech not available on this system. Audio generation skipped.");
          }
        } catch (error) {
          console.error("Error generating audio:", error.message);
          // Continue processing even if audio generation fails
        }
      }

      // Update metadata with Claude information and detected entities
      metadata.ai = {
        model: this.config.model,
        promptType: "web-content-summary",
        processingTimeMs: summary.processingTimeMs,
      };

      if (summary.detectedEntities) {
        metadata.detectedEntities = summary.detectedEntities;
      }

      if (summary.codeSnippets) {
        metadata.codeSnippets = summary.codeSnippets;
      }

      // Update the metadata with the summary path
      metadata.content.summaryPath = path.relative(thoughtsDir, summaryPath);

      // Save updated metadata
      const metadataDir = path.join(thoughtsDir, ".metadata");
      const indexPath = path.join(metadataDir, "web-content-index.json");

      const index = JSON.parse(await fs.readFile(indexPath, "utf8"));

      // Find and replace the metadata in the index
      const entryIndex = index.entries.findIndex(
        (entry) => entry.id === metadata.id,
      );
      if (entryIndex !== -1) {
        index.entries[entryIndex] = metadata;
      }

      // Update the index
      await fs.writeFile(indexPath, JSON.stringify(index, null, 2));

      return {
        metadata,
        thoughtContent: updatedThoughtContent,
        thoughtFilename,
      };
    } catch (error) {
      console.error("Error processing with Claude:", error);
      // Return original results if Claude processing fails
      return { metadata, thoughtContent, thoughtFilename };
    }
  }

  /**
   * Generate a summary of the content using Claude
   * @param {string} content - The markdown content to summarize
   * @param {string} title - The title of the content
   * @param {string} url - The source URL
   * @param {SummaryOptions} options - Options for the summary
   * @returns {Promise<{
   *   shortSummary: string,
   *   fullSummary: string,
   *   keyPoints: string[],
   *   detectedEntities: {
   *     technologies: string[],
   *     people: string[],
   *     companies: string[]
   *   },
   *   codeSnippets: Array<{
   *     language: string,
   *     code: string,
   *     lineCount: number
   *   }>,
   *   processingTimeMs: number
   * }>} - The generated summary
   */
  async generateSummary(content, title, url, options) {
    const startTime = Date.now();

    // Truncate content if it's too long to fit in a reasonable prompt
    const truncatedContent = this.truncateContent(content, 24000);

    // Construct the prompt for Claude
    const systemPrompt = this.buildSummarySystemPrompt(options);

    // Build the user message with the content to summarize
    const userMessage = `Here's the content from "${title}" (${url}) that I'd like you to summarize and analyze:\n\n${truncatedContent}`;

    try {
      // Make API request to Claude
      const response = await axios.post(
        this.config.apiEndpoint,
        {
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.config.apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      );

      // Process Claude's response
      const assistantMessage = response.data.content[0].text;
      const processingTimeMs = Date.now() - startTime;

      // Parse the structured response from Claude
      return this.parseClaudeResponse(assistantMessage, processingTimeMs);
    } catch (error) {
      console.error(
        "Error calling Claude API:",
        error.response?.data || error.message,
      );

      // Return a basic structure in case of failure
      return {
        shortSummary: "Failed to generate summary with Claude.",
        fullSummary: "Failed to generate summary with Claude.",
        keyPoints: [],
        detectedEntities: {
          technologies: [],
          people: [],
          companies: [],
        },
        codeSnippets: [],
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Build the system prompt for Claude
   * @param {SummaryOptions} options - Options for the summary
   * @returns {string} - The system prompt
   */
  buildSummarySystemPrompt(options) {
    let systemPrompt = `You are an expert assistant that summarizes web content. 
Provide a concise and informative summary of the content. 
Your response should be well-structured and formatted in Markdown.

Structure your response with these sections:
1. <summary>A concise one-paragraph summary of the main content</summary>
2. <full_summary>A more detailed summary (max ${options.maxLength} words) that captures the key information</full_summary>`;

    if (options.includeKeyPoints) {
      systemPrompt += `
3. <key_points>
   - List of key points as bullet points
   - Each point should be a single sentence
   - Include 3-7 key points depending on content complexity
</key_points>`;
    }

    if (options.includeEntities) {
      systemPrompt += `
4. <entities>
   JSON object with these properties:
   - "technologies": Array of technology names mentioned (frameworks, languages, tools, platforms)
   - "people": Array of notable people mentioned
   - "companies": Array of companies or organizations mentioned
</entities>`;
    }

    if (options.includeCodeSnippets) {
      systemPrompt += `
5. <code_snippets>
   If the content contains code snippets, extract them as:
   JSON array of objects with:
   - "language": Programming language of the snippet
   - "code": The actual code
   - "lineCount": Number of lines
</code_snippets>`;
    }

    systemPrompt += `
Be objective and focus on the factual content. Maintain the original meaning without adding your own opinions.
Ensure all sections are properly formatted with Markdown.`;

    return systemPrompt;
  }

  /**
   * Parse Claude's response into structured data
   * @param {string} response - Claude's text response
   * @param {number} processingTimeMs - Time taken to process
   * @returns {Object} - Structured summary data
   */
  parseClaudeResponse(response, processingTimeMs) {
    // Initialize with default values
    const result = {
      shortSummary: "",
      fullSummary: "",
      keyPoints: [],
      detectedEntities: {
        technologies: [],
        people: [],
        companies: [],
      },
      codeSnippets: [],
      processingTimeMs,
    };

    // Extract the short summary
    const summaryMatch = response.match(/<summary>(.*?)<\/summary>/s);
    if (summaryMatch) {
      result.shortSummary = summaryMatch[1].trim();
    }

    // Extract the full summary
    const fullSummaryMatch = response.match(
      /<full_summary>(.*?)<\/full_summary>/s,
    );
    if (fullSummaryMatch) {
      result.fullSummary = fullSummaryMatch[1].trim();
    }

    // Extract key points
    const keyPointsMatch = response.match(/<key_points>(.*?)<\/key_points>/s);
    if (keyPointsMatch) {
      // Extract bullet points
      const keyPointsText = keyPointsMatch[1];
      const bulletPoints = keyPointsText.match(/- (.*?)(?=\n- |\n\n|$)/gs);

      if (bulletPoints) {
        result.keyPoints = bulletPoints.map((point) =>
          point.replace(/^- /, "").trim(),
        );
      }
    }

    // Extract entities
    const entitiesMatch = response.match(/<entities>(.*?)<\/entities>/s);
    if (entitiesMatch) {
      try {
        // Try to parse the JSON
        const entitiesText = entitiesMatch[1].trim();
        // Find the JSON object within this text (sometimes Claude adds markdown formatting)
        const jsonMatch = entitiesText.match(
          /```json\s*(\{.*?\})\s*```|(\{.*?\})/s,
        );

        if (jsonMatch) {
          const jsonStr = (jsonMatch[1] || jsonMatch[2]).trim();
          const entities = JSON.parse(jsonStr);

          // Assign the entities if they exist
          if (entities.technologies)
            result.detectedEntities.technologies = entities.technologies;
          if (entities.people) result.detectedEntities.people = entities.people;
          if (entities.companies)
            result.detectedEntities.companies = entities.companies;
        }
      } catch (error) {
        console.warn("Failed to parse entities JSON:", error);
      }
    }

    // Extract code snippets
    const codeSnippetsMatch = response.match(
      /<code_snippets>(.*?)<\/code_snippets>/s,
    );
    if (codeSnippetsMatch) {
      try {
        // Try to parse the JSON
        const snippetsText = codeSnippetsMatch[1].trim();
        // Find the JSON array within this text
        const jsonMatch = snippetsText.match(
          /```json\s*(\[.*?\])\s*```|(\[.*?\])/s,
        );

        if (jsonMatch) {
          const jsonStr = (jsonMatch[1] || jsonMatch[2]).trim();
          result.codeSnippets = JSON.parse(jsonStr);
        }
      } catch (error) {
        console.warn("Failed to parse code snippets JSON:", error);
      }
    }

    return result;
  }

  /**
   * Truncate content to a maximum size to fit in Claude's context window
   * @param {string} content - The content to truncate
   * @param {number} maxChars - Maximum number of characters
   * @returns {string} - Truncated content
   */
  truncateContent(content, maxChars = 24000) {
    if (content.length <= maxChars) {
      return content;
    }

    // Keep the first 2/3 and last 1/3 of the allowed content
    // This preserves both the beginning and end, which often contain important information
    const firstPart = Math.floor(maxChars * 0.67);
    const lastPart = maxChars - firstPart - 100; // 100 chars for the ellipsis and buffer

    return (
      content.substring(0, firstPart) +
      `\n\n[...Content truncated due to length (${content.length} characters)...]\n\n` +
      content.substring(content.length - lastPart)
    );
  }

  /**
   * Update the thought content with AI-generated summary
   * @param {string} originalContent - Original thought content
   * @param {Object} summary - The summary object from Claude
   * @returns {string} - Updated thought content
   */
  updateThoughtContent(originalContent, summary) {
    // Find the summary section in the original content
    const summaryPattern = /## Summary\s*\n\n\*[^*]*\*/;

    // Create the new summary section with word wrapping
    let newSummarySection = `## Summary\n\n${wordWrap(summary.shortSummary)}\n\n### Key Points\n\n`;
    
    // Add key points with proper wrapping
    newSummarySection += summary.keyPoints
      .map((point) => `- ${wordWrap(point, 75)}`) // Slightly narrower for bullets
      .join("\n");

    // Replace the placeholder summary with the AI-generated one
    return originalContent.replace(summaryPattern, newSummarySection);
  }
}

/**
 * Create a Claude processor with default configuration
 * @param {string} apiKey - Claude API key
 * @returns {ClaudeProcessor} - Configured Claude processor
 */
export function createClaudeProcessor(apiKey) {
  return new ClaudeProcessor({
    apiKey,
    model: "claude-3-opus-20240229",
    maxTokens: 4000,
    temperature: 0.7,
  });
}

