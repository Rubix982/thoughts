# Thoughts

A simple CLI utility for quickly capturing and searching thoughts in your terminal.

## Features

- Create notes quickly from your terminal
- Search through your thoughts with full-text search
- Filter thoughts by date ranges
- View recent thoughts with preview
- Open directly in your preferred editor
- Color-highlighted search results
- Clickable file paths (in supported terminals)

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Install globally:
   ```
   npm install -g .
   ```

## Usage

### Creating New Thoughts

Simply type `thoughts` or `thoughts new` in your terminal:

```
thoughts
```

You'll be prompted for a title, then your default editor will open.

### Searching Your Thoughts

Search for specific text in all your thoughts:

```
thoughts search "keyword"
```

Use fuzzy search for more flexible matching:

```
thoughts search "keywrd" --fuzzy             # Find "keyword" even with typos
thoughts search "meetnotes" --fuzzy          # Will find "meeting notes"
thoughts search --fuzzy --threshold 0.3      # Lower threshold = stricter matching
```

Search with date filters:

```
thoughts search --date 2025-04-06            # Specific date
thoughts search --after 2025-01-01           # After Jan 1, 2025
thoughts search --before 2025-04-01          # Before April 1, 2025
thoughts search "keyword" --after 2025-01-01 # Combine text and date
```

Show content previews:

```
thoughts search "keyword" --preview 3        # Show 3 lines of preview
```

Limit results:

```
thoughts search --limit 5                    # Show only 5 results
```

Change sort order:

```
thoughts search --oldest                     # Oldest first (default is newest)
```

### Listing Recent Thoughts

List your most recent thoughts:

```
thoughts list                                # Shows 10 most recent by default
thoughts list --limit 5                      # Show only 5 most recent
```

### Opening Thoughts

After searching or listing, you'll be prompted to open any of the thoughts by entering its number.

You can also directly open a thought by its number in the recent list:

```
thoughts open 1                              # Opens the most recent thought
```

## Configuration

By default, thoughts are saved to `~/thoughts/`.

The script checks the following variables in order to determine which editor to open:
1. `$THOUGHTS_EDITOR` - Set this to use a specific editor for thoughts only
2. `$EDITOR` - Falls back to your system default editor
3. If neither is set, defaults to `nano`

Example:
```bash
# Use VS Code for thoughts only
export THOUGHTS_EDITOR="code -w"
```

## Sync & Backup

The "thoughts" utility includes powerful sync and backup capabilities to keep your notes safe and accessible across devices.

### Git Version Control

Initialize a Git repository for your thoughts:

```
thoughts sync --init
```

Commit changes to track your notes over time:

```
thoughts sync --commit "Add meeting notes"
```

Set up a remote repository (like GitHub):

```
thoughts sync --remote https://github.com/yourusername/thoughts.git
```

Push and pull changes:

```
thoughts sync --push   # Push local changes to remote
thoughts sync --pull   # Pull remote changes to local
```

### Cloud Service Integration

#### Prerequisites

To use cloud sync features, you'll need to install the appropriate command-line tools:

- **For Dropbox sync**: Install [dbxcli](https://github.com/dropbox/dbxcli)
  ```
  # Install with Homebrew (macOS)
  brew install dbxcli
  
  # Then authenticate
  dbxcli account
  ```

- **For Google Drive sync**: Install [drive](https://github.com/odeke-em/drive)
  ```
  # Install with Homebrew (macOS)
  brew install drive
  
  # Then initialize in a directory
  drive init
  ```

#### Syncing Commands

Sync with Dropbox:

```
thoughts sync --dropbox            # Sync to default /thoughts directory
thoughts sync --dropbox /my/path   # Sync to custom path
```

Sync with Google Drive:

```
thoughts sync --gdrive             # Sync to default 'thoughts' directory
thoughts sync --gdrive my/path     # Sync to custom path
```

Note: The first time you run these commands, you may be prompted to authenticate with the respective cloud service.

### Automatic Backups

Create a one-time backup:

```
thoughts backup                   # Creates backup in ~/thoughts_backup
thoughts backup --path /my/path   # Creates backup in custom location
```

Set up automatic backups:

```
thoughts backup --auto daily      # Set up daily automatic backups
thoughts backup --auto weekly     # Set up weekly automatic backups
thoughts backup --auto monthly    # Set up monthly automatic backups
```

## Terminal User Interface (TUI)

The "thoughts" utility includes a rich terminal user interface for browsing and managing your notes:

```
thoughts tui
```

### TUI Features

- **Interactive navigation** with keyboard shortcuts
- **Split-screen view** with thoughts list and markdown preview
- **Syntax highlighting** for markdown content
- **Full-text search** within the interface
- **Keyboard shortcuts** for efficient navigation
- **Rich formatting** with color-coded elements

### TUI Keyboard Shortcuts

| Key           | Action                                     |
|---------------|-------------------------------------------|
| `↑/↓` or `j/k`| Navigate through thoughts                 |
| `Enter` or `o`| Open selected thought in editor           |
| `/`           | Search mode                               |
| `Escape`      | Clear search/exit search mode             |
| `Tab`         | Toggle focus between list and preview     |
| `s`           | Toggle sort (newest/oldest first)         |
| `r`           | Reload thoughts                           |
| `q` or `Ctrl+C`| Quit TUI                                 |
| `?`           | Show help screen                          |

## Web Content Capture

Save web articles directly as notes with automatic parsing and formatting:

```
thoughts save-url https://example.com/article
```

The web content will be saved as a new thought, with proper formatting, metadata, and estimated reading time. All content is saved with proper word wrapping (79 columns) for better readability.

The tool also remembers articles you've saved before, so it won't download and process the same URL multiple times. If you need to reprocess a URL (for example, if the content has been updated), use the `--force` flag:

```
thoughts save-url https://example.com/article --force
```

### Claude AI Integration for Summaries

Enhance web captures with Claude AI for intelligent summaries and content analysis:

```
thoughts save-url https://example.com/article --summarize --api-key your_claude_api_key
```

You can also set your Claude API key as an environment variable:

```bash
export CLAUDE_API_KEY="your_claude_api_key"
thoughts save-url https://example.com/article --summarize
```

#### Audio Summaries

Generate audio versions of AI summaries using your system's text-to-speech capabilities:

```bash
# Generate audio with default system voice
thoughts save-url https://example.com/article --summarize --audio

# Specify a voice to use (system-dependent)
thoughts save-url https://example.com/article --summarize --audio --voice "Samantha"
```

This feature uses your operating system's built-in text-to-speech capabilities:
- macOS: Uses the `say` command
- Windows: Uses PowerShell's System.Speech
- Linux: Uses available TTS engines like espeak, festival, or pico2wave

The audio file will be saved in the `web-content/audio` directory.

## Bitbucket PR Integration

The "thoughts" utility includes powerful integration with Bitbucket Server, allowing you to save, tag, and search pull requests. This feature is designed to help developers create an easily searchable knowledge base of past development work.

### Why Use PR Integration?

- **Knowledge Preservation**: Capture the context and purpose of code changes that might be forgotten over time
- **Searchable History**: Find PRs by technology, author, purpose, or content
- **Onboarding Aid**: Help new team members understand how features were implemented
- **Technical Reference**: Create a personal library of implementation patterns and solutions

### Setup

First, configure your Bitbucket connection:

```
thoughts pr --config
```

You'll be prompted to enter:
- Your Bitbucket Server URL (e.g., https://bitbucket.example.com)
- Your Bitbucket username
- Your Bitbucket app password or access token

The configuration is stored securely in `~/.thoughts/bitbucket.json`.

### Saving Pull Requests

Save a PR as a thought with various options:

```bash
# Basic usage - save a PR
thoughts pr --save https://bitbucket.example.com/projects/PROJECT/repos/REPO/pull-requests/123

# Add custom tags for better searchability
thoughts pr --save <PR_URL> --tags "login,authentication,feature"

# Add personal notes about implementation details
thoughts pr --save <PR_URL> --notes "This PR implemented the OAuth2 flow that we should reuse for the mobile app"

# Generate AI-enhanced summary with Claude
thoughts pr --save <PR_URL> --summarize --api-key your_claude_api_key

# Use environment variable for Claude API key
export CLAUDE_API_KEY="your_claude_api_key"
thoughts pr --save <PR_URL> --summarize
```

### AI-Enhanced Summaries

When using the `--summarize` flag, the tool leverages Claude AI to generate deeper insights:

1. **Two-Stage Summary Generation**:
   - A rule-based summary is first generated by analyzing metadata and changes
   - Claude AI then enhances this with technical insights and pattern recognition

2. **Key Benefits**:
   - Technical insights beyond simple file listings
   - Identification of patterns across multiple files
   - Clarification of purpose and implementation approach
   - Warnings about potential areas of concern (security, performance, etc.)

3. **How It Works**:
   - Claude analyzes the PR title, description, and changed files
   - It identifies themes and patterns in the code changes
   - It connects changes to broader architectural implications
   - The enhanced summary is saved and indexed for searching

### What Gets Captured

Each saved PR includes:

1. **Metadata**:
   - PR title, author, status (OPEN, MERGED, etc.)
   - Source and target branches
   - Creation and modification dates
   - Number of files changed and comments

2. **Auto-Generated Tags**:
   - Programming languages (javascript, python, java, etc.)
   - Technologies and frameworks (react, angular, spring, etc.)
   - Change types (feature, fix, refactor, etc.)
   - Status and branch information

3. **Intelligent Summary**:
   - Purpose of the changes
   - Files and directories affected
   - Technical approach used
   - AI-enhanced insights (when enabled)

4. **Custom Information**:
   - User-defined tags
   - Personal notes and observations

### Finding Pull Requests

Powerful search and filtering capabilities:

```bash
# List all saved PRs
thoughts pr --list

# Limit the number of results
thoughts pr --list 5

# Full-text search across titles, summaries, and tags
thoughts pr --search "authentication"

# Filter by specific tag
thoughts pr --tag "react"

# Filter by author
thoughts pr --author "john.smith"

# Filter by PR status
thoughts pr --status "MERGED"

# Filter by programming language or technology
thoughts pr --file-type "javascript"

# Explore all available tags in your PR collection
thoughts pr --show-tags
```

### Search Results and Interaction

When viewing search results, you'll see:
- PR titles with timestamps
- Status and author information
- AI-enhanced summaries (highlighted with ✨)
- Sample of changed files
- Key tags for quick reference

You can select any PR by number to open the full saved thought in your editor, which contains complete details including:
- Comprehensive change summary
- Original PR URL for reference
- Full description and custom notes
- Complete list of changed files
- All generated and custom tags

## Claude AI Integration

The "thoughts" utility offers Claude AI integration for both web content and Bitbucket PRs.

### Available Claude Features

When using Claude AI integration, you get:

- **For Web Content**:
  - Concise article summaries with key points
  - Entity detection (technologies, people, companies)
  - Code snippet extraction and language detection
  - Estimated reading time calculation

- **For Pull Requests**:
  - Technical pattern recognition beyond simple change listings
  - Purpose clarification for complex changes
  - Risk identification for potential areas of concern
  - Implementation approach insights

### Configuring Claude

You can configure Claude's behavior with various options:

```bash
# Web content with Claude - basic usage
thoughts save-url https://dev.to/article/react-hooks --summarize

# Pull request with Claude
thoughts pr --save <PR_URL> --summarize

# Use a specific Claude model
thoughts save-url https://example.com --summarize --model claude-3-haiku-20240307
# OR
export CLAUDE_MODEL="claude-3-haiku-20240307"

# Adjust response parameters
thoughts save-url https://example.com --summarize --max-tokens 2000 --temperature 0.5

# Use environment variable for API key
export CLAUDE_API_KEY="your_claude_api_key"
```

### API Key Management

Your Claude API key can be provided in several ways:

1. **Command-line parameter**: `--api-key your_claude_api_key`
2. **Environment variable**: `export CLAUDE_API_KEY="your_claude_api_key"`
3. **Session-based**: Once set in your shell, all commands will use it

## Command Reference

```
Usage: thoughts [options] [command]

A CLI for capturing and searching your thoughts

Options:
  -V, --version                             output the version number
  -h, --help                                display help for command

Commands:
  new                                       Create a new thought
  search [options] [query]                  Search through your thoughts
  list [options]                            List recent thoughts
  open <index>                              Open a recent thought by its number (from list command)
  sync [options]                            Sync and backup your thoughts
  backup [options]                          Backup your thoughts
  tui                                       Open thoughts in a terminal user interface
  save-url [options] <url>                  Save web content as a thought with optional AI processing
  pr [options]                              Work with Bitbucket pull requests
  todo [options]                            Manage your todos using the Eisenhower Matrix
  help [command]                            display help for command
```
