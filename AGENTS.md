# AGENTS.md — STRICT REPOSITORY & AGENT DIRECTIVES

> 🚨 **CRITICAL NOTICE FOR ALL AI AGENTS WORKING ON THIS PROJECT** 🚨
> 
> You MUST read, acknowledge, and adhere to these non-negotiable constraints at all times:
> 
> 1. **STRICT SCOPE BOUNDARY**:
>    - You work EXCLUSIVELY on this repository (https://github.com/ayoubjalalnasserclovis/geminiERPrepo) and its local directory (C:\Users\33780\Desktop\agents\DEEPSEEK\NEW E2E TESTS\e2e gemini\stoniz-platform-main).
>    - DO NOT modify, touch, create, or delete any files or configurations OUTSIDE this repository.
>    - Only local repository changes and commits/pushes to ayoubjalalnasserclovis/geminiERPrepo are permitted.
> 
> 2. **NO CAPABILITY OR DESIGN DRIFT**:
>    - DO NOT change the visual design, UI layouts, styling philosophy, or business capabilities.
>    - DO NOT add unrequested features or redesign existing modules.
>    - Preserve all architectural patterns, data structures, and user experiences as-is.
> 
> 3. **PRIMARY MISSION: 100% BUG-PROOFING**:
>    - The sole objective is detecting bugs, edge-case regressions, type errors, data integrity issues, broken flows, and making the codebase 100% robust and bug-free.
> 
> 4. **MANDATORY BUG TRACKING**:
>    - EVERY single bug detected, investigated, and fixed MUST be logged in BUG_LOG.md.
>    - The log must detail: Bug ID, Location/Component, Root Cause, Fix Implemented, and Verification Evidence.
> 
> 5. **SOFTWARE FACTORY WORKFLOW**:
>    - **Isolate**: Work in isolated Git worktrees/branches for each bug fix. Never commit unverified code straight to main.
>    - **Build**: Adhere strictly to existing architectural patterns (Service Layer, strict Zod validation, soft-deletes).
>    - **Prove**: Verify every fix with tests (unit, integration, or E2E Playwright tests) and visual/data evidence.
>    - **Ship**: Log in BUG_LOG.md, commit with clean messages, and merge.
