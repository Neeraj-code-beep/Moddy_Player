# Contributing to Moddy Player 🎧

Thank you for your interest in contributing to **Moddy Player** — an AI-powered mood-based music recommendation web application that combines Computer Vision, AI concepts, and Full Stack Web Development.

Whether you're fixing bugs, improving the UI, enhancing mood detection, or adding new features, your contributions are highly appreciated. 🚀

---

# Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
  - [Fork & Clone the Repository](#fork--clone-the-repository)
  - [Setting Up the Development Environment](#setting-up-the-development-environment)
- [Project Structure](#project-structure)
- [Areas You Can Contribute To](#areas-you-can-contribute-to)
- [Branch Naming Conventions](#branch-naming-conventions)
- [Making Changes](#making-changes)
  - [Commit Message Style](#commit-message-style)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Getting Assigned an Issue](#getting-assigned-an-issue)
- [Reporting Issues](#reporting-issues)
- [Need Help?](#need-help)

---

# Code of Conduct

By participating in this project, you agree to maintain a respectful, welcoming, and collaborative environment.

Please:

- Be respectful toward all contributors.
- Provide constructive feedback.
- Help newcomers when possible.
- Focus on improving the project together.

---

# Getting Started

## Fork & Clone the Repository

### 1. Fork the repository

Click the **Fork** button at the top-right corner of the GitHub repository.

### 2. Clone your fork

```bash
git clone https://github.com/YOUR_USERNAME/Moddy_Player.git
```

### 3. Navigate into the project

```bash
cd Moddy_Player
```

### 4. Add the upstream remote

```bash
git remote add upstream https://github.com/Neeraj-code-beep/Moddy_Player.git
```

### 5. Verify remotes

```bash
git remote -v
```

Expected output:

```bash
origin    https://github.com/YOUR_USERNAME/Moddy_Player.git
upstream  https://github.com/Neeraj-code-beep/Moddy_Player.git
```

---

## Setting Up the Development Environment

### Prerequisites

Make sure you have:

| Tool | Recommended Version |
|--------|-------------------|
| Node.js | 18+ |
| npm | 9+ |
| MongoDB | Latest |
| Git | Latest |

---

### Backend Setup

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root:

```env
MONGO_URI=your_mongodb_connection_string

IMAGEKIT_PUBLIC_KEY=your_public_key
IMAGEKIT_PRIVATE_KEY=your_private_key
IMAGEKIT_URL_ENDPOINT=your_url_endpoint
```

Start the backend server:

```bash
node server.js
```

Backend runs on:

```text
http://localhost:5000
```

---

### Frontend Setup

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

---

### Keeping Your Fork Updated

Before starting new work:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

---

# Project Structure

```text
Moddy_Player/
│
├── server.js
│
├── frontend
│   ├── public
│   │
│   ├── src
│   │   ├── api
│   │   │   └── api.js
│   │   │
│   │   ├── components
│   │   │   ├── MoodDetector.jsx
│   │   │   └── MoodSongs.jsx
│   │   │
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   │
│   ├── package.json
│   ├── vite.config.js
│   └── eslint.config.js
│
├── README.md
├── Notes.md
└── .gitignore
```

### Common Contribution Areas

| Area | Location |
|--------|----------|
| Frontend UI | `frontend/src/components` |
| API Logic | `frontend/src/api` |
| Mood Detection | `MoodDetector.jsx` |
| Song Recommendation | Backend & MongoDB Logic |
| Styling | TailwindCSS |
| Documentation | README / Docs |

---

# Areas You Can Contribute To

We welcome contributions in:

- Mood detection improvements
- Facial expression recognition accuracy
- Song recommendation logic
- Spotify API integration
- Gemini AI integration
- UI/UX enhancements
- Backend optimization
- MongoDB improvements
- ImageKit integration
- Responsive design
- Documentation
- Testing and bug fixes

---

# Branch Naming Conventions

Never commit directly to `main`.

Create a dedicated branch:

```bash
git checkout -b feature/your-feature-name
```

Recommended formats:

| Type | Example |
|--------|----------|
| feature | feature/spotify-integration |
| bugfix | bugfix/webcam-detection |
| docs | docs/update-readme |
| refactor | refactor/mood-engine |
| style | style/player-ui |
| test | test/mood-detection |

---

# Making Changes

### Guidelines

- Keep PRs focused on one task.
- Follow existing project structure.
- Avoid unrelated code changes.
- Test your changes before submitting.
- Write clear commit messages.
- Update documentation when necessary.

---

## Commit Message Style

Follow Conventional Commits:

```text
type(scope): description
```

Examples:

```text
feat(mood): improve facial emotion detection

feat(player): add playback controls

fix(api): handle empty song results

fix(webcam): resolve camera initialization bug

docs: update setup instructions

refactor(recommendation): simplify song filtering logic
```

### Rules

- Use present tense.
- Keep messages concise.
- Reference related issues when applicable.

Example:

```text
Fixes #12
Closes #8
```

---

# Submitting a Pull Request

### 1. Sync with latest changes

```bash
git fetch upstream
git merge upstream/main
```

### 2. Push your branch

```bash
git push origin your-branch-name
```

### 3. Open a Pull Request

Create a PR against the `main` branch.

Include:

- Clear title
- What changed
- Why it was changed
- Screenshots (if UI-related)
- Linked issue number

Example:

```text
feat(player): add Spotify integration

Fixes #25
```

---

## PR Checklist

Before submitting:

- [ ] Project runs successfully
- [ ] Backend starts correctly
- [ ] Frontend builds successfully
- [ ] No console errors
- [ ] Documentation updated if needed
- [ ] Environment variables documented
- [ ] Changes tested locally
- [ ] Issue linked in PR
- [ ] Commit messages follow Conventional Commits

---

# Getting Assigned an Issue

Before working on an issue:

1. Browse open issues.
2. Comment expressing interest.
3. Explain your planned approach.
4. Wait for assignment from a maintainer.
5. Start work after assignment.

Example:

```markdown
Hi 👋

I'd like to work on this issue.

Planned approach:
- Improve mood detection accuracy
- Optimize recommendation logic
- Add necessary tests

Could you please assign this issue to me?
```

---

# Reporting Issues

Found a bug?

Please include:

- Clear title
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Browser information
- Node.js version
- Console errors

---

## Feature Requests

Please include:

- Problem description
- Proposed solution
- Benefits
- Alternative approaches considered

---

# Good First Contributions

New contributors can start with:

- Improving UI styling
- Adding loading states
- Better error handling
- Mobile responsiveness
- Documentation improvements
- Form validation
- Refactoring components
- Accessibility improvements

---

# Need Help?

If you have questions:

- Check existing issues first.
- Open a new discussion or issue.
- Reach out through project discussions.
- Ask for clarification before starting large changes.

---

# Maintainer

**Neeraj Mishra**

Project Focus:

- AI + Computer Vision
- Emotion Detection
- Music Recommendation Systems
- Full Stack Development

---

Thank you for contributing to Moddy Player! 🎵

Every contribution, no matter how small, helps improve the project and makes it better for everyone.

Happy Coding! 🚀