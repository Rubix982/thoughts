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

import blessed from "blessed";
import { marked } from "marked";
import chalk from "chalk";
import stripAnsi from "strip-ansi";
import highlight from "cli-highlight";
import path from "path";
import { format } from "date-fns";
import { spawn } from "child_process";
import { promises as fs } from "fs";

// Simple helper to convert markdown to colored text
function simpleMarkdownRenderer(markdown) {
  // Basic formatting
  let text = markdown;

  // Headers
  text = text.replace(/^# (.+)$/gm, chalk.bold.underline.blue("$1"));
  text = text.replace(/^## (.+)$/gm, chalk.bold.cyan("$1"));
  text = text.replace(/^### (.+)$/gm, chalk.bold.green("$1"));

  // Lists
  text = text.replace(/^- (.+)$/gm, "• " + chalk.white("$1"));
  text = text.replace(/^\* (.+)$/gm, "• " + chalk.white("$1"));
  text = text.replace(/^(\d+)\. (.+)$/gm, "$1. " + chalk.white("$2"));

  // Bold and italic
  text = text.replace(/\*\*(.+?)\*\*/g, chalk.bold("$1"));
  text = text.replace(/\*(.+?)\*/g, chalk.italic("$1"));
  text = text.replace(/_(.+?)_/g, chalk.italic("$1"));

  // Code
  text = text.replace(/`(.+?)`/g, chalk.yellow("$1"));

  // Code blocks
  text = text.replace(/```([\s\S]*?)```/g, (match, codeBlock) => {
    return "\n" + chalk.bgBlack.yellow(codeBlock) + "\n";
  });

  // Links
  text = text.replace(/\[(.+?)\]\((.+?)\)/g, chalk.blue.underline("$1"));

  return text;
}

/**
 * Main TUI application class
 */
export class ThoughtsTUI {
  constructor(thoughtsDir) {
    this.thoughtsDir = thoughtsDir;
    this.thoughts = [];
    this.selectedIndex = 0;
    this.searchText = "";
    this.isSearchMode = false;
    this.previewContent = "";
    this.visibleThoughts = [];
    this.isFullscreen = false;
    this.currentTheme = "default";
    this.todos = [];

    // UI elements
    this.screen = null;
    this.listBox = null;
    this.previewBox = null;
    this.searchBox = null;
    this.helpBox = null;
    this.statusBar = null;
    this.contextMenu = null;
    this.todoBox = null;

    // Common styles for all list-type widgets to avoid repetition
    this.commonListStyle = (theme) => ({
      bg: "transparent",
      fg: theme.fg,
      border: {
        fg: theme.border,
      },
      item: {
        hover: {
          bg: theme.hover || "gray",
        },
      },
      selected: theme.selected,
      scrollbar: {
        bg: "transparent",
        fg: theme.border,
      },
    });

    // Available themes
    this.themes = {
      default: {
        bg: "transparent",
        fg: "white",
        border: "white",
        hover: "gray",
        selected: {
          bg: "blue",
          fg: "white",
        },
        header: {
          fg: "cyan",
          bold: true,
        },
        statusBar: {
          bg: "grey",
          fg: "white",
        },
      },
      light: {
        bg: "transparent",
        fg: "black",
        border: "blue",
        hover: "lightgray",
        selected: {
          bg: "cyan",
          fg: "black",
        },
        header: {
          fg: "blue",
          bold: true,
        },
        statusBar: {
          bg: "blue",
          fg: "white",
        },
      },
      dracula: {
        bg: "transparent",
        fg: "#f8f8f2",
        border: "#bd93f9",
        hover: "#44475a",
        selected: {
          bg: "#6272a4",
          fg: "#f8f8f2",
        },
        header: {
          fg: "#ff79c6",
          bold: true,
        },
        statusBar: {
          bg: "#44475a",
          fg: "#f8f8f2",
        },
      },
      night: {
        bg: "transparent",
        fg: "#c0caf5",
        border: "#7aa2f7",
        hover: "#292e42",
        selected: {
          bg: "#3b4261",
          fg: "#c0caf5",
        },
        header: {
          fg: "#bb9af7",
          bold: true,
        },
        statusBar: {
          bg: "#24283b",
          fg: "#c0caf5",
        },
      },
    };
  }

  /**
   * Initialize the TUI
   */
  async init() {
    try {
      await this.loadThoughts();
      this.extractTodos();
      this.setupScreen();
      this.applyTheme(this.currentTheme);
      this.renderScreen();
      this.setupKeys();
    } catch (error) {
      console.error(`Error in init: ${error.message}`);
      console.error(error.stack);
      process.exit(1);
    }
  }

  /**
   * Extract TODO items from all thoughts
   */
  extractTodos() {
    this.todos = [];

    // Look for todo items in all thoughts
    this.thoughts.forEach((thought) => {
      const lines = thought.content.split("\n");
      lines.forEach((line, lineNum) => {
        // Match common todo patterns: [ ], [x], - [ ], * [ ], etc.
        const todoMatch = line.match(/^\s*(?:[-*]\s*)?(\[[\sx]?\])\s*(.+)$/i);
        if (todoMatch) {
          const completed =
            todoMatch[1].includes("x") || todoMatch[1].includes("X");
          this.todos.push({
            text: todoMatch[2],
            completed,
            sourceThought: thought.title,
            sourcePath: thought.path,
            lineNum,
            line,
          });
        }
      });
    });
  }

  /**
   * Apply the specified theme to the UI
   */
  applyTheme(themeName) {
    if (!this.themes[themeName]) {
      console.error(`Theme '${themeName}' not found, using default.`);
      themeName = "default";
    }

    this.currentTheme = themeName;
    const theme = this.themes[themeName];

    if (!this.screen) return; // Screen not set up yet

    // Apply theme to list box
    const listStyle = this.commonListStyle(theme);
    this.listBox.style = {
      ...listStyle,
      header: theme.header,
    };

    // Apply theme to preview box
    this.previewBox.style = {
      bg: "transparent",
      fg: theme.fg,
      border: {
        fg: theme.border,
      },
      scrollbar: {
        bg: "transparent",
        fg: theme.border,
      },
    };

    // Apply theme to status bar
    this.statusBar.style = {
      bg: theme.statusBar.bg,
      fg: theme.statusBar.fg,
    };

    // Apply theme to help box
    if (this.helpBox) {
      this.helpBox.style = {
        bg: "transparent",
        fg: theme.fg,
        border: {
          fg: theme.border,
        },
      };
    }

    // Apply theme to context menu
    if (this.contextMenu) {
      this.contextMenu.style = this.commonListStyle(theme);
    }

    // Apply theme to todo box
    if (this.todoBox) {
      this.todoBox.style = this.commonListStyle(theme);
    }

    // Render the screen to apply theme changes
    this.screen.render();
  }

  /**
   * Load all thoughts from the directory
   */
  async loadThoughts() {
    try {
      const files = await fs.readdir(this.thoughtsDir);
      const mdFiles = files.filter((file) => file.endsWith(".md"));

      // Process each markdown file
      const thoughtPromises = mdFiles.map(async (file) => {
        const filePath = path.join(this.thoughtsDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const filename = path.basename(file);

        // Extract date from filename (expected format: YYYY-MM-DDTHH-mm-ss.sssZ-title.md)
        let date;
        try {
          // Try to extract date pattern from filename
          const matches = filename.match(
            /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/,
          );
          if (matches && matches[1]) {
            // Convert from "2025-04-06T15-30-00" to "2025-04-06T15:30:00"
            const dateStr = matches[1].replace(/-/g, (m, i) =>
              i > 10 ? ":" : "-",
            );
            date = new Date(dateStr);
          } else {
            date = new Date(); // Default to current date if can't parse
          }

          // Validate that the date is valid
          if (isNaN(date.getTime())) {
            date = new Date(); // Fallback to current date
          }
        } catch (e) {
          console.error(
            `Error parsing date from filename ${filename}: ${e.message}`,
          );
          date = new Date(); // Default to current date if can't parse
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
          path: filePath,
          filename,
          date,
          title,
          content,
        };
      });

      this.thoughts = await Promise.all(thoughtPromises);
      // Sort by date, newest first (with safe comparison)
      this.thoughts.sort((a, b) => {
        // Handle potentially invalid dates
        const aTime =
          a.date instanceof Date && !isNaN(a.date.getTime())
            ? a.date.getTime()
            : 0;
        const bTime =
          b.date instanceof Date && !isNaN(b.date.getTime())
            ? b.date.getTime()
            : 0;
        return bTime - aTime;
      });
      this.visibleThoughts = [...this.thoughts];
    } catch (error) {
      console.error(`Error loading thoughts: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Set up the blessed screen
   */
  setupScreen() {
    // Create a screen object
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Thoughts Terminal UI",
      fullUnicode: true,
      dockBorders: true,
      transparent: true,
    });

    // Message box defaults
    this.messageBoxDefaults = {
      info: {
        width: "50%",
        height: "shrink",
        border: "line",
        align: "center",
        valign: "middle",
        padding: 1,
        top: "center",
        left: "center",
        style: {
          fg: "white",
          bg: "black",
          border: {
            fg: "white",
          },
        },
      },
      success: {
        width: "50%",
        height: "shrink",
        border: "line",
        align: "center",
        valign: "middle",
        padding: 1,
        top: "center",
        left: "center",
        style: {
          fg: "white",
          bg: "green",
          border: {
            fg: "green",
          },
        },
      },
      error: {
        width: "50%",
        height: "shrink",
        border: "line",
        align: "center",
        valign: "middle",
        padding: 1,
        top: "center",
        left: "center",
        style: {
          fg: "white",
          bg: "red",
          border: {
            fg: "red",
          },
        },
      },
      confirm: {
        width: "50%",
        height: "shrink",
        border: "line",
        align: "center",
        valign: "middle",
        padding: 1,
        top: "center",
        left: "center",
        style: {
          fg: "white",
          bg: "black",
          border: {
            fg: "red",
          },
        },
      },
    };

    // Create list box for thoughts
    const defaultTheme = this.themes["default"];
    const defaultListStyle = this.commonListStyle(defaultTheme);

    this.listBox = blessed.list({
      parent: this.screen,
      label: " Thoughts ",
      tags: true,
      width: "40%",
      height: "100%-3",
      left: 0,
      top: 0,
      border: {
        type: "line",
      },
      style: {
        ...defaultListStyle,
        selected: {
          ...defaultListStyle.selected,
          bold: true,
        },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: "│",
        track: {
          bg: "black",
        },
        style: {
          inverse: true,
        },
      },
    });

    // Create preview box for thought content
    this.previewBox = blessed.box({
      parent: this.screen,
      label: " Preview ",
      tags: true,
      padding: 1,
      width: "60%",
      height: "100%-3",
      right: 0,
      top: 0,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "white",
        },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: "│",
        track: {
          bg: "black",
        },
        style: {
          inverse: true,
        },
      },
    });

    // Create search box
    this.searchBox = blessed.textbox({
      parent: this.screen,
      bottom: 1,
      left: 0,
      height: 1,
      width: "100%",
      keys: true,
      input: true,
      inputOnFocus: true,
      style: {
        fg: "white",
        bg: "blue",
      },
      value: "", // Initialize with empty value
    });

    // Add setValue method if not already present
    if (!this.searchBox.setValue) {
      this.searchBox.setValue = function (val) {
        this.value = val || "";
        this.setContent(val || "");
      };
    }

    // Create status bar
    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      height: 1,
      width: "100%",
      content:
        " {bold}Thoughts TUI{/bold} | {blue-fg}↑/↓{/blue-fg}: Navigate | {blue-fg}Enter{/blue-fg}: Open | {blue-fg}/{/blue-fg}: Search | {blue-fg}c{/blue-fg}: Menu | {blue-fg}t{/blue-fg}: TODOs | {blue-fg}f{/blue-fg}: Fullscreen | {blue-fg}m{/blue-fg}: Theme | {blue-fg}?{/blue-fg}: Help | {blue-fg}q{/blue-fg}: Quit",
      tags: true,
      style: {
        fg: "white",
        bg: "grey",
      },
    });

    // Create context menu (hidden by default)
    this.contextMenu = blessed.list({
      parent: this.screen,
      label: " Actions ",
      tags: true,
      width: 30,
      height: 10,
      left: "center",
      top: "center",
      border: {
        type: "line",
      },
      style: defaultListStyle,
      keys: true,
      vi: true,
      mouse: true,
      items: [
        "Open in editor",
        "Toggle fullscreen",
        "Copy title to clipboard",
        "View TODOs in thought",
        "Word count statistics",
        "Export as HTML",
        "Delete thought",
        "Cancel",
      ],
      hidden: true,
    });

    // Create TODO list box (hidden by default)
    this.todoBox = blessed.list({
      parent: this.screen,
      label: " TODOs ",
      tags: true,
      width: "80%",
      height: "80%",
      left: "center",
      top: "center",
      border: {
        type: "line",
      },
      style: defaultListStyle,
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: "│",
        track: {
          bg: "black",
        },
        style: {
          inverse: true,
        },
      },
      hidden: true,
    });

    // Create help box (hidden by default)
    this.helpBox = blessed.box({
      parent: this.screen,
      label: " Help ",
      tags: true,
      padding: 1,
      width: "70%",
      height: "70%",
      left: "center",
      top: "center",
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "white",
        },
        fg: "white",
        bg: "transparent",
      },
      content: `{bold}Keyboard Shortcuts{/bold}

{blue-fg}Navigation{/blue-fg}
↑/↓, j/k    : Navigate through thoughts
PgUp/PgDown : Scroll page up/down
Home/End    : Go to first/last thought

{blue-fg}Display{/blue-fg}
Enter      : Open selected thought in editor
o          : Open selected thought in editor
f          : Toggle fullscreen mode
p          : Preview mode toggle (expand/collapse)
s          : Sort (toggle between newest/oldest first)
m          : Cycle through themes (default, light, dracula, night)

{blue-fg}Search{/blue-fg}
/          : Enter search mode
Escape     : Clear search/exit search mode
n          : Next search result
N          : Previous search result

{blue-fg}Features{/blue-fg}
c          : Open context menu for current thought
t          : Show all TODOs across all thoughts
?          : Show/hide this help screen

{blue-fg}Context Menu Actions{/blue-fg}
• Open in editor      : Open selected thought in external editor
• Toggle fullscreen   : Switch between split view and fullscreen
• Copy title          : Copy thought title to clipboard
• View TODOs          : Show TODOs from current thought
• Word stats          : Display statistics about the thought
• Export as HTML      : Save thought as formatted HTML
• Delete thought      : Remove thought file (with confirmation)

{blue-fg}System{/blue-fg}
q, Ctrl+C  : Quit
r          : Reload thoughts

{blue-fg}Preview Navigation{/blue-fg}
Tab        : Focus preview pane
↑/↓        : Scroll preview up/down when focused
Shift+Tab  : Return to list pane

Press any key to close this help`,
      hidden: true,
    });

    // Quit on Escape, q, or Control-C
    this.screen.key(["escape"], () => {
      if (this.isSearchMode) {
        this.isSearchMode = false;
        this.searchText = "";
        this.searchBox.setValue("");
        this.searchBox.hide();
        this.resetFilter();
        this.screen.render();
      } else if (this.helpBox.visible) {
        this.helpBox.hide();
        this.screen.render();
      } else if (this.contextMenu.visible) {
        this.contextMenu.hide();
        this.screen.render();
      } else if (this.todoBox.visible) {
        this.todoBox.hide();
        this.screen.render();
      } else {
        return process.exit(0);
      }
    });
  }

  /**
   * Set up keyboard shortcuts
   */
  setupKeys() {
    // List navigation
    this.listBox.key(["up", "k"], () => {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.listBox.select(this.selectedIndex);
        this.updatePreview();
        this.screen.render();
      }
    });

    this.listBox.key(["down", "j"], () => {
      if (this.selectedIndex < this.visibleThoughts.length - 1) {
        this.selectedIndex++;
        this.listBox.select(this.selectedIndex);
        this.updatePreview();
        this.screen.render();
      }
    });

    // Open thought in editor
    this.listBox.key(["enter", "o"], () => {
      if (this.visibleThoughts.length > 0) {
        this.openThought(this.visibleThoughts[this.selectedIndex].path);
      }
    });

    // Quick search
    this.screen.key("/", () => {
      // Completely remove existing listeners to prevent duplications
      this.searchBox.removeAllListeners("submit");

      // Reset search box
      this.searchBox.setValue("");
      this.searchBox.setContent("Search: ");
      this.isSearchMode = true;
      this.searchBox.show();
      this.searchBox.readInput();
      this.screen.render();

      // Re-attach the submit listener
      this.searchBox.once("submit", (text) => {
        this.searchText = text.replace("Search: ", "").trim();
        this.filterThoughts();
        this.searchBox.hide();
        this.isSearchMode = false;
        this.screen.render();
      });
    });

    // Handle escape key in search box
    this.searchBox.key("escape", () => {
      this.searchBox.hide();
      this.isSearchMode = false;
      this.searchText = "";
      this.resetFilter();
      this.screen.render();
    });

    // Help screen
    this.screen.key("?", () => {
      this.helpBox.toggle();
      this.screen.render();
    });

    this.helpBox.key(["escape", "q", "enter", "space"], () => {
      this.helpBox.hide();
      this.screen.render();
    });

    // Quit
    this.screen.key(["q", "C-c"], () => {
      return process.exit(0);
    });

    // Reload thoughts
    this.screen.key("r", async () => {
      await this.loadThoughts();
      this.extractTodos();
      this.resetFilter();
      this.screen.render();
    });

    // Toggle sort order
    this.screen.key("s", () => {
      this.thoughts.reverse();
      this.visibleThoughts.reverse();
      this.updateList();
      this.screen.render();
    });

    // Switch focus between panes
    this.screen.key("tab", () => {
      if (this.screen.focused === this.listBox) {
        this.previewBox.focus();
      } else {
        this.listBox.focus();
      }
    });

    // Context menu
    this.screen.key("c", () => {
      if (this.visibleThoughts.length === 0) return;

      this.contextMenu.show();
      this.contextMenu.focus();
      this.screen.render();
    });

    // Handle context menu actions
    this.contextMenu.on("select", (item, index) => {
      const action = this.contextMenu.getItem(index);
      const thought = this.visibleThoughts[this.selectedIndex];

      switch (action) {
        case "Open in editor":
          this.contextMenu.hide();
          this.openThought(thought.path);
          break;

        case "Toggle fullscreen":
          this.contextMenu.hide();
          this.toggleFullscreen();
          break;

        case "Copy title to clipboard":
          this.contextMenu.hide();
          // Using echo to pipe to clipboard on macOS
          spawn("bash", ["-c", `echo "${thought.title}" | pbcopy`]);
          this.screen.render();
          break;

        case "View TODOs in thought":
          this.contextMenu.hide();
          this.showTodosForThought(thought);
          break;

        case "Word count statistics":
          this.contextMenu.hide();
          this.showWordStats(thought);
          break;

        case "Export as HTML":
          this.contextMenu.hide();
          this.exportAsHtml(thought);
          break;

        case "Delete thought":
          this.contextMenu.hide();
          this.deleteThought(thought);
          break;

        case "Cancel":
        default:
          this.contextMenu.hide();
          this.screen.render();
          break;
      }
    });

    // Hide context menu on escape
    this.contextMenu.key(["escape", "q"], () => {
      this.contextMenu.hide();
      this.screen.render();
    });

    // Toggle fullscreen mode
    this.screen.key("f", () => {
      this.toggleFullscreen();
    });

    // Toggle theme cycling
    this.screen.key("m", () => {
      const themes = Object.keys(this.themes);
      const currentIndex = themes.indexOf(this.currentTheme);
      const nextIndex = (currentIndex + 1) % themes.length;
      this.applyTheme(themes[nextIndex]);
    });

    // Show all TODOs
    this.screen.key("t", () => {
      this.showAllTodos();
    });

    // Hide todo box on escape
    this.todoBox.key(["escape", "q"], () => {
      this.todoBox.hide();
      this.screen.render();
    });

    // Open thought containing selected TODO
    this.todoBox.key(["enter"], () => {
      const selectedTodo = this.todos[this.todoBox.selected];
      if (selectedTodo) {
        this.todoBox.hide();
        this.openThought(selectedTodo.sourcePath);
      }
    });

    // Focus list initially
    this.listBox.focus();
  }

  /**
   * Render the screen with thoughts list and preview
   */
  renderScreen() {
    this.updateList();
    this.updatePreview();
    this.screen.render();
  }

  /**
   * Update the thoughts list box
   */
  updateList() {
    // Clear the list
    this.listBox.clearItems();

    // Add each thought to the list
    this.visibleThoughts.forEach((thought) => {
      // Safe date formatting
      let formattedDate;
      try {
        formattedDate = format(thought.date, "yyyy-MM-dd");
        if (formattedDate === "Invalid Date") {
          formattedDate = "Unknown date";
        }
      } catch (e) {
        formattedDate = "Unknown date";
      }
      this.listBox.addItem(`${formattedDate} - ${thought.title}`);
    });

    // Select the current item
    if (this.visibleThoughts.length > 0) {
      this.listBox.select(this.selectedIndex);
    }
  }

  /**
   * Update the preview box with the selected thought's content
   */
  updatePreview() {
    if (this.visibleThoughts.length === 0) {
      this.previewBox.setContent("No thoughts found");
      return;
    }

    const thought = this.visibleThoughts[this.selectedIndex];
    if (!thought) return;

    try {
      // Render markdown content with our custom renderer
      const renderedContent = simpleMarkdownRenderer(thought.content);

      // Set preview content
      this.previewBox.setContent(renderedContent);

      // Update label with safe date formatting
      let formattedDate;
      try {
        formattedDate = format(thought.date, "yyyy-MM-dd");
        if (formattedDate === "Invalid Date") {
          formattedDate = "Unknown date";
        }
      } catch (e) {
        formattedDate = "Unknown date";
      }
      this.previewBox.setLabel(` ${thought.title} (${formattedDate}) `);
    } catch (error) {
      this.previewBox.setContent(`Error rendering preview: ${error.message}`);
    }
  }

  /**
   * Filter thoughts based on search text
   */
  filterThoughts() {
    if (!this.searchText) {
      this.resetFilter();
      return;
    }

    const searchLower = this.searchText.toLowerCase();
    this.visibleThoughts = this.thoughts.filter(
      (thought) =>
        thought.title.toLowerCase().includes(searchLower) ||
        thought.content.toLowerCase().includes(searchLower),
    );

    this.selectedIndex = 0;
    this.updateList();
    this.updatePreview();
  }

  /**
   * Reset the filter to show all thoughts
   */
  resetFilter() {
    this.visibleThoughts = [...this.thoughts];
    this.updateList();
    this.updatePreview();
  }

  /**
   * Helper to show an info message
   * @param {string} content - The message content
   * @param {Function} callback - Optional callback after message is closed
   * @param {Object} options - Optional override for default settings
   */
  showInfoMessage(content, callback = null, options = {}) {
    try {
      // Apply current theme's border color if available
      const defaults = { ...this.messageBoxDefaults.info };
      if (this.themes[this.currentTheme]) {
        defaults.style.border.fg = this.themes[this.currentTheme].border;
      }

      // Create message with merged options
      const message = blessed.message({
        ...defaults,
        ...options,
        parent: this.screen,
        content,
        style: {
          ...defaults.style,
          ...(options.style || {}),
        },
      });

      // Display with callback
      message.display(() => {
        this.listBox.focus();
        if (callback) callback();
      });
    } catch (error) {
      console.error(`Error displaying info message: ${error.message}`);
      this.listBox.focus();
    }
  }

  /**
   * Helper to show a success message
   * @param {string} content - The message content
   * @param {Function} callback - Optional callback after message is closed
   * @param {Object} options - Optional override for default settings
   */
  showSuccessMessage(content, callback = null, options = {}) {
    try {
      const message = blessed.message({
        ...this.messageBoxDefaults.success,
        ...options,
        parent: this.screen,
        content,
        style: {
          ...this.messageBoxDefaults.success.style,
          ...(options.style || {}),
        },
      });

      message.display(() => {
        this.listBox.focus();
        if (callback) callback();
      });
    } catch (error) {
      console.error(`Error displaying success message: ${error.message}`);
      this.listBox.focus();
    }
  }

  /**
   * Helper to show an error message
   * @param {string} content - The message content
   * @param {Function} callback - Optional callback after message is closed
   * @param {Object} options - Optional override for default settings
   */
  showErrorMessage(content, callback = null, options = {}) {
    try {
      const message = blessed.message({
        ...this.messageBoxDefaults.error,
        ...options,
        parent: this.screen,
        content,
        style: {
          ...this.messageBoxDefaults.error.style,
          ...(options.style || {}),
        },
      });

      message.display(() => {
        this.listBox.focus();
        if (callback) callback();
      });
    } catch (error) {
      console.error(`Error displaying error message: ${error.message}`);
      this.listBox.focus();
    }
  }

  /**
   * Helper to show a confirmation dialog
   * @param {string} content - The question content
   * @param {Function} callback - Callback with the answer
   * @param {Object} options - Optional override for default settings
   */
  showConfirmDialog(content, callback, options = {}) {
    try {
      const question = blessed.question({
        ...this.messageBoxDefaults.confirm,
        ...options,
        parent: this.screen,
        content,
        style: {
          ...this.messageBoxDefaults.confirm.style,
          ...(options.style || {}),
        },
      });

      question.ask((err, result) => {
        if (err) {
          console.error(`Error in confirmation dialog: ${err.message}`);
          this.listBox.focus();
          callback(err, false);
          return;
        }
        callback(null, result);
      });
    } catch (error) {
      console.error(`Error displaying confirmation dialog: ${error.message}`);
      this.listBox.focus();
      callback(error, false);
    }
  }

  /**
   * Open a thought in the editor
   * @param {string} filePath - Path to the thought file
   */
  async openThought(filePath) {
    // Save screen state
    this.screen.leave();

    // Get editor from environment variables
    const editor = process.env.THOUGHTS_EDITOR || process.env.EDITOR || "nano";

    try {
      // Spawn editor process
      const editorProcess = spawn(editor, [filePath], {
        stdio: "inherit",
        shell: true,
      });

      // Wait for editor to exit
      await new Promise((resolve) => {
        editorProcess.on("exit", resolve);
      });

      // Reload thoughts to get any changes
      await this.loadThoughts();

      // Restore screen and render
      this.screen.enter();
      this.filterThoughts(); // Apply current filter
      this.screen.render();
    } catch (error) {
      console.error(`Error opening thought: ${error.message}`);
    }
  }

  /**
   * Toggle fullscreen mode between list and preview
   */
  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;

    if (this.isFullscreen) {
      // Show only the preview box in fullscreen mode
      this.listBox.hide();
      this.previewBox.left = 0;
      this.previewBox.width = "100%";
      this.previewBox.focus();

      // Update status bar to show we're in fullscreen mode
      this.statusBar.setContent(
        " {bold}Thoughts TUI{/bold} | {red-fg}FULLSCREEN{/red-fg} | {blue-fg}f{/blue-fg}: Exit Fullscreen | {blue-fg}Esc{/blue-fg}: Exit | {blue-fg}?{/blue-fg}: Help | {blue-fg}q{/blue-fg}: Quit",
      );
    } else {
      // Return to split view
      this.listBox.show();
      this.previewBox.left = "40%";
      this.previewBox.width = "60%";
      this.listBox.focus();

      // Restore normal status bar
      this.statusBar.setContent(
        " {bold}Thoughts TUI{/bold} | {blue-fg}↑/↓{/blue-fg}: Navigate | {blue-fg}Enter{/blue-fg}: Open | {blue-fg}/{/blue-fg}: Search | {blue-fg}c{/blue-fg}: Menu | {blue-fg}t{/blue-fg}: TODOs | {blue-fg}f{/blue-fg}: Fullscreen | {blue-fg}m{/blue-fg}: Theme | {blue-fg}?{/blue-fg}: Help | {blue-fg}q{/blue-fg}: Quit",
      );
    }

    this.screen.render();
  }

  /**
   * Show TODOs for a specific thought
   * @param {Object} thought - The thought to show TODOs for
   */
  showTodosForThought(thought) {
    // Filter todos to show only those from the specified thought
    const thoughtTodos = this.todos.filter(
      (todo) => todo.sourcePath === thought.path,
    );

    if (thoughtTodos.length === 0) {
      this.showInfoMessage(`No TODOs found in "${thought.title}"`, null, {
        width: "40%",
      });
      return;
    }

    // Clear previous items
    this.todoBox.clearItems();

    // Add todos to the list
    thoughtTodos.forEach((todo) => {
      const status = todo.completed ? "[x]" : "[ ]";
      const todoText = `${status} ${todo.text}`;
      this.todoBox.addItem(todoText);
    });

    // Show and focus the todo box
    this.todoBox.setLabel(
      ` TODOs in "${thought.title}" (${thoughtTodos.length}) `,
    );
    this.todoBox.show();
    this.todoBox.focus();
    this.todoBox.select(0);
    this.screen.render();
  }

  /**
   * Show word statistics for a thought
   * @param {Object} thought - The thought to analyze
   */
  showWordStats(thought) {
    // Strip markdown formatting
    const plainText = stripAnsi(simpleMarkdownRenderer(thought.content));

    // Count words, lines, characters
    const lines = plainText.split("\n");
    const lineCount = lines.length;
    const words = plainText.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;
    const charCount = plainText.length;

    // Count common punctuation
    const periods = (plainText.match(/\./g) || []).length;
    const commas = (plainText.match(/,/g) || []).length;
    const questions = (plainText.match(/\?/g) || []).length;
    const exclamations = (plainText.match(/!/g) || []).length;

    // Calculate reading time (average reading speed: 200-250 wpm)
    const readingMinutes = Math.ceil(wordCount / 225);
    const readingTime =
      readingMinutes <= 1
        ? "about a minute"
        : `about ${readingMinutes} minutes`;

    // Display statistics
    const content =
      `{bold}Statistics for "${thought.title}"{/bold}\n\n` +
      `Word count: ${wordCount}\n` +
      `Character count: ${charCount}\n` +
      `Line count: ${lineCount}\n` +
      `\n{blue-fg}Punctuation:{/blue-fg}\n` +
      `Periods: ${periods}\n` +
      `Commas: ${commas}\n` +
      `Question marks: ${questions}\n` +
      `Exclamation marks: ${exclamations}\n` +
      `\nEstimated reading time: ${readingTime}`;

    this.showInfoMessage(content, null, {
      width: "60%",
      tags: true,
      align: "left",
    });
  }

  /**
   * Export a thought as HTML
   * @param {Object} thought - The thought to export
   */
  exportAsHtml(thought) {
    // Convert markdown to HTML using marked
    const htmlContent = marked(thought.content);

    // Create a simple HTML document
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${thought.title}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    h1, h2, h3, h4, h5, h6 {
      color: #111;
    }
    pre {
      background-color: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
    }
    code {
      background-color: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
    }
    blockquote {
      border-left: 4px solid #ddd;
      padding-left: 16px;
      margin-left: 0;
      color: #666;
    }
    a {
      color: #0366d6;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .metadata {
      color: #666;
      font-size: 0.9em;
      border-bottom: 1px solid #eee;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <header>
    <h1>${thought.title}</h1>
    <div class="metadata">
      ${format(thought.date, "MMMM d, yyyy")} · Exported from Thoughts CLI
    </div>
  </header>
  ${htmlContent}
  <footer>
    <hr>
    <p><em>Exported from Thoughts CLI on ${format(new Date(), "MMMM d, yyyy")}</em></p>
  </footer>
</body>
</html>`;

    // Create filename based on the thought title
    const sanitizedTitle = thought.title
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();
    const exportPath = path.join(this.thoughtsDir, `${sanitizedTitle}.html`);

    // Save the file
    fs.writeFile(exportPath, html)
      .then(() => {
        this.showSuccessMessage(`Thought exported as HTML to:\n${exportPath}`);
      })
      .catch((err) => {
        this.showErrorMessage(`Error exporting as HTML: ${err.message}`);
      });
  }

  /**
   * Delete a thought after confirmation
   * @param {Object} thought - The thought to delete
   */
  deleteThought(thought) {
    const confirmMessage = `Are you sure you want to delete "${thought.title}"?\nThis action cannot be undone.`;

    this.showConfirmDialog(confirmMessage, async (err, confirmed) => {
      if (err || !confirmed) {
        this.listBox.focus();
        return;
      }

      try {
        // Delete the file
        await fs.unlink(thought.path);

        // Reload thoughts
        await this.loadThoughts();
        this.extractTodos();

        // Update the list
        this.selectedIndex = Math.min(
          this.selectedIndex,
          this.thoughts.length - 1,
        );
        this.filterThoughts();

        this.showSuccessMessage(`"${thought.title}" has been deleted.`);
      } catch (err) {
        this.showErrorMessage(`Error deleting thought: ${err.message}`);
      }
    });
  }

  /**
   * Show all TODOs across all thoughts
   */
  showAllTodos() {
    if (this.todos.length === 0) {
      this.showInfoMessage("No TODOs found across all thoughts", null, {
        width: "40%",
      });
      return;
    }

    // Clear previous items
    this.todoBox.clearItems();

    // Add todos to the list with thought information
    this.todos.forEach((todo) => {
      const status = todo.completed ? "[x]" : "[ ]";
      const todoText = `${status} ${todo.text} {gray-fg}(${todo.sourceThought}){/gray-fg}`;
      this.todoBox.addItem(todoText);
    });

    // Show and focus the todo box
    this.todoBox.setLabel(` All TODOs (${this.todos.length}) `);
    this.todoBox.show();
    this.todoBox.focus();
    this.todoBox.select(0);
    this.screen.render();
  }
}

/**
 * Start the TUI with the given thoughts directory
 * @param {string} thoughtsDir - Path to the thoughts directory
 */
export async function startTUI(thoughtsDir) {
  try {
    const tui = new ThoughtsTUI(thoughtsDir);
    await tui.init();
  } catch (error) {
    console.error(`Error starting TUI: ${error.message}`);
    process.exit(1);
  }
}
