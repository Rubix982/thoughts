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

import * as todoMatrix from "../lib/todo-matrix.js";
import path from "path";
import chalk from "chalk";

const DEFAULT_DIR = process.env.HOME || process.env.USERPROFILE;
const THOUGHTS_DIR = path.join(DEFAULT_DIR, "thoughts");

async function testFriendlyIDs() {
  try {
    // First, list the todos with their friendly IDs
    const matrix = await todoMatrix.loadTodoMatrix(THOUGHTS_DIR);

    console.log(chalk.bold("Testing user-friendly IDs:"));
    console.log("------------------------------");

    // Display todos from each quadrant
    for (const quadrant of [
      "important_urgent",
      "important_not_urgent",
      "not_important_urgent",
      "not_important_not_urgent",
    ]) {
      const todos = matrix[quadrant] || [];

      if (todos.length === 0) continue;

      console.log(chalk.bold(`\n${todoMatrix.getQuadrantName(quadrant)}:`));

      todos.forEach((todo, i) => {
        const displayId = todoMatrix.generateDisplayId(matrix, todo);
        const status = todo.completed ? "✓" : "☐";
        const titleText = todo.completed ? chalk.gray(todo.title) : todo.title;

        console.log(
          `${i + 1}. ${chalk.bold(displayId)}: [${status}] ${titleText} (${todo.id.substring(0, 8)}...)`,
        );
      });
    }

    // If there's at least one todo, let's try toggling it with a friendly ID
    let testToggleId = null;

    // Find first todo in any quadrant to test
    for (const quadrant of [
      "important_urgent",
      "important_not_urgent",
      "not_important_urgent",
      "not_important_not_urgent",
    ]) {
      if (matrix[quadrant] && matrix[quadrant].length > 0) {
        const todo = matrix[quadrant][0];
        testToggleId = todoMatrix.generateDisplayId(matrix, todo);
        break;
      }
    }

    if (testToggleId) {
      console.log(
        chalk.bold(`\nTesting toggle with friendly ID: ${testToggleId}`),
      );

      // Get original status
      const originalTodo = await todoMatrix.getTodoById(
        THOUGHTS_DIR,
        testToggleId,
      );
      const originalStatus = originalTodo.completed;

      console.log(
        `Original status: ${originalStatus ? "Completed" : "Active"}`,
      );

      // Toggle the todo
      await todoMatrix.toggleTodo(THOUGHTS_DIR, testToggleId);

      // Get new status
      const updatedTodo = await todoMatrix.getTodoById(
        THOUGHTS_DIR,
        originalTodo.id,
      );
      const newStatus = updatedTodo.completed;

      console.log(`New status: ${newStatus ? "Completed" : "Active"}`);

      // Toggle back to original state
      await todoMatrix.toggleTodo(THOUGHTS_DIR, testToggleId);

      if (originalStatus !== newStatus) {
        console.log(chalk.green("✓ Toggle with friendly ID works!"));
      } else {
        console.log(chalk.red("✗ Toggle with friendly ID failed!"));
      }
    } else {
      console.log(
        chalk.yellow("No todos available to test toggle functionality."),
      );
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error.message}`));
    console.error(error.stack);
  }
}

// Run the test
testFriendlyIDs();

