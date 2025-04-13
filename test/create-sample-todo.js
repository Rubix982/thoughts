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
import { promises as fs } from "fs";

const DEFAULT_DIR = process.env.HOME || process.env.USERPROFILE;
const THOUGHTS_DIR = path.join(DEFAULT_DIR, "thoughts");

async function createSampleTodos() {
  try {
    // Ensure the thoughts directory exists
    await fs.mkdir(path.join(THOUGHTS_DIR, ".todos"), { recursive: true });

    // Create sample todos for each quadrant
    const todos = [
      {
        title: "Important & Urgent Test Todo",
        priority: "high",
        urgency: "urgent",
        description: "This is a test todo in the Important & Urgent quadrant",
      },
      {
        title: "Important, Not Urgent Test Todo",
        priority: "high",
        urgency: "not-urgent",
        description:
          "This is a test todo in the Important, Not Urgent quadrant",
      },
      {
        title: "Not Important, Urgent Test Todo",
        priority: "low",
        urgency: "urgent",
        description:
          "This is a test todo in the Not Important, Urgent quadrant",
      },
      {
        title: "Not Important, Not Urgent Test Todo",
        priority: "low",
        urgency: "not-urgent",
        description:
          "This is a test todo in the Not Important, Not Urgent quadrant",
      },
    ];

    // Add each todo
    for (const todoData of todos) {
      const todo = todoMatrix.createTodo(todoData.title, {
        priority: todoData.priority,
        urgency: todoData.urgency,
        description: todoData.description,
        tags: ["test"],
      });

      await todoMatrix.addTodo(THOUGHTS_DIR, todo);
      console.log(`Created todo: ${todoData.title}`);
    }

    console.log("All sample todos created successfully!");
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the function
createSampleTodos();

