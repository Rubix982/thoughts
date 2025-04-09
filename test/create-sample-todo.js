#!/usr/bin/env node

import * as todoMatrix from '../lib/todo-matrix.js';
import path from 'path';
import { promises as fs } from 'fs';

const DEFAULT_DIR = process.env.HOME || process.env.USERPROFILE;
const THOUGHTS_DIR = path.join(DEFAULT_DIR, 'thoughts');

async function createSampleTodos() {
  try {
    // Ensure the thoughts directory exists
    await fs.mkdir(path.join(THOUGHTS_DIR, '.todos'), { recursive: true });
    
    // Create sample todos for each quadrant
    const todos = [
      {
        title: 'Important & Urgent Test Todo',
        priority: 'high',
        urgency: 'urgent',
        description: 'This is a test todo in the Important & Urgent quadrant'
      },
      {
        title: 'Important, Not Urgent Test Todo',
        priority: 'high',
        urgency: 'not-urgent',
        description: 'This is a test todo in the Important, Not Urgent quadrant'
      },
      {
        title: 'Not Important, Urgent Test Todo',
        priority: 'low',
        urgency: 'urgent',
        description: 'This is a test todo in the Not Important, Urgent quadrant'
      },
      {
        title: 'Not Important, Not Urgent Test Todo',
        priority: 'low',
        urgency: 'not-urgent',
        description: 'This is a test todo in the Not Important, Not Urgent quadrant'
      }
    ];
    
    // Add each todo
    for (const todoData of todos) {
      const todo = todoMatrix.createTodo(todoData.title, {
        priority: todoData.priority,
        urgency: todoData.urgency,
        description: todoData.description,
        tags: ['test']
      });
      
      await todoMatrix.addTodo(THOUGHTS_DIR, todo);
      console.log(`Created todo: ${todoData.title}`);
    }
    
    console.log('All sample todos created successfully!');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error(error.stack);
  }
}

// Run the function
createSampleTodos();