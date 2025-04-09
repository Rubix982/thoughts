import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import slugify from "slugify";
import chalk from "chalk";

/**
 * @typedef {Object} TodoItem
 * @property {string} id - Unique identifier
 * @property {string} title - Todo title
 * @property {string} description - Longer description
 * @property {'high'|'low'} priority - Priority level
 * @property {'urgent'|'not-urgent'} urgency - Urgency level
 * @property {boolean} completed - Completion status
 * @property {string} createdAt - Creation timestamp
 * @property {string|null} completedAt - Completion timestamp
 * @property {string[]} tags - Associated tags
 * @property {string[]} links - Associated links/references
 * @property {Object} metadata - Additional metadata
 */

/**
 * @typedef {Object} TodoMatrix
 * @property {TodoItem[]} important_urgent - Important and urgent todos
 * @property {TodoItem[]} important_not_urgent - Important but not urgent todos
 * @property {TodoItem[]} not_important_urgent - Not important but urgent todos
 * @property {TodoItem[]} not_important_not_urgent - Neither important nor urgent todos
 * @property {Object} stats - Statistics about todos
 * @property {string} lastUpdated - Last update timestamp
 */

/**
 * Get the quadrant key for a todo based on priority and urgency
 * @param {TodoItem} todo - Todo item
 * @returns {string} Quadrant key
 */
export function getQuadrantKey(todo) {
  const isImportant = todo.priority === "high";
  const isUrgent = todo.urgency === "urgent";

  if (isImportant && isUrgent) return "important_urgent";
  if (isImportant && !isUrgent) return "important_not_urgent";
  if (!isImportant && isUrgent) return "not_important_urgent";
  return "not_important_not_urgent";
}

/**
 * Get color for a quadrant
 * @param {string} quadrant - Quadrant key
 * @returns {Function} Chalk color function
 */
export function getQuadrantColor(quadrant) {
  switch (quadrant) {
    case "important_urgent":
      return chalk.red;
    case "important_not_urgent":
      return chalk.blue;
    case "not_important_urgent":
      return chalk.yellow;
    case "not_important_not_urgent":
      return chalk.green;
    default:
      return chalk.white;
  }
}

/**
 * Get human-readable name for a quadrant
 * @param {string} quadrant - Quadrant key
 * @returns {string} Human-readable name
 */
export function getQuadrantName(quadrant) {
  switch (quadrant) {
    case "important_urgent":
      return "Important & Urgent";
    case "important_not_urgent":
      return "Important, Not Urgent";
    case "not_important_urgent":
      return "Urgent, Not Important";
    case "not_important_not_urgent":
      return "Neither Urgent nor Important";
    default:
      return quadrant;
  }
}

/**
 * Create a new todo item
 * @param {string} title - Todo title
 * @param {Object} options - Todo options
 * @returns {TodoItem} New todo item
 */
export function createTodo(title, options = {}) {
  const now = new Date().toISOString();

  return {
    id: options.id || uuidv4(),
    title: title.trim(),
    description: options.description || "",
    priority: options.priority || "low",
    urgency: options.urgency || "not-urgent",
    completed: options.completed || false,
    createdAt: options.createdAt || now,
    completedAt: options.completedAt || null,
    tags: options.tags || [],
    links: options.links || [],
    metadata: options.metadata || {},
  };
}

/**
 * Load todo matrix from file
 * @param {string} thoughtsDir - Base directory
 * @returns {Promise<TodoMatrix>} Loaded todo matrix
 */
export async function loadTodoMatrix(thoughtsDir) {
  const todosDir = path.join(thoughtsDir, ".todos");
  const todoFile = path.join(todosDir, "todo-matrix.json");

  await fs.ensureDir(todosDir);

  // Default empty structure
  const defaultMatrix = {
    important_urgent: [],
    important_not_urgent: [],
    not_important_urgent: [],
    not_important_not_urgent: [],
    stats: {
      total: 0,
      completed: 0,
      active: 0,
    },
    lastUpdated: new Date().toISOString(),
  };

  try {
    if (await fs.pathExists(todoFile)) {
      const matrix = JSON.parse(await fs.readFile(todoFile, "utf8"));
      return matrix;
    }
  } catch (error) {
    console.warn("Error loading todo matrix, creating new one:", error.message);
  }

  // Create a new file
  await fs.writeFile(todoFile, JSON.stringify(defaultMatrix, null, 2));
  return defaultMatrix;
}

/**
 * Save todo matrix to file
 * @param {string} thoughtsDir - Base directory
 * @param {TodoMatrix} matrix - Todo matrix to save
 * @returns {Promise<void>}
 */
export async function saveTodoMatrix(thoughtsDir, matrix) {
  const todosDir = path.join(thoughtsDir, ".todos");
  const todoFile = path.join(todosDir, "todo-matrix.json");

  await fs.ensureDir(todosDir);

  // Update statistics
  const allTodos = [
    ...matrix.important_urgent,
    ...matrix.important_not_urgent,
    ...matrix.not_important_urgent,
    ...matrix.not_important_not_urgent,
  ];

  matrix.stats = {
    total: allTodos.length,
    completed: allTodos.filter((todo) => todo.completed).length,
    active: allTodos.filter((todo) => !todo.completed).length,
  };

  matrix.lastUpdated = new Date().toISOString();

  await fs.writeFile(todoFile, JSON.stringify(matrix, null, 2));
}

/**
 * Add a todo to the matrix
 * @param {string} thoughtsDir - Base directory
 * @param {TodoItem} todo - Todo to add
 * @returns {Promise<TodoMatrix>} Updated matrix
 */
export async function addTodo(thoughtsDir, todo) {
  const matrix = await loadTodoMatrix(thoughtsDir);
  const quadrant = getQuadrantKey(todo);

  matrix[quadrant].push(todo);

  await saveTodoMatrix(thoughtsDir, matrix);
  return matrix;
}

/**
 * Update a todo in the matrix
 * @param {string} thoughtsDir - Base directory
 * @param {string} todoId - ID of todo to update (can be UUID or user-friendly ID like A1, B2)
 * @param {Object} updates - Updates to apply
 * @returns {Promise<TodoMatrix>} Updated matrix
 */
export async function updateTodo(thoughtsDir, todoId, updates) {
  const matrix = await loadTodoMatrix(thoughtsDir);
  let found = false;
  
  // Resolve user-friendly ID if needed
  if (isUserFriendlyId(todoId)) {
    const uuid = resolveUserFriendlyId(matrix, todoId);
    if (uuid) {
      todoId = uuid;
    } else {
      throw new Error(`Todo with ID ${todoId} not found`);
    }
  }

  // Helper to update todo in a quadrant
  const updateInQuadrant = (quadrant) => {
    const index = matrix[quadrant].findIndex((t) => t.id === todoId);
    if (index !== -1) {
      const oldTodo = matrix[quadrant][index];
      const updatedTodo = { ...oldTodo, ...updates };

      // Handle completion
      if (updates.completed === true && !oldTodo.completed) {
        updatedTodo.completedAt = new Date().toISOString();
      } else if (updates.completed === false) {
        updatedTodo.completedAt = null;
      }

      // Check if priority/urgency changed, which affects quadrant
      const newQuadrant = getQuadrantKey(updatedTodo);

      if (newQuadrant !== quadrant) {
        // Remove from old quadrant
        matrix[quadrant].splice(index, 1);
        // Add to new quadrant
        matrix[newQuadrant].push(updatedTodo);
      } else {
        // Update in same quadrant
        matrix[quadrant][index] = updatedTodo;
      }

      found = true;
    }
  };

  // Check all quadrants
  updateInQuadrant("important_urgent");
  updateInQuadrant("important_not_urgent");
  updateInQuadrant("not_important_urgent");
  updateInQuadrant("not_important_not_urgent");

  if (!found) {
    throw new Error(`Todo with ID ${todoId} not found`);
  }

  await saveTodoMatrix(thoughtsDir, matrix);
  return matrix;
}

/**
 * Toggle completion status of a todo
 * @param {string} thoughtsDir - Base directory
 * @param {string} todoId - ID of todo to toggle (can be UUID or user-friendly ID like A1, B2)
 * @returns {Promise<TodoMatrix>} Updated matrix
 */
export async function toggleTodo(thoughtsDir, todoId) {
  const matrix = await loadTodoMatrix(thoughtsDir);
  let found = false;
  
  // Resolve user-friendly ID if needed
  if (isUserFriendlyId(todoId)) {
    const uuid = resolveUserFriendlyId(matrix, todoId);
    if (uuid) {
      todoId = uuid;
    } else {
      throw new Error(`Todo with ID ${todoId} not found`);
    }
  }

  const toggleInQuadrant = (quadrant) => {
    const index = matrix[quadrant].findIndex((t) => t.id === todoId);
    if (index !== -1) {
      const todo = matrix[quadrant][index];
      todo.completed = !todo.completed;

      if (todo.completed) {
        todo.completedAt = new Date().toISOString();
      } else {
        todo.completedAt = null;
      }

      found = true;
    }
  };

  // Check all quadrants
  toggleInQuadrant("important_urgent");
  toggleInQuadrant("important_not_urgent");
  toggleInQuadrant("not_important_urgent");
  toggleInQuadrant("not_important_not_urgent");

  if (!found) {
    throw new Error(`Todo with ID ${todoId} not found`);
  }

  await saveTodoMatrix(thoughtsDir, matrix);
  return matrix;
}

/**
 * Delete a todo from the matrix
 * @param {string} thoughtsDir - Base directory
 * @param {string} todoId - ID of todo to delete (can be UUID or user-friendly ID like A1, B2)
 * @returns {Promise<TodoMatrix>} Updated matrix
 */
export async function deleteTodo(thoughtsDir, todoId) {
  const matrix = await loadTodoMatrix(thoughtsDir);
  let found = false;
  
  // Resolve user-friendly ID if needed
  if (isUserFriendlyId(todoId)) {
    const uuid = resolveUserFriendlyId(matrix, todoId);
    if (uuid) {
      todoId = uuid;
    } else {
      throw new Error(`Todo with ID ${todoId} not found`);
    }
  }

  const deleteFromQuadrant = (quadrant) => {
    const index = matrix[quadrant].findIndex((t) => t.id === todoId);
    if (index !== -1) {
      matrix[quadrant].splice(index, 1);
      found = true;
    }
  };

  // Check all quadrants
  deleteFromQuadrant("important_urgent");
  deleteFromQuadrant("important_not_urgent");
  deleteFromQuadrant("not_important_urgent");
  deleteFromQuadrant("not_important_not_urgent");

  if (!found) {
    throw new Error(`Todo with ID ${todoId} not found`);
  }

  await saveTodoMatrix(thoughtsDir, matrix);
  return matrix;
}

/**
 * Check if a string is a user-friendly ID (e.g., "A1", "B2", "C3")
 * @param {string} id - ID to check
 * @returns {boolean} True if id matches user-friendly format
 */
export function isUserFriendlyId(id) {
  return /^[A-D]\d+$/i.test(id);
}

/**
 * Get the mapping from quadrant prefix to quadrant key and vice versa
 */
export const QUADRANT_PREFIX_MAP = {
  'important_urgent': 'A',       // Important & Urgent
  'important_not_urgent': 'B',   // Important, Not Urgent
  'not_important_urgent': 'C',   // Not Important, Urgent
  'not_important_not_urgent': 'D' // Not Important, Not Urgent
};

export const QUADRANT_KEY_MAP = {
  'A': 'important_urgent',
  'B': 'important_not_urgent',
  'C': 'not_important_urgent',
  'D': 'not_important_not_urgent'
};

/**
 * Generate a user-friendly display ID for a todo based on its position in the matrix
 * @param {object} matrix - The todo matrix
 * @param {TodoItem} todo - The todo item
 * @returns {string} A user-friendly ID like "A1", "B2", etc.
 */
export function generateDisplayId(matrix, todo) {
  const quadrant = getQuadrantKey(todo);
  const prefix = QUADRANT_PREFIX_MAP[quadrant];
  
  if (!prefix) return todo.id.substring(0, 8); // Fallback to UUID prefix
  
  const position = matrix[quadrant].findIndex(t => t.id === todo.id);
  return position !== -1 ? `${prefix}${position + 1}` : todo.id.substring(0, 8);
}

/**
 * Resolve a user-friendly ID to the actual todo UUID
 * @param {object} matrix - Todo matrix
 * @param {string} userFriendlyId - User-friendly ID (e.g., "A1", "B2")
 * @returns {string|null} UUID if found, null otherwise
 */
export function resolveUserFriendlyId(matrix, userFriendlyId) {
  // Normalize to uppercase
  userFriendlyId = userFriendlyId.toUpperCase();
  
  // Extract the quadrant prefix and index
  const prefix = userFriendlyId.charAt(0);
  const index = parseInt(userFriendlyId.substring(1), 10) - 1; // Convert to 0-based index
  
  if (index < 0) return null;
  
  const quadrant = QUADRANT_KEY_MAP[prefix];
  if (!quadrant || !matrix[quadrant]) return null;
  
  // Get the UUID from the matrix using the index
  if (index >= matrix[quadrant].length) return null;
  
  return matrix[quadrant][index].id;
}

/**
 * Get a specific todo by ID
 * @param {string} thoughtsDir - Base directory
 * @param {string} todoId - ID of todo to find (can be UUID or user-friendly ID)
 * @returns {Promise<TodoItem|null>} Found todo or null
 */
export async function getTodoById(thoughtsDir, todoId) {
  const matrix = await loadTodoMatrix(thoughtsDir);

  // Check if todoId is a user-friendly ID (e.g., "A1", "B2")
  if (isUserFriendlyId(todoId)) {
    const uuid = resolveUserFriendlyId(matrix, todoId);
    if (uuid) {
      todoId = uuid;
    }
  }

  for (const quadrant of Object.keys(matrix)) {
    if (quadrant === "stats" || quadrant === "lastUpdated") continue;

    const todo = matrix[quadrant].find((t) => t.id === todoId);
    if (todo) return todo;
  }

  return null;
}

/**
 * Get all active (non-completed) todos
 * @param {string} thoughtsDir - Base directory
 * @returns {Promise<{matrix: TodoMatrix, todos: TodoItem[]}>} Matrix and active todos
 */
export async function getActiveTodos(thoughtsDir) {
  const matrix = await loadTodoMatrix(thoughtsDir);
  const activeTodos = [];

  for (const quadrant of Object.keys(matrix)) {
    if (quadrant === "stats" || quadrant === "lastUpdated") continue;

    const activeTodosInQuadrant = matrix[quadrant].filter(
      (todo) => !todo.completed,
    );
    activeTodos.push(...activeTodosInQuadrant);
  }

  return { matrix, todos: activeTodos };
}

/**
 * Search todos by text, tags, or completion status
 * @param {string} thoughtsDir - Base directory
 * @param {Object} searchOptions - Search options
 * @returns {Promise<TodoItem[]>} Matching todos
 */
export async function searchTodos(thoughtsDir, searchOptions = {}) {
  const matrix = await loadTodoMatrix(thoughtsDir);
  let results = [];

  for (const quadrant of Object.keys(matrix)) {
    if (quadrant === "stats" || quadrant === "lastUpdated") continue;

    const todosInQuadrant = matrix[quadrant];
    results.push(...todosInQuadrant);
  }

  // Filter by text
  if (searchOptions.text) {
    const searchText = searchOptions.text.toLowerCase();
    results = results.filter(
      (todo) =>
        todo.title.toLowerCase().includes(searchText) ||
        todo.description.toLowerCase().includes(searchText),
    );
  }

  // Filter by tags
  if (searchOptions.tags && searchOptions.tags.length > 0) {
    results = results.filter((todo) =>
      searchOptions.tags.some((tag) => todo.tags.includes(tag)),
    );
  }

  // Filter by completion status
  if (searchOptions.completed !== undefined) {
    results = results.filter(
      (todo) => todo.completed === searchOptions.completed,
    );
  }

  // Filter by priority
  if (searchOptions.priority) {
    results = results.filter(
      (todo) => todo.priority === searchOptions.priority,
    );
  }

  // Filter by urgency
  if (searchOptions.urgency) {
    results = results.filter((todo) => todo.urgency === searchOptions.urgency);
  }

  return results;
}

/**
 * Generate a thought from a todo item
 * @param {string} thoughtsDir - Base directory
 * @param {string} todoId - ID of todo to convert (can be UUID or user-friendly ID like A1, B2)
 * @returns {Promise<string>} Path to created thought
 */
export async function todoToThought(thoughtsDir, todoId) {
  const todo = await getTodoById(thoughtsDir, todoId);

  if (!todo) {
    throw new Error(`Todo with ID ${todoId} not found`);
  }

  // Create thought filename
  const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
  const safeTitle = slugify(todo.title, { lower: true, strict: true });
  const filename = `${timestamp}-${safeTitle}.md`;
  const filepath = path.join(thoughtsDir, filename);

  // Create thought content
  let content = `# ${todo.title}\n\n`;

  // Add metadata
  content += `> Priority: ${todo.priority === "high" ? "High" : "Low"}\n`;
  content += `> Urgency: ${todo.urgency === "urgent" ? "Urgent" : "Not Urgent"}\n`;

  if (todo.tags.length > 0) {
    content += `> Tags: ${todo.tags.join(", ")}\n`;
  }

  content += `> Created: ${new Date(todo.createdAt).toLocaleString()}\n\n`;

  // Add description
  if (todo.description) {
    content += `${todo.description}\n\n`;
  }

  // Add links
  if (todo.links && todo.links.length > 0) {
    content += "## Links & References\n\n";
    for (const link of todo.links) {
      content += `- ${link}\n`;
    }
    content += "\n";
  }

  // Save thought file
  await fs.writeFile(filepath, content);

  return filepath;
}

/**
 * Create a todo from an existing thought
 * @param {string} thoughtsDir - Base directory
 * @param {string} thoughtPath - Path to thought file
 * @param {Object} todoOptions - Todo options
 * @returns {Promise<TodoItem>} Created todo
 */
export async function thoughtToTodo(
  thoughtsDir,
  thoughtPath,
  todoOptions = {},
) {
  const content = await fs.readFile(thoughtPath, "utf8");
  const lines = content.split("\n");

  // Extract title from first line (assumes markdown # heading)
  const titleMatch = lines[0].match(/^#\s+(.*)/);
  const title = titleMatch ? titleMatch[1] : path.basename(thoughtPath, ".md");

  // Extract priority/urgency from metadata lines if present
  const priorityMatch = content.match(/>\s*Priority:\s*(.*)/i);
  const urgencyMatch = content.match(/>\s*Urgency:\s*(.*)/i);
  const tagsMatch = content.match(/>\s*Tags:\s*(.*)/i);

  // Create todo options
  const options = {
    ...todoOptions,
    priority:
      priorityMatch && priorityMatch[1].toLowerCase().includes("high")
        ? "high"
        : "low",
    urgency:
      urgencyMatch && urgencyMatch[1].toLowerCase().includes("urgent")
        ? "urgent"
        : "not-urgent",
    tags: tagsMatch ? tagsMatch[1].split(",").map((t) => t.trim()) : [],
    description: extractDescription(content),
    links: extractLinks(content),
  };

  // Create the todo
  const todo = createTodo(title, options);

  // Add to matrix
  await addTodo(thoughtsDir, todo);

  return todo;
}

/**
 * Extract description from thought content
 * @param {string} content - Thought content
 * @returns {string} Extracted description
 */
function extractDescription(content) {
  // Simple extraction - takes content between metadata and first heading
  const lines = content.split("\n");

  let startLine = 0;
  let endLine = lines.length;

  // Find end of metadata
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(">")) {
      startLine = i;
    } else if (startLine > 0 && lines[i].trim() === "") {
      startLine = i;
      break;
    }
  }

  // Find next heading
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].startsWith("#")) {
      endLine = i;
      break;
    }
  }

  // Extract description
  return lines
    .slice(startLine + 1, endLine)
    .join("\n")
    .trim();
}

/**
 * Extract links from thought content
 * @param {string} content - Thought content
 * @returns {string[]} Extracted links
 */
function extractLinks(content) {
  // Extract markdown links
  const links = [];
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;

  while ((match = markdownLinkRegex.exec(content)) !== null) {
    links.push(`${match[1]}: ${match[2]}`);
  }

  // Also look for URLs
  const urlRegex = /(?<!\()(https?:\/\/[^\s)]+)/g;
  while ((match = urlRegex.exec(content)) !== null) {
    // Only add if not already part of a markdown link
    if (!links.some((link) => link.includes(match[1]))) {
      links.push(match[1]);
    }
  }

  return links;
}

