---
name: react-app-builder
description: Create and bundle React apps with TypeScript, Tailwind CSS, and shadcn/ui. Outputs a single portable HTML file.
license: Complete terms in LICENSE.txt
---

# React App Builder

Build portable React applications that bundle into a single HTML file.

## Quick Start

### Step 1: Initialize Project

```bash
bash scripts/init-artifact.sh <project-name>
cd <project-name>
```

This creates a fully configured project with:
- React 18 + TypeScript (via Vite)
- Tailwind CSS with shadcn/ui theming
- 40+ pre-installed shadcn/ui components
- Path aliases (`@/`) configured
- Parcel configured for bundling

### Step 2: Develop Your App

Edit the generated files in `src/`. The stack includes:
- **React 18** for UI
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **shadcn/ui** for components

### Step 3: Bundle to Single HTML

```bash
bash scripts/bundle-artifact.sh
```

This creates `bundle.html` - a self-contained app with all JavaScript, CSS, and dependencies inlined.

**What the bundler does:**
- Builds with Parcel (no source maps)
- Inlines all assets into single HTML
- Creates a portable file you can share anywhere

### Step 4: Deploy or Share

The bundled HTML file can be:
- Deployed to Vercel (use the deploy-vercel tool)
- Shared directly as a file
- Embedded in other applications

## Design Guidelines

Avoid common pitfalls:
- Excessive centered layouts
- Overuse of gradients
- Uniform rounded corners everywhere
- Default Inter font for everything

## Reference

- **shadcn/ui components**: https://ui.shadcn.com/docs/components
- **Tailwind CSS**: https://tailwindcss.com/docs
- **React**: https://react.dev
