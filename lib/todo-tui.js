import blessed from "blessed";
import { format } from "date-fns";
import * as todoMatrix from "./todo-matrix.js";

/**
 * Create the todo matrix TUI
 * @param {string} thoughtsDir - Base directory
 * @returns {Promise<void>}
 */
export async function startTodoTUI(thoughtsDir) {
  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: "Thoughts - Todo Matrix",
    cursor: {
      artificial: true,
      shape: "line",
      blink: true,
      color: "white",
    },
  });

  // Layout with 4 quadrants
  const grid = blessed.layout({
    parent: screen,
    top: 1,
    left: 0,
    width: "100%",
    height: "100%-2",
    layout: "grid",
    rows: 2,
    cols: 2,
  });

  // Create quadrant boxes
  const q1Box = getQuadrantBox("important_urgent", "Important & Urgent", "red");
  const q2Box = getQuadrantBox(
    "important_not_urgent",
    "Important, Not Urgent",
    "blue",
  );
  const q3Box = getQuadrantBox(
    "not_important_urgent",
    "Urgent, Not Important",
    "yellow",
  );
  const q4Box = getQuadrantBox(
    "not_important_not_urgent",
    "Neither Urgent nor Important",
    "green",
  );

  grid.append(q1Box);
  grid.append(q2Box);
  grid.append(q3Box);
  grid.append(q4Box);

  // Add header
  const header = blessed.text({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 1,
    content: " Thoughts - Eisenhower Todo Matrix",
    style: {
      bg: "blue",
      fg: "white",
      bold: true,
    },
  });

  // Add footer with commands
  const footer = blessed.text({
    parent: screen,
    bottom: 0,
    left: 0,
    width: "100%",
    height: 1,
    content:
      " a:add | d:delete | e:edit | t:toggle | v:view | T:to-thought | q:quit | /:search | ?:help | F1-F8:form navigation",
    style: {
      bg: "blue",
      fg: "white",
    },
  });

  // Setup event handlers
  // Track open dialogs to prevent accidental exits
  let openDialogs = 0;

  // Function to increment dialog count when opening a popup
  function openDialog() {
    openDialogs++;
  }

  // Function to decrement dialog count when closing a popup
  function closeDialog() {
    openDialogs = Math.max(0, openDialogs - 1);
  }

  // Only exit if there are no open dialogs
  screen.key(["escape", "q", "C-c"], (ch, key) => {
    if (openDialogs === 0 || (key.name === "c" && key.ctrl)) {
      process.exit(0);
    }
  });
  
  // Special handler for the enter key to view todos
  screen.key(["enter"], (ch, key) => {
    // Make sure we're not in a dialog
    if (openDialogs === 0 && activeBox && activeBox.selected !== undefined) {
      viewSelectedTodo();
      return false; // Don't propagate
    }
  });

  // Load data
  let matrix = await todoMatrix.loadTodoMatrix(thoughtsDir);
  let activeQuadrant = "important_urgent";
  let activeBox = q1Box;

  // Function to get box by quadrant
  function getBoxByQuadrant(quadrant) {
    switch (quadrant) {
      case "important_urgent":
        return q1Box;
      case "important_not_urgent":
        return q2Box;
      case "not_important_urgent":
        return q3Box;
      case "not_important_not_urgent":
        return q4Box;
      default:
        return q1Box;
    }
  }

  // Function to update all quadrants
  function updateAllQuadrants() {
    updateQuadrant("important_urgent", q1Box);
    updateQuadrant("important_not_urgent", q2Box);
    updateQuadrant("not_important_urgent", q3Box);
    updateQuadrant("not_important_not_urgent", q4Box);

    screen.render();
  }

  // Function to update a quadrant's content with short IDs
  function updateQuadrant(quadrant, box) {
    const todos = matrix[quadrant] || [];
    
    // Add a prefix for each quadrant to easily identify which quadrant a number belongs to
    const prefixMap = {
      'important_urgent': 'A',       // Important & Urgent (red)
      'important_not_urgent': 'B',   // Important, Not Urgent (blue)
      'not_important_urgent': 'C',   // Not Important, Urgent (yellow)
      'not_important_not_urgent': 'D' // Not Important, Not Urgent (green)
    };
    
    const prefix = prefixMap[quadrant];
    
    // Also store the mapping on the box object for easy reference
    box.todoIndexMap = [];
    
    const items = todos.map((todo, index) => {
      // Store mapping from display index to todo ID
      box.todoIndexMap[index] = todo.id;
      
      const completed = todo.completed ? "✓" : " ";
      const completedStyle = todo.completed ? "{gray-fg}" : "";
      const title =
        todo.title.length > 30
          ? todo.title.substring(0, 27) + "..."
          : todo.title;
      
      // Show a user-friendly ID like "A1", "B2", etc.
      const displayId = `${prefix}${index + 1}`;
      
      // Store display ID on the todo object itself for reference
      todo.displayId = displayId;

      return `${completedStyle}${displayId}. [${completed}] ${title}${todo.completed ? "{/gray-fg}" : ""}`;
    });

    box.setItems(items);
    box.setLabel(` ${todoMatrix.getQuadrantName(quadrant)} (${todos.length}) `);
  }

  // Function to handle item select
  function handleSelect(quadrant, box) {
    if (!matrix[quadrant] || matrix[quadrant].length === 0) return;

    const selectedIndex = box.selected;
    const todo = matrix[quadrant][selectedIndex];

    if (!todo) return;

    // Display todo details in a dialog
    showTodoDetails(todo);
  }

  // Use our simpler viewer implementation instead of the built-in behavior
  // This bypasses the original showTodoDetails function entirely and uses our new approach
  function selectTodo(quadrant, box) {
    if (!matrix[quadrant] || matrix[quadrant].length === 0) return;

    const selectedIndex = box.selected;
    if (selectedIndex === undefined) return;

    const todo = matrix[quadrant][selectedIndex];
    if (!todo) return;

    // Just directly view the todo using our simple message box
    // Instead of using handleSelect which calls showTodoDetails
    viewTodo(todo);
  }

  // Function to view a todo with the simple message box
  function viewTodo(todo) {
    // Get the user-friendly ID (or create one if not available)
    const displayId = todo.displayId || getDisplayIdForTodo(todo);
    
    const message = [
      `ID: ${displayId}`,
      `Title: ${todo.title}`,
      `Priority: ${todo.priority === "high" ? "High" : "Low"}`,
      `Urgency: ${todo.urgency === "urgent" ? "Urgent" : "Not Urgent"}`,
      `Status: ${todo.completed ? "Completed" : "Active"}`,
      todo.completedAt
        ? `Completed: ${format(new Date(todo.completedAt), "yyyy-MM-dd HH:mm:ss")}`
        : "",
      `Created: ${format(new Date(todo.createdAt), "yyyy-MM-dd HH:mm:ss")}`,
      todo.tags.length > 0 ? `Tags: ${todo.tags.join(", ")}` : "",
      todo.description ? `\nDescription:\n${todo.description}` : "",
      todo.links.length > 0
        ? `\nLinks:\n${todo.links.map((link, i) => `${i + 1}. ${link}`).join("\n")}`
        : "",
      "\nPress ESC key or click CLOSE button to close...",
    ]
      .filter(Boolean)
      .join("\n");

    showSimpleMessage(message, todo);
  }
  
  // Helper function to generate a display ID for a todo if it doesn't have one
  function getDisplayIdForTodo(todo) {
    // Figure out which quadrant and position this todo is in
    let quadrantKey = todoMatrix.getQuadrantKey(todo);
    const quadrantPrefix = {
      'important_urgent': 'A',       // Important & Urgent
      'important_not_urgent': 'B',   // Important, Not Urgent
      'not_important_urgent': 'C',   // Not Important, Urgent
      'not_important_not_urgent': 'D' // Not Important, Not Urgent
    }[quadrantKey];
    
    // Find the position of this todo in its quadrant
    const position = matrix[quadrantKey].findIndex(t => t.id === todo.id);
    
    // If found, return a display ID, otherwise just show the first 6 chars of the UUID
    return position !== -1 ? `${quadrantPrefix}${position + 1}` : todo.id.substring(0, 6);
  }

  // Add both "select" event and explicit "enter" key handling for reliability
  // Select event (triggered when pressing Enter on an item)
  q1Box.on("select", () => selectTodo("important_urgent", q1Box));
  q2Box.on("select", () => selectTodo("important_not_urgent", q2Box));
  q3Box.on("select", () => selectTodo("not_important_urgent", q3Box));
  q4Box.on("select", () => selectTodo("not_important_not_urgent", q4Box));
  
  // Also add explicit enter key handlers
  q1Box.key("enter", () => selectTodo("important_urgent", q1Box));
  q2Box.key("enter", () => selectTodo("important_not_urgent", q2Box));
  q3Box.key("enter", () => selectTodo("not_important_urgent", q3Box));
  q4Box.key("enter", () => selectTodo("not_important_not_urgent", q4Box));
  
  // Add double-click handlers as well
  q1Box.on("click", () => {
    if (q1Box.selected !== undefined) {
      const now = Date.now();
      if (q1Box._lastClickTime && now - q1Box._lastClickTime < 300) {
        // Double click detected
        selectTodo("important_urgent", q1Box);
      }
      q1Box._lastClickTime = now;
    }
  });
  
  q2Box.on("click", () => {
    if (q2Box.selected !== undefined) {
      const now = Date.now();
      if (q2Box._lastClickTime && now - q2Box._lastClickTime < 300) {
        // Double click detected
        selectTodo("important_not_urgent", q2Box);
      }
      q2Box._lastClickTime = now;
    }
  });
  
  q3Box.on("click", () => {
    if (q3Box.selected !== undefined) {
      const now = Date.now();
      if (q3Box._lastClickTime && now - q3Box._lastClickTime < 300) {
        // Double click detected
        selectTodo("not_important_urgent", q3Box);
      }
      q3Box._lastClickTime = now;
    }
  });
  
  q4Box.on("click", () => {
    if (q4Box.selected !== undefined) {
      const now = Date.now();
      if (q4Box._lastClickTime && now - q4Box._lastClickTime < 300) {
        // Double click detected
        selectTodo("not_important_not_urgent", q4Box);
      }
      q4Box._lastClickTime = now;
    }
  });

  // Set up focus handling
  q1Box.on("focus", () => {
    activeQuadrant = "important_urgent";
    activeBox = q1Box;
  });
  q2Box.on("focus", () => {
    activeQuadrant = "important_not_urgent";
    activeBox = q2Box;
  });
  q3Box.on("focus", () => {
    activeQuadrant = "not_important_urgent";
    activeBox = q3Box;
  });
  q4Box.on("focus", () => {
    activeQuadrant = "not_important_not_urgent";
    activeBox = q4Box;
  });

  // Key handlers for operations
  screen.key("a", () => showAddTodoForm());
  screen.key("e", () => showEditTodoForm());
  screen.key("d", () => showDeleteConfirmation());
  screen.key("t", () => toggleSelectedTodo());
  screen.key("v", () => viewSelectedTodo());
  screen.key("T", () => convertToThought());
  screen.key("/", () => showSearchPrompt());
  screen.key("?", () => showHelp());

  // Add a debug key handler to help diagnose key issues
  // This will show key names when F9 is pressed
  let keyDebugMode = false;
  
  screen.key(['f9'], () => {
    keyDebugMode = !keyDebugMode;
    showMessage(`Key debug mode: ${keyDebugMode ? 'ON' : 'OFF'}`);
    
    if (keyDebugMode) {
      footer.content = " Key debug mode ON - Press any key to see its name (F9 to toggle) ";
      screen.render();
      
      // Capture all keys and show their names
      const debugHandler = (ch, key) => {
        if (key.name === 'f9') return; // Don't show for F9 which toggles this mode
        
        const keyInfo = `Key: ${key.name}${key.ctrl ? ' (Ctrl)' : ''}${key.meta ? ' (Meta)' : ''}${key.shift ? ' (Shift)' : ''}`;
        showMessage(keyInfo, 1000);
      };
      
      // Store the handler on the screen object so we can remove it later
      screen._debugHandler = debugHandler;
      screen.on('keypress', debugHandler);
    } else {
      // Restore normal footer content
      footer.content = " a:add | d:delete | e:edit | t:toggle | v:view | T:to-thought | q:quit | /:search | ?:help | F1-F8:form navigation";
      screen.render();
      
      // Remove the debug handler
      if (screen._debugHandler) {
        screen.removeListener('keypress', screen._debugHandler);
      }
    }
  });
  
  // Initial update
  updateAllQuadrants();
  q1Box.focus();

  // Function to show todo details
  function showTodoDetails(todo) {
    // Track that we're opening a dialog
    openDialog();

    // Create a details popup
    const detailsBox = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "70%",
      height: "70%",
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: getQuadrantBorderColor(todo),
        },
      },
      keyable: true, // Make sure it can receive key events
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        style: {
          bg: "blue",
        },
      },
      // Add a label to make it more obvious this is a separate window
      label: " Todo Details (press q to close) ",
    });

    // Create content
    let content = `{bold}${todo.title}{/bold}\n\n`;
    content += `Priority: ${todo.priority === "high" ? "High" : "Low"}\n`;
    content += `Urgency: ${todo.urgency === "urgent" ? "Urgent" : "Not Urgent"}\n`;
    content += `Status: ${todo.completed ? "Completed" : "Active"}\n`;

    if (todo.completedAt) {
      content += `Completed: ${format(new Date(todo.completedAt), "yyyy-MM-dd HH:mm:ss")}\n`;
    }

    content += `Created: ${format(new Date(todo.createdAt), "yyyy-MM-dd HH:mm:ss")}\n`;

    if (todo.tags.length > 0) {
      content += `\nTags: ${todo.tags.join(", ")}\n`;
    }

    if (todo.description) {
      content += `\n{bold}Description:{/bold}\n${todo.description}\n`;
    }

    if (todo.links.length > 0) {
      content += `\n{bold}Links:{/bold}\n`;
      todo.links.forEach((link, i) => {
        content += `${i + 1}. ${link}\n`;
      });
    }

    // Add a close button
    const closeButton = blessed.button({
      parent: detailsBox,
      bottom: 1,
      left: "center",
      width: 10,
      height: 3,
      content: "Close",
      style: {
        bg: "blue",
        fg: "white",
        focus: {
          bg: "red",
        },
        hover: {
          bg: "red",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    closeButton.on("press", () => {
      screen.remove(detailsBox);
      closeDialog();
      screen.render();
    });

    // Add closing instructions to the content
    content += "\n\n{center}Press q or ESC to close this window{/center}";

    // Set content
    detailsBox.setContent(content);

    // Create explicit handlers for individual keys
    detailsBox.key("escape", () => {
      screen.remove(detailsBox);
      closeDialog();
      screen.render();
    });

    detailsBox.key("q", () => {
      screen.remove(detailsBox);
      closeDialog();
      screen.render();
    });

    // Also create a click handler for the box to make it easier to dismiss
    detailsBox.on("click", () => {
      // Add a message at the bottom of the box
      const helpText = "\n\n{center}Click again or press q to close{/center}";
      detailsBox.setContent(detailsBox.getContent() + helpText);
      screen.render();

      // Set a flag to close on next click
      detailsBox.once("click", () => {
        screen.remove(detailsBox);
        closeDialog();
        screen.render();
      });
    });

    screen.render();
  }

  // Function to add a new todo
  function showAddTodoForm() {
    // Track that we're opening a dialog
    openDialog();
    const form = blessed.form({
      parent: screen,
      top: "center",
      left: "center",
      width: 60,
      height: 20, // Increased height for taller input fields
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "blue",
        },
      },
    });

    // Add form fields
    blessed.text({
      parent: form,
      top: 0,
      left: 2,
      content: "Add New Todo (Type text, use Function keys to navigate)",
      style: {
        bold: true,
        fg: "yellow",
      },
    });

    // Add usage instructions
    blessed.text({
      parent: form,
      top: 1,
      left: 2,
      content:
        "F1: Priority | F3: Urgency | F5: Tags | F12: Submit | Space: Select",
      style: {
        fg: "white",
      },
    });

    blessed.text({
      parent: form,
      top: 3,
      left: 2,
      content: "Title:",
    });

    const titleInput = blessed.textbox({
      parent: form,
      top: 2,
      left: 10,
      width: 45,
      height: 3, // Increased height for better visibility
      inputOnFocus: true,
      border: {
        type: "line",
      },
      style: {
        focus: {
          border: {
            fg: "blue",
          },
        },
      },
      keys: true,
      mouse: true,
      censor: false,
      vi: true, // Enable vi-style editing
      multiline: false, // Disable multiline to avoid issues
    });

    blessed.text({
      parent: form,
      top: 6, // Adjusted for taller input field
      left: 2,
      content: "Priority:",
    });

    const priorityRadioHigh = blessed.radiobutton({
      parent: form,
      top: 6, // Adjusted for taller input field
      left: 12,
      content: "High",
      checked: false,
      style: {
        fg: "white",
        focus: {
          fg: "red", // Highlight with red when focused (for high priority)
          bold: true,
        },
      },
    });

    const priorityRadioLow = blessed.radiobutton({
      parent: form,
      top: 6, // Adjusted for taller input field
      left: 25,
      content: "Low",
      checked: true,
      style: {
        fg: "white",
        focus: {
          fg: "green", // Highlight with green when focused (for low priority)
          bold: true,
        },
      },
    });

    blessed.text({
      parent: form,
      top: 8, // Adjusted for taller input field
      left: 2,
      content: "Urgency:",
    });

    const urgencyRadioUrgent = blessed.radiobutton({
      parent: form,
      top: 8, // Adjusted for taller input field
      left: 12,
      content: "Urgent",
      checked: false,
      style: {
        fg: "white",
        focus: {
          fg: "yellow", // Highlight with yellow when focused (for urgent)
          bold: true,
        },
      },
    });

    const urgencyRadioNotUrgent = blessed.radiobutton({
      parent: form,
      top: 8, // Adjusted for taller input field
      left: 25,
      content: "Not Urgent",
      checked: true,
      style: {
        fg: "white",
        focus: {
          fg: "blue", // Highlight with blue when focused (for not urgent)
          bold: true,
        },
      },
    });

    blessed.text({
      parent: form,
      top: 11, // Adjusted for taller input field
      left: 2,
      content: "Tags:",
    });

    const tagsInput = blessed.textbox({
      parent: form,
      top: 10, // Adjusted for taller input field
      left: 10,
      width: 45,
      height: 3, // Increased height for better visibility
      inputOnFocus: true,
      border: {
        type: "line",
      },
      style: {
        focus: {
          border: {
            fg: "blue",
          },
        },
      },
      keys: true,
      mouse: true,
      censor: false,
      vi: true, // Enable vi-style editing
      multiline: false, // Disable multiline to avoid issues
    });

    const submitButton = blessed.button({
      parent: form,
      top: 14,
      left: 10,
      width: 10,
      height: 3,
      content: "Submit",
      style: {
        bg: "blue",
        fg: "white",
        focus: {
          bg: "green",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    const cancelButton = blessed.button({
      parent: form,
      top: 14,
      left: 25,
      width: 10,
      height: 3,
      content: "Cancel",
      style: {
        bg: "red",
        fg: "white",
        focus: {
          bg: "red",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    // Event handlers
    submitButton.on("press", async () => {
      const title = titleInput.value;
      if (!title) {
        showMessage("Title is required");
        return;
      }

      const priority = priorityRadioHigh.checked ? "high" : "low";
      const urgency = urgencyRadioUrgent.checked ? "urgent" : "not-urgent";
      const tags = tagsInput.value
        ? tagsInput.value.split(",").map((t) => t.trim())
        : [];

      const todo = todoMatrix.createTodo(title, { priority, urgency, tags });
      matrix = await todoMatrix.addTodo(thoughtsDir, todo);

      updateAllQuadrants();
      screen.remove(form);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    cancelButton.on("press", () => {
      screen.remove(form);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    form.key(["escape"], () => {
      screen.remove(form);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    // Set up navigation using FUNCTION KEYS instead of tab
    // Use F1-F8 keys for navigation, which won't interfere with textbox content
    titleInput.key("f1", () => priorityRadioHigh.focus());
    priorityRadioHigh.key("f2", () => priorityRadioLow.focus());
    priorityRadioLow.key("f3", () => urgencyRadioUrgent.focus());
    urgencyRadioUrgent.key("f4", () => urgencyRadioNotUrgent.focus());
    urgencyRadioNotUrgent.key("f5", () => tagsInput.focus());
    tagsInput.key("f6", () => submitButton.focus());
    submitButton.key("f7", () => cancelButton.focus());
    cancelButton.key("f8", () => titleInput.focus());

    // Also add arrow key navigation for radio buttons
    priorityRadioHigh.key("right", () => priorityRadioLow.focus());
    priorityRadioLow.key("left", () => priorityRadioHigh.focus());
    urgencyRadioUrgent.key("right", () => urgencyRadioNotUrgent.focus());
    urgencyRadioNotUrgent.key("left", () => urgencyRadioUrgent.focus());

    // Add F12 shortcut to quickly submit from anywhere in the form
    form.key(["f12"], async () => {
      const title = titleInput.value;
      if (!title) {
        showMessage("Title is required");
        return;
      }

      const priority = priorityRadioHigh.checked ? "high" : "low";
      const urgency = urgencyRadioUrgent.checked ? "urgent" : "not-urgent";
      const tags = tagsInput.value
        ? tagsInput.value.split(",").map((t) => t.trim())
        : [];

      const todo = todoMatrix.createTodo(title, { priority, urgency, tags });
      matrix = await todoMatrix.addTodo(thoughtsDir, todo);

      updateAllQuadrants();
      screen.remove(form);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
      showMessage("Todo added successfully!", 1500);
    });

    titleInput.focus();
    screen.render();
  }

  // Function to edit a todo
  function showEditTodoForm() {
    if (!activeBox.selected) return;

    const selectedIndex = activeBox.selected;
    if (!matrix[activeQuadrant] || !matrix[activeQuadrant][selectedIndex])
      return;

    // Track that we're opening a dialog
    openDialog();

    const todo = matrix[activeQuadrant][selectedIndex];

    const form = blessed.form({
      parent: screen,
      top: "center",
      left: "center",
      width: 70,
      height: 24, // Increased height for taller input fields
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "blue",
        },
      },
    });

    // Add form fields
    blessed.text({
      parent: form,
      top: 0,
      left: 2,
      content: "Edit Todo",
      style: {
        bold: true,
      },
    });

    blessed.text({
      parent: form,
      top: 2,
      left: 2,
      content: "Title:",
    });

    const titleInput = blessed.textbox({
      parent: form,
      top: 2,
      left: 10,
      width: 55,
      height: 3, // Increased height for better visibility
      inputOnFocus: true,
      value: todo.title,
      border: {
        type: "line",
      },
      style: {
        fg: "white",
        bg: "black", // Explicit background color
        focus: {
          fg: "white",
          bg: "black", // Explicit background color
          border: {
            fg: "blue",
          },
        },
      },
      keys: true,
      mouse: true,
      censor: false,
      vi: true, // Enable vi-style editing
      multiline: false, // Disable multiline to avoid issues
    });

    blessed.text({
      parent: form,
      top: 4,
      left: 2,
      content: "Priority:",
    });

    const priorityRadioHigh = blessed.radiobutton({
      parent: form,
      top: 4,
      left: 12,
      content: "High",
      checked: todo.priority === "high",
      style: {
        fg: "white",
        bg: "black",
        focus: {
          fg: "red", // Highlight with red when focused (for high priority)
          bold: true,
        },
      },
    });

    const priorityRadioLow = blessed.radiobutton({
      parent: form,
      top: 4,
      left: 25,
      content: "Low",
      checked: todo.priority === "low",
      style: {
        fg: "white",
        bg: "black",
        focus: {
          fg: "green", // Highlight with green when focused (for low priority)
          bold: true,
        },
      },
    });

    blessed.text({
      parent: form,
      top: 6,
      left: 2,
      content: "Urgency:",
    });

    const urgencyRadioUrgent = blessed.radiobutton({
      parent: form,
      top: 6,
      left: 12,
      content: "Urgent",
      checked: todo.urgency === "urgent",
      style: {
        fg: "white",
        bg: "black",
        focus: {
          fg: "yellow", // Highlight with yellow when focused (for urgent)
          bold: true,
        },
      },
    });

    const urgencyRadioNotUrgent = blessed.radiobutton({
      parent: form,
      top: 6,
      left: 25,
      content: "Not Urgent",
      checked: todo.urgency === "not-urgent",
      style: {
        fg: "white",
        bg: "black",
        focus: {
          fg: "blue", // Highlight with blue when focused (for not urgent)
          bold: true,
        },
      },
    });

    blessed.text({
      parent: form,
      top: 8,
      left: 2,
      content: "Status:",
    });

    const statusCheckbox = blessed.checkbox({
      parent: form,
      top: 8,
      left: 12,
      content: "Completed",
      checked: todo.completed,
      style: {
        fg: "white",
        bg: "black",
        focus: {
          fg: "cyan", // Highlight with cyan when focused
          bold: true,
        },
      },
    });

    blessed.text({
      parent: form,
      top: 10,
      left: 2,
      content: "Tags:",
    });

    const tagsInput = blessed.textbox({
      parent: form,
      top: 10,
      left: 10,
      width: 55,
      height: 3, // Increased height for better visibility
      inputOnFocus: true,
      value: todo.tags.join(", "),
      border: {
        type: "line",
      },
      style: {
        fg: "white",
        bg: "black", // Explicit background color
        focus: {
          fg: "white",
          bg: "black", // Explicit background color
          border: {
            fg: "blue",
          },
        },
      },
      keys: true,
      mouse: true,
      censor: false,
      vi: true, // Enable vi-style editing
      multiline: false, // Disable multiline to avoid issues
    });

    blessed.text({
      parent: form,
      top: 14, // Adjusted for taller input field
      left: 2,
      content: "Description:",
    });

    const descriptionInput = blessed.textarea({
      parent: form,
      top: 15, // Adjusted for taller input field
      left: 2,
      width: 65,
      height: 3,
      inputOnFocus: true,
      value: todo.description,
      border: {
        type: "line",
      },
      style: {
        fg: "white",
        bg: "black", // Explicit background color
        focus: {
          fg: "white",
          bg: "black", // Explicit background color
          border: {
            fg: "blue",
          },
        },
      },
      keys: true,
      mouse: true,
      vi: true, // Enable vi-style editing
    });

    const submitButton = blessed.button({
      parent: form,
      top: 20, // Adjusted for taller input fields
      left: 20,
      width: 10,
      height: 1,
      content: "Submit",
      style: {
        bg: "blue",
        fg: "white",
        focus: {
          bg: "green",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    const cancelButton = blessed.button({
      parent: form,
      top: 20, // Adjusted for taller input fields
      left: 35,
      width: 10,
      height: 1,
      content: "Cancel",
      style: {
        bg: "red",
        fg: "white",
        focus: {
          bg: "red",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    // Event handlers
    submitButton.on("press", async () => {
      const title = titleInput.value;
      if (!title) {
        showMessage("Title is required");
        return;
      }

      const updates = {
        title,
        priority: priorityRadioHigh.checked ? "high" : "low",
        urgency: urgencyRadioUrgent.checked ? "urgent" : "not-urgent",
        completed: statusCheckbox.checked,
        tags: tagsInput.value
          ? tagsInput.value.split(",").map((t) => t.trim())
          : [],
        description: descriptionInput.value,
      };

      matrix = await todoMatrix.updateTodo(thoughtsDir, todo.id, updates);

      updateAllQuadrants();
      screen.remove(form);
      screen.render();
    });

    cancelButton.on("press", () => {
      screen.remove(form);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    form.key(["escape"], () => {
      screen.remove(form);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    // Set up navigation between fields
    titleInput.key("tab", () => priorityRadioHigh.focus());
    priorityRadioHigh.key("tab", () => priorityRadioLow.focus());
    priorityRadioLow.key("tab", () => urgencyRadioUrgent.focus());
    urgencyRadioUrgent.key("tab", () => urgencyRadioNotUrgent.focus());
    urgencyRadioNotUrgent.key("tab", () => statusCheckbox.focus());
    statusCheckbox.key("tab", () => tagsInput.focus());
    tagsInput.key("tab", () => descriptionInput.focus());
    descriptionInput.key("tab", () => submitButton.focus());
    submitButton.key("tab", () => cancelButton.focus());
    cancelButton.key("tab", () => titleInput.focus());

    titleInput.focus();
    screen.render();
  }

  // Function to delete a todo
  function showDeleteConfirmation() {
    if (!activeBox.selected) return;

    const selectedIndex = activeBox.selected;
    if (!matrix[activeQuadrant] || !matrix[activeQuadrant][selectedIndex])
      return;

    // Track that we're opening a dialog
    openDialog();

    const todo = matrix[activeQuadrant][selectedIndex];

    const confirmBox = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: 40,
      height: 7,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "red",
        },
      },
    });

    blessed.text({
      parent: confirmBox,
      top: 1,
      left: "center",
      content: "Delete Todo?",
      style: {
        bold: true,
      },
    });

    blessed.text({
      parent: confirmBox,
      top: 2,
      left: "center",
      content: `"${todo.title.substring(0, 25)}${todo.title.length > 25 ? "..." : ""}"`,
    });

    const yesButton = blessed.button({
      parent: confirmBox,
      top: 4,
      left: 8,
      width: 10,
      height: 1,
      content: "Yes",
      style: {
        bg: "red",
        fg: "white",
        focus: {
          bg: "green",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    const noButton = blessed.button({
      parent: confirmBox,
      top: 4,
      left: 22,
      width: 10,
      height: 1,
      content: "No",
      style: {
        bg: "blue",
        fg: "white",
        focus: {
          bg: "blue",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    yesButton.on("press", async () => {
      matrix = await todoMatrix.deleteTodo(thoughtsDir, todo.id);
      updateAllQuadrants();
      screen.remove(confirmBox);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    noButton.on("press", () => {
      screen.remove(confirmBox);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    confirmBox.key(["escape", "n", "q"], () => {
      screen.remove(confirmBox);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    confirmBox.key(["y"], async () => {
      matrix = await todoMatrix.deleteTodo(thoughtsDir, todo.id);
      updateAllQuadrants();
      screen.remove(confirmBox);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    noButton.focus();
    screen.render();
  }

  // Function to toggle a todo's completion status
  async function toggleSelectedTodo() {
    if (!activeBox.selected) return;

    const selectedIndex = activeBox.selected;
    if (!matrix[activeQuadrant] || !matrix[activeQuadrant][selectedIndex])
      return;

    const todo = matrix[activeQuadrant][selectedIndex];
    matrix = await todoMatrix.toggleTodo(thoughtsDir, todo.id);

    updateAllQuadrants();
  }

  // Function to view a selected todo - now just delegates to our common viewTodo function
  function viewSelectedTodo() {
    if (!activeBox.selected) return;

    const selectedIndex = activeBox.selected;
    if (!matrix[activeQuadrant] || !matrix[activeQuadrant][selectedIndex])
      return;

    const todo = matrix[activeQuadrant][selectedIndex];
    viewTodo(todo); // Use the shared function
  }

  // More reliable details box with explicit close mechanism
  function showSimpleMessage(message, todo) {
    // Track that we're opening a dialog
    openDialog();

    // Use a standard box instead of message since message may auto-close
    const detailsBox = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "80%",
      height: "80%",
      tags: true,
      content: message,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: getQuadrantBorderColor(
            todo || { priority: "low", urgency: "not-urgent" },
          ),
        },
      },
      scrollable: true,
      keys: true,
      vi: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        style: {
          bg: "blue",
        },
      },
      label: " Todo Details (press Escape to close) ",
    });

    // Add a close button
    const closeButton = blessed.button({
      parent: detailsBox,
      bottom: 2,
      left: "center",
      width: 12,
      height: 3,
      content: "CLOSE",
      tags: true,
      style: {
        bg: "blue",
        fg: "white",
        focus: {
          bg: "red",
          fg: "white",
          bold: true,
        },
        hover: {
          bg: "red",
        },
      },
      border: {
        type: "line",
      },
      mouse: true,
    });

    // Set up close handlers
    const closeDetails = () => {
      screen.remove(detailsBox);
      closeDialog();
      screen.render();
    };

    // Close when escape is pressed
    detailsBox.key(["escape"], closeDetails);

    // Close on button press
    closeButton.on("press", closeDetails);

    // Set initial focus on close button so it's obvious
    closeButton.focus();

    // Render the screen
    screen.render();
  }

  // Function to convert a todo to a thought
  async function convertToThought() {
    if (!activeBox.selected) return;

    const selectedIndex = activeBox.selected;
    if (!matrix[activeQuadrant] || !matrix[activeQuadrant][selectedIndex])
      return;

    const todo = matrix[activeQuadrant][selectedIndex];

    try {
      const filePath = await todoMatrix.todoToThought(thoughtsDir, todo.id);

      showMessage(`Created thought: ${filePath}`);
    } catch (error) {
      showMessage(`Error: ${error.message}`);
    }
  }

  // Function to search todos
  function showSearchPrompt() {
    // Track that we're opening a dialog
    openDialog();

    const prompt = blessed.prompt({
      parent: screen,
      top: "center",
      left: "center",
      width: 50,
      height: "shrink",
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "blue",
        },
      },
    });

    prompt.input("Search todos:", "", async (err, value) => {
      // Track that we're closing a dialog
      closeDialog();

      if (err || !value) return;

      try {
        const results = await todoMatrix.searchTodos(thoughtsDir, {
          text: value,
        });
        showSearchResults(value, results);
      } catch (error) {
        showMessage(`Error: ${error.message}`);
      }
    });
  }

  // Function to show search results
  function showSearchResults(query, results) {
    // Track that we're opening a dialog
    openDialog();

    const resultsBox = blessed.list({
      parent: screen,
      top: "center",
      left: "center",
      width: "80%",
      height: "80%",
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "blue",
        },
        selected: {
          bg: "blue",
          fg: "white",
        },
      },
      label: ` Search Results for "${query}" (${results.length}) `,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      items: results.map((todo) => {
        const quadrant = todoMatrix.getQuadrantKey(todo);
        const quadrantName = todoMatrix.getQuadrantName(quadrant);
        const completed = todo.completed ? "[✓]" : "[ ]";
        return `${completed} ${todo.title} (${quadrantName})`;
      }),
    });

    resultsBox.on("select", (item, index) => {
      if (index < results.length) {
        showTodoDetails(results[index]);
      }
    });

    resultsBox.key(["escape", "q"], () => {
      screen.remove(resultsBox);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    screen.render();
  }

  // Function to show help
  function showHelp() {
    // Track that we're opening a dialog
    openDialog();

    const helpBox = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: 60,
      height: 20,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "blue",
        },
      },
      label: " Help ",
      content: `
  {bold}Keyboard Shortcuts:{/bold}
    
  a       - Add a new todo
  e       - Edit selected todo
  d       - Delete selected todo
  t       - Toggle completion status
  v       - View todo details
  T       - Convert todo to a thought
  /       - Search todos
  ?       - Show this help
  q, Esc  - Quit

  {bold}Form Navigation:{/bold}
  
  F1-F8   - Navigate between form fields (NOT Tab key)
  F12     - SUBMIT FORM from anywhere (quickest way)
  Arrows  - Navigate between radio buttons
  Space   - Toggle radio button/checkbox selection
  Enter   - Activate focused button
  Esc     - Cancel / close form

  {bold}Form Usage Instructions:{/bold}
  
  1. Press 'a' to open the Add Todo form
  2. Type your title (text should appear as you type)
  3. EASIEST METHOD: Press F12 to submit with default options
  
  OR to customize priority/urgency:
  4. Press F1 to move to Priority options
  5. Use Space to select a radio button
  6. Press F3 to move to Urgency options
  7. Press F5 to move to Tags input
  8. Press F12 to submit

  {bold}Quadrants:{/bold}
  
  Red     - Important & Urgent
  Blue    - Important, Not Urgent
  Yellow  - Urgent, Not Important
  Green   - Neither Urgent nor Important
      `,
      scrollable: true,
    });

    helpBox.key(["escape", "q", "?"], () => {
      screen.remove(helpBox);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    });

    screen.render();
  }

  // Function to show a temporary message
  function showMessage(message, timeout = 2000) {
    // Track that we're opening a dialog
    openDialog();

    const msgBox = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: Math.max(20, message.length + 4),
      height: 3,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "yellow",
        },
      },
      content: message,
      align: "center",
      valign: "middle",
    });

    screen.render();

    setTimeout(() => {
      screen.remove(msgBox);
      // Track that we're closing a dialog
      closeDialog();
      screen.render();
    }, timeout);
  }

  // Helper function to get color for a todo item
  function getQuadrantBorderColor(todo) {
    // Determine the quadrant based on priority and urgency
    const isImportant = todo.priority === "high";
    const isUrgent = todo.urgency === "urgent";

    if (isImportant && isUrgent) return "red";
    if (isImportant && !isUrgent) return "blue";
    if (!isImportant && isUrgent) return "yellow";
    return "green";
  }

  // Helper function to create a quadrant box
  function getQuadrantBox(quadrant, title, color) {
    return blessed.list({
      width: "50%",
      height: "50%",
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: color,
        },
        selected: {
          bg: "blue",
          fg: "white",
        },
      },
      label: ` ${title} `,
      keys: true,
      input: true,   // Enable input explicitly
      keyable: true, // Ensure keyable attribute is set
      vi: true,
      mouse: true,
      scrollable: true,
      interactive: true, // Make sure it's interactive
      // Special options to ensure Enter key works
      enter: true,
      // Add note to inform about key press
      baseLabel: ` ${title} (Enter to view) `,
      // Also enable double click
      dblclick: true,
    });
  }

  // Start the interface
  screen.render();
}
